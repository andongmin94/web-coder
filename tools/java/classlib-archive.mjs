// TeaVM bootstrap 클래스 라이브러리 아카이브(gzip + [u16 nameLen][name][i32 dataLen][data]...) 읽기/쓰기
// 사용법:
//   node classlib-archive.mjs info <archive>
//   node classlib-archive.mjs replace <archive> <out> <entryName> <file>
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

export const readArchive = (gz) => {
    const raw = gunzipSync(gz);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const entries = [];
    let off = 0;
    let trailer = Buffer.alloc(0);
    while (off < raw.length) {
        if (off + 2 > raw.length) {
            trailer = raw.subarray(off);
            break;
        }
        const nameLen = view.getInt16(off);
        if (nameLen <= 0) {
            trailer = raw.subarray(off);
            break;
        }
        const name = raw.subarray(off + 2, off + 2 + nameLen).toString('utf8');
        off += 2 + nameLen;
        const dataLen = view.getInt32(off);
        off += 4;
        entries.push({ name, data: raw.subarray(off, off + dataLen) });
        off += dataLen;
    }
    return { entries, trailer };
};

export const writeArchive = ({ entries, trailer }) => {
    const parts = [];
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const head = Buffer.alloc(2 + nameBuf.length + 4);
        head.writeInt16BE(nameBuf.length, 0);
        nameBuf.copy(head, 2);
        head.writeInt32BE(data.length, 2 + nameBuf.length);
        parts.push(head, Buffer.from(data));
    }
    parts.push(Buffer.from(trailer));
    return gzipSync(Buffer.concat(parts), { level: 9 });
};

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'info') {
    const { entries, trailer } = readArchive(readFileSync(args[0]));
    console.log('entries', entries.length, 'trailer', JSON.stringify([...trailer]));
    for (const e of entries.filter((e) => /TConsoleInputStream|TSystem\.class/.test(e.name))) {
        console.log(e.name, e.data.length, 'classfile major', e.data.readUInt16BE(6));
    }
} else if (cmd === 'put') {
    // put <archive> <out> <entryName>=<file> ... (있으면 교체, 없으면 추가)
    const [input, output, ...pairs] = args;
    const archive = readArchive(readFileSync(input));
    for (const pair of pairs) {
        const [entryName, file] = pair.split('=');
        const data = readFileSync(file);
        const existing = archive.entries.find((e) => e.name === entryName);
        if (existing) existing.data = data;
        else archive.entries.push({ name: entryName, data });
        console.log(existing ? 'replaced' : 'added', entryName, data.length);
    }
    const out = writeArchive(archive);
    if (readArchive(out).entries.length !== archive.entries.length)
        throw new Error('roundtrip mismatch');
    writeFileSync(output, out);
    console.log('->', output, out.length, 'bytes');
} else if (cmd === 'replace') {
    const [input, output, entryName, file] = args;
    const archive = readArchive(readFileSync(input));
    const target = archive.entries.find((e) => e.name === entryName);
    if (!target) throw new Error(`entry not found: ${entryName}`);
    target.data = readFileSync(file);
    // 왕복 검증
    const out = writeArchive(archive);
    const check = readArchive(out);
    if (check.entries.length !== archive.entries.length) throw new Error('roundtrip mismatch');
    writeFileSync(output, out);
    console.log('replaced', entryName, '->', output, out.length, 'bytes');
}
