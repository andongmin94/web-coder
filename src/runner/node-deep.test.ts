// node.js 깊은 재귀 모드(QuickJS)를 node에서 실제로 실행해 봅니다. (JSPI가 있는 node에서만)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { WASI_DEEP_STACK, instrumentDeepStack } from './deep-stack.ts';
import { jspi } from './jspi.ts';

// 번들러(esbuild text loader)처럼 .txt를 문자열 모듈로 불러옵니다.
registerHooks({
    load(url, context, next) {
        if (!url.endsWith('.txt')) return next(url, context);
        const text = readFileSync(new URL(url), 'utf8');
        return {
            format: 'module',
            shortCircuit: true,
            source: `export default ${JSON.stringify(text)};`,
        };
    },
});
const { QUICKJS_PATH, runNodeDeepWith } = await import('./node-deep.ts');

const skip = jspi() ? false : 'JSPI가 없는 node';
let module: Promise<WebAssembly.Module> | null = null;
const load = () => {
    module ??= WebAssembly.compile(
        instrumentDeepStack(
            new Uint8Array(readFileSync(new URL(`../../public/${QUICKJS_PATH}`, import.meta.url))),
            WASI_DEEP_STACK
        ) as Uint8Array<ArrayBuffer>
    );
    return module;
};
const run = async (source: string, stdin = '') => runNodeDeepWith(await load(), source, stdin);

test('깊이 30만 재귀와 표준 입력', { skip }, async () => {
    const r = await run(
        [
            "const [a, b] = require('fs').readFileSync('/dev/stdin', 'utf8').trim().split(' ').map(Number);",
            'const f = (n) => (n ? f(n - 1) + 1 : 0);',
            'console.log(a + b, f(300000));',
        ].join('\n'),
        '3 4\n'
    );
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, '7 300000\n');
    assert.equal(r.exitCode, 0);
});

test('readline, 타이머, console.log 서식', { skip }, async () => {
    const r = await run(
        [
            "const rl = require('readline').createInterface({ input: process.stdin });",
            'const lines = [];',
            "rl.on('line', (l) => lines.push(l));",
            "rl.on('close', () => setTimeout(() => console.log(lines, { n: lines.length }), 1));",
        ].join('\n'),
        '1 2\n한글\n'
    );
    assert.equal(r.stdout, "[ '1 2', '한글' ] { n: 2 }\n");
});

test('process.exit와 에러 위치', { skip }, async () => {
    const exited = await run("console.log('a'); process.exit(3); console.log('b');");
    assert.equal(exited.stdout, 'a\n');
    assert.equal(exited.exitCode, 3);

    const failed = await run('const x = 1;\nnull.y;\n');
    assert.equal(failed.exitCode, 1);
    assert.match(failed.stderr, /^TypeError: .*\n {4}at .*main\.js:2:/);
});

test('한계를 넘으면 RangeError로 끝난다 (메모리를 망가뜨리지 않음)', { skip }, async () => {
    const r = await run(
        'function f(n) { return f(n + 1) + 1; }\ntry { f(0); } catch (e) { console.log(e.name); }\n'
    );
    assert.equal(r.stdout, 'RangeError\n');
});

test('수십만 개를 펼친 호출 (push(...arr), Math.max(...arr))', { skip }, async () => {
    const r = await run(
        [
            'const a = [];',
            'const big = Array.from({ length: 300000 }, (_, i) => i % 7);',
            'a.push(...big);',
            'console.log(a.length, Math.max(...big), Math.min.apply(null, big));',
        ].join('\n')
    );
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, '300000 6 0\n');
});

test('async 안의 에러와 process.exit (node처럼)', { skip }, async () => {
    const thrown = await run("(async () => { await null; throw new Error('boom'); })();\n");
    assert.equal(thrown.exitCode, 1);
    assert.match(thrown.stderr, /^Error: boom/);

    const exited = await run(
        "(async () => { await null; console.log('a'); process.exit(0); console.log('b'); })();\n" +
            "setTimeout(() => console.log('t'), 5);\n"
    );
    assert.equal(exited.stdout, 'a\n');
    assert.equal(exited.exitCode, 0);

    const rejected = await run("Promise.reject(new Error('x'));\n");
    assert.equal(rejected.exitCode, 1);
    assert.match(rejected.stderr, /Error: x/);

    // 나중에 .catch가 붙으면 에러가 아님
    const caught = await run(
        "const p = Promise.reject(new Error('later'));\np.catch(() => console.log('caught'));\n"
    );
    assert.equal(caught.exitCode, 0);
    assert.equal(caught.stdout, 'caught\n');
});
