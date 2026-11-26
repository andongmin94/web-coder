import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replaceI32Const } from './wasm-const.ts';
import { PYTHON_C_RECURSION } from './python-patch.ts';

const python = new Uint8Array(readFileSync('public/wasm/python-3.13.17.wasm'));

test('Python의 C 재귀 한도(new_threadstate의 i32.const)를 바꾼 모듈도 올바른 wasm', () => {
    const patched = replaceI32Const(
        python,
        'new_threadstate',
        PYTHON_C_RECURSION.from,
        PYTHON_C_RECURSION.to
    );
    assert.ok(WebAssembly.validate(patched));
    assert.notEqual(patched.length, python.length); // 상수가 길어져 크기가 바뀜
    // 다시 바꾸면 원래대로
    const back = replaceI32Const(
        patched,
        'new_threadstate',
        PYTHON_C_RECURSION.to,
        PYTHON_C_RECURSION.from
    );
    assert.deepEqual(back, python);
});

test('없는 함수나 여러 번 나오는 상수는 거절', () => {
    assert.throws(() => replaceI32Const(python, 'no_such_function', 1, 2), /찾지 못했습니다/);
    assert.throws(() => replaceI32Const(python, 'new_threadstate', 123456, 1), /0번/);
});
