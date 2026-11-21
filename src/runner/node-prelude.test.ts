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

/** 로컬 실행기와 같은 방식으로 prelude를 올린 뒤 코드를 실행하고 stdout/stderr를 돌려줍니다. */
const run = (source: string, stdin = '') => {
    let stdout = '';
    let stderr = '';
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
        setTimeout,
        clearTimeout,
    });
    vm.runInContext(prelude, context);
    const main = vm.runInContext(
        `(function (exports, require, module, __filename, __dirname) {${source}\n})`,
        context
    );
    const g = context as unknown as { require: unknown; module: { exports: object } };
    main.call(g.module.exports, g.module.exports, g.require, g.module, '/main.js', '/');
    (context as unknown as { __drainInput: () => void }).__drainInput();
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
];

for (const expression of VALUES) {
    test(`console.log(${expression.slice(0, 50)})`, () => {
        const expected = formatWithOptions({}, new Function(`return ${expression}`)()) + '\n';
        assert.equal(run(`console.log(${expression})`).stdout, expected);
    });
}

test('클래스 인스턴스와 TypedArray에 이름이 붙는다', () => {
    const { stdout } = run(
        `class Q { constructor() { this.a = []; } }\nconsole.log(new Q(), new Uint8Array(3));`
    );
    assert.equal(stdout, 'Q { a: [] } Uint8Array(3) [ 0, 0, 0 ]\n');
});

test('readFileSync는 인코딩이 없으면 Buffer, 있으면 문자열', () => {
    const { stdout } = run(
        `const fs = require('fs');
const b = fs.readFileSync(0);
console.log(Buffer.isBuffer(b), b[0], b.toString().trim(), typeof fs.readFileSync('/dev/stdin', 'utf8'));`,
        '12 34\n'
    );
    assert.equal(stdout, 'true 49 12 34 string\n');
});

test('최상위 선언이 전역을 덮어쓰지 않고, 최상위 return이 된다', () => {
    const { stdout } = run(
        `var self = 1, name = 'x';
function postMessage() { return 2; }
console.log(self, name, postMessage(), this === module.exports, typeof __dirname);
return;
console.log('unreachable');`
    );
    assert.equal(stdout, '1 x 2 true string\n');
});

test('readline은 줄 단위로 입력을 넘긴다', () => {
    const { stdout } = run(
        `const rl = require('readline').createInterface({ input: process.stdin });
const lines = [];
rl.on('line', (l) => lines.push(l)).on('close', () => console.log(lines.length, lines[1]));`,
        'a\nb c\n'
    );
    assert.equal(stdout, '2 b c\n');
});

test('없는 모듈은 MODULE_NOT_FOUND', () => {
    assert.throws(() => run(`require('child_process')`), { code: 'MODULE_NOT_FOUND' });
});
