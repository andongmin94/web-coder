import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseTar } from './tar.ts';

const encoder = new TextEncoder();

const header = (name: string, size: number, type = '0', prefix = '') => {
    const h = new Uint8Array(512);
    h.set(encoder.encode(name), 0);
    h.set(encoder.encode(size.toString(8).padStart(11, '0')), 124);
    h.set(encoder.encode('00000000000'), 136);
    h[156] = type.charCodeAt(0);
    h.set(encoder.encode('ustar\0'), 257);
    h.set(encoder.encode(prefix), 345);
    return h;
};

const block = (content: string) => {
    const bytes = encoder.encode(content);
    const out = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
    out.set(bytes);
    return out;
};

const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0) + 1024);
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
};

test('일반 파일, 디렉터리, prefix, GNU 긴 이름', () => {
    const long = 'a/'.repeat(80) + 'long.txt';
    const tar = concat(
        header('dir/', 0, '5'),
        header('dir/hello.txt', 5),
        block('hello'),
        header('file.h', 3, '0', 'sys/include'),
        block('abc'),
        header('././@LongLink', long.length + 1, 'L'),
        block(long + '\0'),
        header('trunc', 2),
        block('xy')
    );
    const files = parseTar(tar).map((f) => [f.path, new TextDecoder().decode(f.content)]);
    assert.deepEqual(files, [
        ['dir/hello.txt', 'hello'],
        ['sys/include/file.h', 'abc'],
        [long, 'xy'],
    ]);
});

test('저장소의 Python 파일 시스템을 읽는다', () => {
    const tar = gunzipSync(readFileSync('public/wasm/python-3.11.3.tar.gz'));
    const files = parseTar(new Uint8Array(tar));
    assert.deepEqual(
        files.map((f) => f.path),
        [
            'usr/local/lib/python311.zip',
            'usr/local/lib/python3.11/os.py',
            'usr/local/lib/python3.11/lib-dynload/.empty',
        ]
    );
});
