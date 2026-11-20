import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStdinReader } from './wasi.ts';

const drain = (input: string, maxBytes: number) => {
    const read = createStdinReader(input);
    const chunks: string[] = [];
    for (let chunk = read(maxBytes); chunk !== null; chunk = read(maxBytes)) {
        assert.ok(new TextEncoder().encode(chunk).length <= Math.max(maxBytes, 4));
        chunks.push(chunk);
    }
    return chunks;
};

test('큰 입력을 요청 크기만큼 나눠 빠짐없이 돌려준다', () => {
    const input = Array.from({ length: 200_000 }, (_, i) => i).join(' ') + '\n';
    const chunks = drain(input, 1024);
    assert.equal(chunks.join(''), input);
    assert.ok(chunks.length > 100);
});

test('한글과 이모지를 바이트 단위로 자르되 글자를 깨뜨리지 않는다', () => {
    const input = '가나다라마바사 😀😀 abc\n'.repeat(50);
    for (const size of [1, 3, 5, 16, 64]) {
        assert.equal(drain(input, size).join(''), input);
    }
});

test('빈 입력은 바로 EOF', () => {
    assert.equal(createStdinReader('')(1024), null);
});
