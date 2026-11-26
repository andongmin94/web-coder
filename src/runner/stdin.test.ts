import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStdin, createTextSink } from './wasi.ts';

/** wasm 메모리를 흉내: iovec 표를 0번지에 쓰고, 버퍼들은 그 뒤에 */
const memoryWith = (lengths: number[]) => {
    const memory = new ArrayBuffer(1 << 22);
    const view = new DataView(memory);
    let next = 1024;
    const buffers = lengths.map((len, i) => {
        view.setUint32(i * 8, next, true);
        view.setUint32(i * 8 + 4, len, true);
        const ptr = next;
        next += len;
        return { ptr, len };
    });
    return { memory, buffers };
};

/** musl의 __stdio_read처럼: readv([사용자 버퍼, FILE 버퍼]), 앞 버퍼가 다 차야 뒤 버퍼를 씀 */
const freadAll = (input: string, userLen: number, fileBuf = 1024) => {
    const stdin = createStdin(input);
    const out: number[] = [];
    for (;;) {
        const { memory, buffers } = memoryWith([userLen, fileBuf]);
        const n = stdin.read(memory, 0, 2);
        if (n === 0) break;
        const first = Math.min(n, userLen);
        out.push(...new Uint8Array(memory, buffers[0].ptr, first));
        // 앞 버퍼를 다 채웠을 때만 뒤 버퍼에 나머지가 있음
        if (n > userLen) out.push(...new Uint8Array(memory, buffers[1].ptr, n - userLen));
        else assert.ok(n === userLen || n < userLen, 'short read');
    }
    return new TextDecoder().decode(new Uint8Array(out));
};

test('64KB가 넘는 한글 입력을 fread(64KB)로 읽어도 빠짐없이 그대로', () => {
    const input = Array.from({ length: 20000 }, (_, i) => `${i} 가나다\n`).join('');
    assert.ok(new TextEncoder().encode(input).length > 65536 * 2);
    assert.equal(freadAll(input, 65535), input);
    assert.equal(freadAll(input, 1), input); // 글자보다 작은 버퍼도 바이트 단위로
});

test('앞 버퍼를 다 못 채우면 뒤 버퍼는 건드리지 않는다 (입력 끝)', () => {
    const stdin = createStdin('abc');
    const { memory, buffers } = memoryWith([8, 8]);
    assert.equal(stdin.read(memory, 0, 2), 3);
    assert.deepEqual([...new Uint8Array(memory, buffers[1].ptr, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(stdin.read(memory, 0, 2), 0); // EOF
});

test('쓰기 경계에 걸친 한글 글자를 깨뜨리지 않는다', () => {
    const text = '아니오\n'.repeat(500);
    const bytes = new TextEncoder().encode(text);
    const written: string[] = [];
    const sink = createTextSink((fd, t) => written.push(`${fd}:${t}`));
    // 7바이트씩 끊어 씀 (한글 3바이트와 맞지 않게)
    for (let i = 0; i < bytes.length; i += 7) {
        const chunk = bytes.subarray(i, i + 7);
        const { memory, buffers } = memoryWith([chunk.length]);
        new Uint8Array(memory, buffers[0].ptr, chunk.length).set(chunk);
        assert.equal(sink.write(memory, 1, 0, 1), chunk.length);
    }
    sink.flush();
    const stdout = written.map((w) => w.slice(2)).join('');
    assert.equal(stdout, text);
    assert.ok(!stdout.includes('�'));
});
