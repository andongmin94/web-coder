// BOJ의 Java 8/11/15(javac -release N)처럼, 그 버전에 없는 표준 API를 쓰면 컴파일 에러가 나도록
// javac SDK(public/java/compile-classlib.bin)를 버전별로 걸러 compile-classlib-N.bin을 만듭니다.
//
// JDK의 lib/ct.sym(javac --release가 쓰는 버전별 공개 API 시그니처)과 비교해
//   - 그 버전에 없는 java.*, javax.* 클래스는 빼고
//   - 남은 클래스는 그 버전에 있는 필드·메서드만 남기고, 상위 클래스·인터페이스·제네릭 시그니처를 그 버전 것으로 바꿉니다.
//     (예: Java 11의 List는 SequencedCollection을 상속하지 않고 getFirst()가 없음)
// TeaVM이 구현하지 않은 API는 원래 SDK에도 없으므로 그대로 없습니다.
//
// 사용: node tools/java/release-sdk.mjs <JDK 17 이상의 lib/ct.sym>   (tools/java/build.sh가 실행)
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { readArchive, writeArchive } from './classlib-archive.mjs';

/** BOJ Java 언어 → ct.sym의 버전 글자 (8, 9, A=10, B=11, ...) */
export const RELEASES = { 8: '8', 11: 'B', 15: 'F' };

// ── zip (ct.sym) ─────────────────────────────────────────────────────
export const readZip = (buf) => {
    let eocd = buf.length - 22;
    while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('zip이 아닙니다');
    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const files = new Map();
    for (let i = 0; i < count; i++) {
        const method = buf.readUInt16LE(off + 10);
        const size = buf.readUInt32LE(off + 20);
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const commentLen = buf.readUInt16LE(off + 32);
        const local = buf.readUInt32LE(off + 42);
        const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
        off += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith('/')) continue;
        files.set(name, () => {
            const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
            const data = buf.subarray(start, start + size);
            return method === 0 ? data : inflateRawSync(data);
        });
    }
    return files;
};

// ── class file ───────────────────────────────────────────────────────
export const parseClass = (data) => {
    const b = Buffer.from(data);
    let p = 8;
    const cpCount = b.readUInt16BE(p);
    p += 2;
    const utf8 = [];
    const classRef = [];
    for (let i = 1; i < cpCount; i++) {
        const tag = b[p];
        if (tag === 1) {
            const len = b.readUInt16BE(p + 1);
            utf8[i] = b.toString('utf8', p + 3, p + 3 + len); // 수정 UTF-8이지만 API 이름은 ASCII
            p += 3 + len;
        } else if (tag === 7) {
            classRef[i] = b.readUInt16BE(p + 1);
            p += 3;
        } else if (tag === 5 || tag === 6) {
            p += 9;
            i++;
        } else if (
            tag === 3 ||
            tag === 4 ||
            tag === 9 ||
            tag === 10 ||
            tag === 11 ||
            tag === 12 ||
            tag === 17 ||
            tag === 18
        )
            p += 5;
        else if (tag === 15) p += 4;
        else if (tag === 8 || tag === 16 || tag === 19 || tag === 20) p += 3;
        else throw new Error('알 수 없는 상수 풀 태그 ' + tag);
    }
    const cpEnd = p;
    const className = (index) => (index ? utf8[classRef[index]] : null);
    const access = b.readUInt16BE(p);
    const thisClass = b.readUInt16BE(p + 2);
    const superClass = b.readUInt16BE(p + 4);
    const ifCount = b.readUInt16BE(p + 6);
    p += 8;
    const interfaces = [];
    for (let i = 0; i < ifCount; i++, p += 2) interfaces.push(className(b.readUInt16BE(p)));
    // 메서드는 반환형을 빼고 이름과 인자로 비교합니다. (TeaVM은 공변 반환형이 JDK와 다르기도 함)
    const readMembers = (isMethod) => {
        const n = b.readUInt16BE(p);
        p += 2;
        const list = [];
        for (let i = 0; i < n; i++) {
            const start = p;
            const access = b.readUInt16BE(p);
            const name = utf8[b.readUInt16BE(p + 2)];
            const desc = utf8[b.readUInt16BE(p + 4)];
            const attrs = b.readUInt16BE(p + 6);
            p += 8;
            let signature = null;
            for (let j = 0; j < attrs; j++) {
                if (utf8[b.readUInt16BE(p)] === 'Signature')
                    signature = utf8[b.readUInt16BE(p + 6)];
                p += 6 + b.readUInt32BE(p + 2);
            }
            list.push({
                key: isMethod ? name + desc.slice(0, desc.indexOf(')') + 1) : name,
                raw: b.subarray(start, p),
                access,
                name,
                desc,
                signature,
            });
        }
        return list;
    };
    const membersStart = p;
    const fields = readMembers(false);
    const methods = readMembers(true);
    const membersEnd = p;
    const attrCount = b.readUInt16BE(p);
    p += 2;
    const attributes = [];
    for (let i = 0; i < attrCount; i++) {
        const start = p;
        const name = utf8[b.readUInt16BE(p)];
        const len = b.readUInt32BE(p + 2);
        p += 6 + len;
        attributes.push({
            name,
            raw: b.subarray(start, p),
            value: name === 'Signature' ? utf8[b.readUInt16BE(start + 6)] : null,
        });
    }
    return {
        b,
        cpCount,
        cpEnd,
        access,
        thisClass,
        superName: className(superClass),
        interfaces,
        fields,
        methods,
        attributes,
        membersStart,
        membersEnd,
    };
};

/**
 * 멤버를 걸러 클래스 파일을 다시 씁니다. 상위 타입, 제네릭 시그니처, 속성은 그대로입니다.
 * extra: 숨은 상위 타입에서 내려 받아 이 클래스에 다시 선언할 메서드 (상수 풀 항목은 뒤에 붙임)
 */
const filterMembers = (cls, allowed, extra = []) => {
    const u16 = (v) => {
        const x = Buffer.alloc(2);
        x.writeUInt16BE(v);
        return x;
    };
    const pool = [];
    let count = cls.cpCount;
    const utf8Index = new Map();
    const addUtf8 = (text) => {
        if (utf8Index.has(text)) return utf8Index.get(text);
        const bytes = Buffer.from(text, 'utf8');
        pool.push(Buffer.from([1, bytes.length >> 8, bytes.length & 255]), bytes);
        utf8Index.set(text, count);
        return count++;
    };
    const isInterface = (cls.access & 0x0200) !== 0;
    const copied = extra.map((m) => {
        // 클래스에 붙일 때는 abstract를 뗍니다. (사용자 클래스가 상속해도 구현을 요구하지 않게)
        const access = isInterface ? m.access : m.access & ~0x0400;
        const attrs = m.signature
            ? [
                  u16(1),
                  u16(addUtf8('Signature')),
                  Buffer.from([0, 0, 0, 2]),
                  u16(addUtf8(m.signature)),
              ]
            : [u16(0)];
        return Buffer.concat([u16(access), u16(addUtf8(m.name)), u16(addUtf8(m.desc)), ...attrs]);
    });
    const fields = cls.fields.filter((m) => allowed.has(m.key));
    const methods = cls.methods.filter((m) => allowed.has(m.key));
    const head = Buffer.from(cls.b.subarray(0, 10));
    head.writeUInt16BE(count, 8);
    return Buffer.concat([
        head,
        cls.b.subarray(10, cls.cpEnd),
        ...pool,
        cls.b.subarray(cls.cpEnd, cls.membersStart),
        u16(fields.length),
        ...fields.map((m) => m.raw),
        u16(methods.length + copied.length),
        ...methods.map((m) => m.raw),
        ...copied,
        cls.b.subarray(cls.membersEnd),
    ]);
};

/** ct.sym에서 버전 글자 하나의 클래스 → sig 읽기 함수 */
export const releaseIndex = (zip, letter) => {
    const map = new Map();
    for (const [path, read] of zip) {
        const m = /^([0-9A-Z]+)\/[^/]+\/(.+)\.sig$/.exec(path);
        if (m && m[1].includes(letter)) map.set(m[2], read);
    }
    return map;
};

export const buildReleaseSdk = (archive, zip, letter) => {
    const index = releaseIndex(zip, letter);
    const sigs = new Map();
    const sigOf = (name) => {
        if (!sigs.has(name)) sigs.set(name, index.has(name) ? parseClass(index.get(name)()) : null);
        return sigs.get(name);
    };
    // 그 버전에서 이 클래스로 쓸 수 있는 멤버: 자기와 모든 상위 타입의 것
    // (TeaVM은 메서드를 JDK와 다른 클래스에 선언하기도 해서, 상속받는 것까지 같이 봅니다.)
    const memberCache = new Map();
    const membersOf = (name) => {
        if (memberCache.has(name)) return memberCache.get(name);
        const set = new Set();
        memberCache.set(name, set);
        const sig = sigOf(name);
        if (sig) {
            for (const m of [...sig.fields, ...sig.methods]) set.add(m.key);
            for (const parent of [sig.superName, ...sig.interfaces]) {
                if (parent) for (const key of membersOf(parent)) set.add(key);
            }
        }
        return set;
    };

    const isJdk = (name) => /^javax?\//.test(name);
    const teavm = new Map(
        archive.entries.map((e) => [e.name.replace(/\.class$/, ''), parseClass(e.data)])
    );
    // 그 버전에 없는 JDK 클래스라도 남는 클래스의 상위 타입이면(예: Java 11에서 List의 상위 타입 SequencedCollection)
    // 빼지 않고 숨은 상위 타입으로 둡니다. 멤버는 하위 클래스들이 모두 그 버전에서 쓸 수 있는 것(교집합)만 남깁니다.
    // (TeaVM은 Random.nextInt(int)를 Java 17의 RandomGenerator에 선언하는 식이라, 빼면 그 메서드도 사라짐.
    //  교집합이라 Deque.getFirst()가 SequencedCollection을 거쳐 List에 새어 나가지 않음)
    const allowed = new Map();
    const hidden = new Map();
    const addHidden = (name, keys) => {
        const cls = teavm.get(name);
        if (!cls || !isJdk(name) || sigOf(name)) return;
        const prev = hidden.get(name);
        if (prev) {
            const next = new Set([...prev].filter((k) => keys.has(k)));
            if (next.size === prev.size) return;
            hidden.set(name, next);
            keys = next;
        } else hidden.set(name, new Set(keys));
        for (const parent of [cls.superName, ...cls.interfaces])
            if (parent) addHidden(parent, keys);
    };
    for (const [name, cls] of teavm) {
        if (!isJdk(name) || !sigOf(name)) continue;
        allowed.set(name, membersOf(name));
        for (const parent of [cls.superName, ...cls.interfaces])
            if (parent) addHidden(parent, membersOf(name));
    }
    for (const [name, keys] of hidden) allowed.set(name, keys);

    // 그 버전에서 쓸 수 있는데 숨은 상위 타입에만 선언돼 교집합에서 빠진 메서드는 이 클래스에 다시 선언합니다.
    // (예: TeaVM의 Deque.getFirst()는 SequencedCollection에만 있음)
    const visibleCache = new Map();
    const visible = (name) => {
        if (visibleCache.has(name)) return visibleCache.get(name);
        const set = new Set();
        visibleCache.set(name, set);
        const cls = teavm.get(name);
        if (!cls) return set;
        const keys = allowed.get(name);
        for (const m of [...cls.fields, ...cls.methods])
            if (!isJdk(name) || (keys && keys.has(m.key))) set.add(m.key);
        for (const parent of [cls.superName, ...cls.interfaces])
            if (parent) for (const k of visible(parent)) set.add(k);
        return set;
    };
    const declaredAbove = (name, key, seen = new Set()) => {
        const cls = teavm.get(name);
        if (!cls || seen.has(name)) return null;
        seen.add(name);
        for (const parent of [cls.superName, ...cls.interfaces]) {
            const p = parent && teavm.get(parent);
            if (!p) continue;
            const m = p.methods.find(
                (x) => x.key === key && !(x.access & 0x0008) && !x.name.startsWith('<')
            );
            if (m) return m;
            const deeper = declaredAbove(parent, key, seen);
            if (deeper) return deeper;
        }
        return null;
    };
    const extras = new Map();
    for (const [name] of teavm) {
        if (!isJdk(name) || !sigOf(name)) continue;
        const have = visible(name);
        const add = [];
        for (const key of membersOf(name)) {
            if (have.has(key) || !key.includes('(')) continue;
            const m = declaredAbove(name, key);
            if (m) add.push(m);
        }
        if (add.length) extras.set(name, add);
    }

    const entries = [];
    for (const entry of archive.entries) {
        const name = entry.name.replace(/\.class$/, '');
        if (!isJdk(name)) entries.push(entry);
        else if (allowed.has(name))
            entries.push({
                name: entry.name,
                data: filterMembers(teavm.get(name), allowed.get(name), extras.get(name)),
            });
    }
    return { entries, trailer: archive.trailer };
};

if (process.argv[1]?.endsWith('release-sdk.mjs')) {
    const [ctSym] = process.argv.slice(2);
    if (!ctSym) {
        console.error('사용: node tools/java/release-sdk.mjs <JDK의 lib/ct.sym>');
        process.exit(1);
    }
    const zip = readZip(readFileSync(ctSym));
    const archive = readArchive(readFileSync('public/java/compile-classlib.bin'));
    for (const [release, letter] of Object.entries(RELEASES)) {
        const sdk = buildReleaseSdk(archive, zip, letter);
        const out = `public/java/compile-classlib-${release}.bin`;
        writeFileSync(out, writeArchive(sdk));
        console.log(out, sdk.entries.length, '/', archive.entries.length, '클래스');
    }
}
