import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    CPP_DEEP_STACK,
    RESUME_EXPORT,
    instrumentDeepStack,
    instrumentDeepStackWithMap,
    jspi,
} from './deep-stack.ts';

const name = (text: string) => [text.length, ...new TextEncoder().encode(text)];
const section = (id: number, payload: number[]) => [id, payload.length, ...payload];

/**
 * (module
 *   (import "webcoder" "grow" (func (param i32)))        ;; withGrow일 때만
 *   (global (mut i32) (i32.const 0))
 *   (func (export "f") (param i32) (result i32)          ;; f(n) = n == 0 ? 0 : f(n - 1) + 1
 *     (if (result i32) (i32.eqz (local.get 0))
 *       (then (i32.const 0))
 *       (else (i32.add (call $f (i32.sub (local.get 0) (i32.const 1))) (i32.const 1))))))
 */
const recursionModule = (withGrow: boolean) => {
    const self = withGrow ? 1 : 0;
    const body = [
        0x00, // 지역 변수 없음
        ...[0x20, 0x00, 0x45, 0x04, 0x7f, 0x41, 0x00, 0x05],
        ...[0x20, 0x00, 0x41, 0x01, 0x6b, 0x10, self, 0x41, 0x01, 0x6a, 0x0b, 0x0b],
    ];
    return Uint8Array.from([
        ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
        ...section(1, [0x02, 0x60, 0x01, 0x7f, 0x00, 0x60, 0x01, 0x7f, 0x01, 0x7f]),
        ...(withGrow ? section(2, [0x01, ...name('webcoder'), ...name('grow'), 0x00, 0x00]) : []),
        ...section(3, [0x01, 0x01]),
        ...section(6, [0x01, 0x7f, 0x01, 0x41, 0x00, 0x0b]),
        ...section(7, [0x01, ...name('f'), 0x00, self]),
        ...section(10, [0x01, body.length, ...body]),
    ]);
};

test('원본 모듈은 그대로 실행된다', async () => {
    const { instance } = await WebAssembly.instantiate(recursionModule(true), {
        webcoder: { grow() {} },
    });
    assert.equal((instance.exports.f as (n: number) => number)(100), 100);
});

test('고친 모듈이 유효하고 resume 함수를 내보낸다', () => {
    const patched = instrumentDeepStack(recursionModule(true), CPP_DEEP_STACK);
    assert.ok(patched);
    assert.ok(WebAssembly.validate(patched as Uint8Array<ArrayBuffer>));
    const exports = WebAssembly.Module.exports(
        new WebAssembly.Module(patched as Uint8Array<ArrayBuffer>)
    ).map((e) => e.name);
    assert.deepEqual(exports, ['f', RESUME_EXPORT]);
});

test('grow import가 없는 모듈은 고치지 않는다', () => {
    assert.equal(instrumentDeepStack(recursionModule(false), CPP_DEEP_STACK), null);
});

test('고친 모듈은 스택 한계를 넘는 재귀를 끝까지 실행한다', async (t) => {
    const api = jspi();
    if (!api) {
        t.skip('이 Node에는 JSPI가 없습니다');
        return;
    }
    const patched = instrumentDeepStack(recursionModule(true), CPP_DEEP_STACK)!;
    let resume: (id: number) => Promise<unknown> = async () => {};
    const { instance } = await WebAssembly.instantiate(patched as Uint8Array<ArrayBuffer>, {
        webcoder: { grow: new api.Suspending((id: number) => resume(id)) },
    });
    resume = api.promising(instance.exports[RESUME_EXPORT] as (id: number) => void);
    const f = api.promising(instance.exports.f as (n: number) => number);
    assert.equal(await f(10), 10);
    assert.equal(await f(500_000), 500_000);
});

test('고친 모듈의 코드 주소를 원래 모듈의 주소로 되돌린다', () => {
    const original = recursionModule(true);
    const result = instrumentDeepStackWithMap(original, CPP_DEEP_STACK)!;
    // 원래 함수 본문의 한 부분(f를 다시 부르는 곳)을 양쪽에서 찾습니다.
    const needle = [0x41, 0x01, 0x6b, 0x10, 0x01, 0x41, 0x01, 0x6a];
    const find = (bytes: Uint8Array) => {
        for (let i = bytes.length - needle.length; i >= 0; i--)
            if (needle.every((value, k) => bytes[i + k] === value)) return i;
        return -1;
    };
    const before = find(original);
    const after = find(result.module);
    assert.ok(before > 0 && after > 0 && after !== before);
    assert.equal(result.toOriginal(after), before);
    assert.equal(result.toOriginal(after + 3), before + 3);
    // 모듈 머리와 새로 넣은 래퍼의 주소는 대응하는 원래 주소가 없습니다.
    assert.equal(result.toOriginal(8), null);
});
