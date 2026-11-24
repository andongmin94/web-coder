import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatWithOptions } from 'node:util';
import vm from 'node:vm';

const prelude = readFileSync(
    fileURLToPath(new URL('./node-prelude.js.txt', import.meta.url)),
    'utf8'
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 로컬 실행기(sandbox/js-worker.ts)와 같은 순서로 prelude를 올려 코드를 실행합니다.
 * 메인 코드 → 한 차례 쉼 → 입력 흘려보내기 → 대기 중인 타이머가 없을 때까지 기다림
 */
const run = async (source: string, stdin = '') => {
    let stdout = '';
    let stderr = '';
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const context = vm.createContext({
        __stdin: stdin,
        __write: (fd: number, text: string) => {
            if (fd === 2) stderr += text;
            else stdout += text;
        },
        TextEncoder,
        TextDecoder,
        performance,
        atob,
        btoa,
        setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
            const id = setTimeout(() => {
                pending.delete(id);
                fn(...args);
            }, ms);
            pending.add(id);
            return id;
        },
        clearTimeout: (id: ReturnType<typeof setTimeout>) => {
            pending.delete(id);
            clearTimeout(id);
        },
    });
    vm.runInContext(prelude, context);
    const main = vm.runInContext(
        `(function (exports, require, module, __filename, __dirname) {${source}\n})`,
        context
    );
    const g = context as unknown as {
        require: unknown;
        module: { exports: object };
        __drainInput: () => void;
    };
    main.call(g.module.exports, g.module.exports, g.require, g.module, '/main.js', '/');
    await sleep(0);
    g.__drainInput();
    await sleep(0);
    while (pending.size > 0) await sleep(1);
    return { stdout, stderr };
};

// console.log 출력이 실제 Node와 같아야 예제 판정이 맞습니다.
const VALUES = [
    `[1.5, 'a', null, undefined, true]`,
    `{ a: { b: { c: { d: 1 } } } }`,
    `Array.from({ length: 30 }, (_, i) => i * 37)`,
    `Array.from({ length: 120 }, (_, i) => i)`,
    `Array.from({ length: 27 }, (_, i) => (i % 3 ? -i : i * 1000))`,
    `['apple', 'banana', 'cherry', 'dragonfruit', 'elderberry', 'fig', 'grape', 'honeydew']`,
    `Array.from({ length: 10 }, (_, i) => Array.from({ length: 10 }, (_, j) => i * j))`,
    `{ name: 'a'.repeat(24), value: 'b'.repeat(31), other: 'c'.repeat(24), n: [1, 2, 3] }`,
    `new Map([[1, { a: 2 }], ['k', [1, 2]]])`,
    `new Set([1, 'a'])`,
    `[-0, 12n, 0.1 + 0.2, 1e21, NaN]`,
    `["it's", 'say "hi"', 'a\\nb']`,
    `[1, , , 4]`,
    `{ a: 1, 'b-c': 2, 3: 4 }`,
    `Array.from({ length: 3 }, (_, i) => ({ id: i, name: 'name' + i, tags: ['a', 'b'], pos: { x: i, y: i * 2 } }))`,
    // 한글은 화면에서 2칸이라 열 맞춤이 달라집니다.
    `['가나다라', '마바', '사아자차카', '타파하', '가', '나다', '라마바사', '아자', '차카타파하', '하하']`,
    `Array.from({ length: 12 }, (_, i) => '값'.repeat((i % 4) + 1))`,
    `{ $y: 1, _a: 2, a$: 3, 한글: 5 }`,
    `['a\\x01b', '\\x7f', '\\v', '\\x00', '\\u0085', '\\ud800']`,
    `(() => { const a = { x: 1 }; a.self = a; const b = [a]; b.push(b); return { a, b }; })()`,
    `[new Number(3), new String('ab'), new Boolean(false), Object(1n), new Number(-0)]`,
    `[new Array(3), [[[[{}]]]], [[[[]]]], {}]`,
    `[Object.assign(function f() {}, { a: 1 }), async function g() {}, function* h() {}]`,
    `{ [Symbol('k')]: 1, a: 2 }`,
    `[new (class Foo extends Map {})([[1, 2]]), new ArrayBuffer(3)]`,
];

for (const expression of VALUES) {
    test(`console.log(${expression.slice(0, 50)})`, async () => {
        const expected = formatWithOptions({}, new Function(`return ${expression}`)()) + '\n';
        assert.equal((await run(`console.log(${expression})`)).stdout, expected);
    });
}

const FORMATS = [
    `'100%%'`,
    `'%d %s', -0, -0`,
    `'%s', { a: { b: { c: 1 } }, d: [1, [2, [3]]] }`,
    `'%s', new (class P { toString() { return 'P!'; } })()`,
    `'%o', { a: [1, 2] }`,
    `'%i %f %d', '42.9px', '3.5e2', '12abc'`,
];

for (const args of FORMATS) {
    test(`console.log(${args})`, async () => {
        const expected = new Function('f', `return f({}, ${args})`)(formatWithOptions) + '\n';
        assert.equal((await run(`console.log(${args})`)).stdout, expected);
    });
}

test('클래스 인스턴스와 TypedArray에 이름이 붙는다', async () => {
    const { stdout } = await run(
        `class Q { constructor() { this.a = []; } }\nconsole.log(new Q(), new Uint8Array(3));`
    );
    assert.equal(stdout, 'Q { a: [] } Uint8Array(3) [ 0, 0, 0 ]\n');
});

test('readFileSync는 인코딩이 없으면 Buffer, 있으면 문자열', async () => {
    const { stdout } = await run(
        `const fs = require('fs');
const b = fs.readFileSync(0);
console.log(Buffer.isBuffer(b), b[0], b.toString().trim(), typeof fs.readFileSync('/dev/stdin', 'utf8'));`,
        '12 34\n'
    );
    assert.equal(stdout, 'true 49 12 34 string\n');
});

test('최상위 선언이 전역을 덮어쓰지 않고, 최상위 return이 된다', async () => {
    const { stdout } = await run(
        `var self = 1, name = 'x';
function postMessage() { return 2; }
console.log(self, name, postMessage(), this === module.exports, typeof __dirname);
return;
console.log('unreachable');`
    );
    assert.equal(stdout, '1 x 2 true string\n');
});

test('readline은 줄 단위로 입력을 넘긴다', async () => {
    const { stdout } = await run(
        `const rl = require('readline').createInterface({ input: process.stdin });
const lines = [];
rl.on('line', (l) => lines.push(l)).on('close', () => console.log(lines.length, lines[1]));`,
        'a\nb c\n'
    );
    assert.equal(stdout, '2 b c\n');
});

test('없는 모듈은 MODULE_NOT_FOUND', async () => {
    await assert.rejects(() => run(`require('child_process')`), { code: 'MODULE_NOT_FOUND' });
});

test('stdout.write에 숫자를 주면 Node처럼 TypeError, 바이트열은 글자로', async () => {
    await assert.rejects(() => run(`process.stdout.write(5)`), { code: 'ERR_INVALID_ARG_TYPE' });
    assert.equal((await run(`process.stdout.write(new Uint8Array([65, 10]))`)).stdout, 'A\n');
});

test('readline: output을 주면 질문을 출력하고, 단독 \\r도 줄 끝', async () => {
    const { stdout } = await run(
        `const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
rl.question('Name? ', (a) => console.log(a));`,
        'q\n'
    );
    assert.equal(stdout, 'Name? q\n');
    const lines = await run(
        `const rl = require('readline').createInterface(process.stdin);
const out = []; rl.on('line', (l) => out.push(l)).on('close', () => console.log(out.join('|')));`,
        'a\rb\r\nc\n'
    );
    assert.equal(lines.stdout, 'a|b|c\n');
});

test("stdin의 'readable'과 read(), events.once", async () => {
    const { stdout } = await run(
        `let s = ''; process.stdin.on('readable', () => { let c; while ((c = process.stdin.read()) !== null) s += c; });
process.stdin.on('end', () => console.log(s.trim()));
console.log(typeof require('events').once);`,
        '1 2\n'
    );
    assert.equal(stdout, 'function\n1 2\n');
});

test('Buffer: 문자열 검색, write*, 느슨한 deepEqual, inspect depth', async () => {
    const { stdout } = await run(
        `const b = Buffer.from('abc'); const w = Buffer.alloc(4); w.writeInt32LE(-2);
require('assert').deepEqual({ a: 1 }, { a: '1' });
console.log(b.includes('b'), b.indexOf('c'), w.readInt32LE(0), require('util').inspect({ a: { b: { c: { d: 1 } } } }, { depth: null }));`
    );
    assert.equal(stdout, 'true 2 -2 {\n  a: { b: { c: { d: 1 } } }\n}\n');
});

// 진짜 Node(파일 리다이렉트)에서 잰 결과와 같아야 합니다.
const RL = "const rl = require('readline').createInterface({ input: process.stdin });";
const TIMING: [string, string, string][] = [
    [
        '늦게 단 data 리스너도 입력을 받는다',
        `setTimeout(() => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => console.log(JSON.stringify(s))); }, 5);`,
        '"1\\n2\\n3\\n"',
    ],
    [
        '읽는 쪽이 없으면 end가 오지 않는다',
        `process.stdin.on('end', () => console.log('end'));`,
        '',
    ],
    [
        '늦게 만든 readline도 줄을 받는다',
        `setTimeout(() => { ${RL} const got = []; rl.on('line', (l) => got.push(l)).on('close', () => console.log(got.join(','))); }, 5);`,
        '1,2,3',
    ],
    [
        '줄이 다 지나간 뒤 단 line 리스너는 못 받는다',
        `${RL} setTimeout(() => { const got = []; rl.on('line', (l) => got.push(l)).on('close', () => console.log(got.join(','))); }, 5);`,
        '',
    ],
    [
        'once로 첫 줄을 await하면 나머지 줄은 지나가고 close는 온다',
        `${RL} (async () => { const first = await new Promise((r) => rl.once('line', r)); const got = []; rl.on('line', (l) => got.push(l)); rl.on('close', () => console.log(first, got.join(','))); })();`,
        '1',
    ],
    [
        'readFileSync(0)으로 읽은 뒤 readline은 받을 것이 없다',
        `const t = require('fs').readFileSync(0, 'utf8'); ${RL} rl.on('line', (l) => console.log('line', l)); console.log(JSON.stringify(t));`,
        '"1\\n2\\n3\\n"',
    ],
    [
        'fd 0은 읽기 위치를 공유한다',
        `const fs = require('fs'); const b = Buffer.alloc(3); const n = fs.readSync(0, b, 0, 3, null); console.log(n, JSON.stringify(fs.readFileSync(0, 'utf8')), JSON.stringify(fs.readFileSync(0, 'utf8')));`,
        '3 "\\n3\\n" ""',
    ],
    [
        'rl의 비동기 반복자는 여러 번 불러도 같은 줄을 이어 준다',
        `${RL} (async () => { const next = async () => (await rl[Symbol.asyncIterator]().next()).value; console.log(await next(), await next(), await next()); })();`,
        '1 2 3',
    ],
];

for (const [name, source, expected] of TIMING) {
    test(`stdin 타이밍: ${name}`, async () => {
        assert.equal((await run(source, '1\n2\n3\n')).stdout.trim(), expected);
    });
}

test('기본 템플릿은 윈도우식 줄 끝(\r\n) 입력도 줄마다 \r 없이 나눈다', async () => {
    const { RUNTIMES } = await import('../shared/languages.ts');
    const source = RUNTIMES.javascript.template + 'console.log(JSON.stringify(input));';
    for (const stdin of ['3\r\nYES\r\n1 2\r\n', '3\nYES\n1 2\n', '3\nYES\n1 2']) {
        assert.equal((await run(source, stdin)).stdout, '["3","YES","1 2"]\n');
    }
});
