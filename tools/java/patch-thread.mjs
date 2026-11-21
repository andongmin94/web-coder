// public/java/의 클래스 라이브러리에 ThreadGroup을 받는 Thread 생성자를 추가합니다.
//
//   new Thread(null, runnable, "", 1 << 26).start();
//
// 는 Java 풀이에서 재귀 깊이를 늘릴 때 흔히 쓰는 관용구인데, TeaVM의 Thread에는 이 생성자가 없어
// 컴파일 에러가 납니다. (스택 크기 인자는 무시합니다. 깊은 재귀는 src/runner/deep-stack.ts가 처리)
//
// JDK 없이 클래스 파일을 직접 고칩니다. 여러 번 실행해도 결과가 같습니다.
// 사용: node tools/java/patch-thread.mjs   (tools/java/build.sh가 마지막에 실행)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchive, writeArchive } from './classlib-archive.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const u2 = (n) => [(n >> 8) & 255, n & 255];
const u4 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const utf8 = (text) => {
    const bytes = Buffer.from(text, 'utf8');
    return [1, ...u2(bytes.length), ...bytes];
};

const ACC_PUBLIC = 0x0001;
const ACC_SUPER = 0x0020;

/** 상수 풀과 메서드 목록의 위치를 읽습니다. */
const parseClass = (data) => {
    const b = Buffer.from(data);
    let p = 8;
    const count = b.readUInt16BE(p);
    p += 2;
    const pool = [null];
    for (let i = 1; i < count; i++) {
        const tag = b[p++];
        if (tag === 1) {
            const length = b.readUInt16BE(p);
            pool[i] = { tag, text: b.subarray(p + 2, p + 2 + length).toString('utf8') };
            p += 2 + length;
        } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) {
            pool[i] = { tag, a: b.readUInt16BE(p) };
            p += 2;
        } else if (
            tag === 9 ||
            tag === 10 ||
            tag === 11 ||
            tag === 12 ||
            tag === 17 ||
            tag === 18
        ) {
            pool[i] = { tag, a: b.readUInt16BE(p), b: b.readUInt16BE(p + 2) };
            p += 4;
        } else if (tag === 3 || tag === 4) {
            pool[i] = { tag };
            p += 4;
        } else if (tag === 5 || tag === 6) {
            pool[i] = { tag };
            pool[++i] = null;
            p += 8;
        } else if (tag === 15) {
            pool[i] = { tag };
            p += 3;
        } else {
            throw new Error(`알 수 없는 상수 풀 태그 ${tag}`);
        }
    }
    const poolEnd = p;
    const thisClass = b.readUInt16BE(p + 2);
    p += 6;
    p += 2 + b.readUInt16BE(p) * 2; // 인터페이스
    const skipAttributes = () => {
        for (let n = b.readUInt16BE(p), i = ((p += 2), 0); i < n; i++)
            p += 6 + b.readUInt32BE(p + 2);
    };
    for (let n = b.readUInt16BE(p), i = ((p += 2), 0); i < n; i++) {
        p += 6;
        skipAttributes();
    }
    const methodCountAt = p;
    const methods = [];
    for (let n = b.readUInt16BE(p), i = ((p += 2), 0); i < n; i++) {
        methods.push({
            name: pool[b.readUInt16BE(p + 2)].text,
            desc: pool[b.readUInt16BE(p + 4)].text,
        });
        p += 6;
        skipAttributes();
    }
    return { b, pool, poolEnd, thisClass, methodCountAt, methodsEnd: p, methods };
};

/**
 * 클래스에 생성자를 추가합니다.
 * ctors: [{ desc, target, args }] — target이 있으면 인자 args(지역 변수 번호)를 넘겨 그 생성자를 부르는
 * 본문을 만들고, 없으면 시그니처만 넣습니다. (javac SDK용)
 */
const addConstructors = (data, ctors) => {
    const cls = parseClass(data);
    const missing = ctors.filter(
        (c) => !cls.methods.some((m) => m.name === '<init>' && m.desc === c.desc)
    );
    if (missing.length === 0) return data;

    const added = [];
    let next = cls.pool.length;
    const add = (bytes) => {
        added.push(...bytes);
        return next++;
    };
    const findUtf8 = (text) => cls.pool.findIndex((e) => e && e.tag === 1 && e.text === text);
    const utf8Index = (text) => {
        const found = findUtf8(text);
        return found > 0 ? found : add(utf8(text));
    };
    const init = utf8Index('<init>');

    const methodBytes = [];
    for (const ctor of missing) {
        const desc = add(utf8(ctor.desc));
        if (!ctor.target) {
            methodBytes.push(...u2(ACC_PUBLIC), ...u2(init), ...u2(desc), ...u2(0));
            continue;
        }
        const nameAndType = add([12, ...u2(init), ...u2(utf8Index(ctor.target))]);
        const methodRef = add([10, ...u2(cls.thisClass), ...u2(nameAndType)]);
        // aload_0; aload <n>...; invokespecial this(...); return
        const code = [0x2a, ...ctor.args.flatMap((n) => [0x19, n]), 0xb7, ...u2(methodRef), 0xb1];
        const attribute = [
            ...u2(1 + ctor.args.length), // max_stack
            ...u2(ctor.locals),
            ...u4(code.length),
            ...code,
            ...u2(0), // 예외 테이블
            ...u2(0), // 속성
        ];
        methodBytes.push(
            ...u2(ACC_PUBLIC),
            ...u2(init),
            ...u2(desc),
            ...u2(1),
            ...u2(utf8Index('Code')),
            ...u4(attribute.length),
            ...attribute
        );
    }

    const { b } = cls;
    const out = Buffer.concat([
        b.subarray(0, 8),
        Buffer.from(u2(next)),
        b.subarray(10, cls.poolEnd),
        Buffer.from(added),
        b.subarray(cls.poolEnd, cls.methodCountAt),
        Buffer.from(u2(cls.methods.length + missing.length)),
        b.subarray(cls.methodCountAt + 2, cls.methodsEnd),
        Buffer.from(methodBytes),
        b.subarray(cls.methodsEnd),
    ]);
    parseClass(out); // 다시 읽어 구조가 맞는지 확인
    return out;
};

/** public class <name> extends <superName> { public <name>(String name) {} } */
const stubClass = (name, superName, withCode) => {
    const pool = [
        utf8(name), // 1
        [7, ...u2(1)], // 2: this
        utf8(superName), // 3
        [7, ...u2(3)], // 4: super
        utf8('<init>'), // 5
        utf8('(Ljava/lang/String;)V'), // 6
        utf8('()V'), // 7
        [12, ...u2(5), ...u2(7)], // 8
        [10, ...u2(4), ...u2(8)], // 9: super.<init>()
        utf8('Code'), // 10
    ];
    const code = [0x2a, 0xb7, ...u2(9), 0xb1];
    const attribute = [...u2(1), ...u2(2), ...u4(code.length), ...code, ...u2(0), ...u2(0)];
    const method = withCode
        ? [
              ...u2(ACC_PUBLIC),
              ...u2(5),
              ...u2(6),
              ...u2(1),
              ...u2(10),
              ...u4(attribute.length),
              ...attribute,
          ]
        : [...u2(ACC_PUBLIC), ...u2(5), ...u2(6), ...u2(0)];
    return Buffer.from([
        0xca,
        0xfe,
        0xba,
        0xbe,
        ...u2(0),
        ...u2(61), // Java 17 (원본 클래스 라이브러리와 같음)
        ...u2(pool.length + 1),
        ...pool.flat(),
        ...u2(ACC_PUBLIC | ACC_SUPER),
        ...u2(2),
        ...u2(4),
        ...u2(0), // 인터페이스
        ...u2(0), // 필드
        ...u2(1),
        ...method,
        ...u2(0), // 속성
    ]);
};

const patchArchive = (file, threadEntry, groupEntry, groupClass, ctors) => {
    const path = resolve(ROOT, file);
    const archive = readArchive(readFileSync(path));
    const thread = archive.entries.find((e) => e.name === threadEntry);
    if (!thread) throw new Error(`${file}: ${threadEntry} 없음`);
    const patched = addConstructors(thread.data, ctors);
    const hasGroup = archive.entries.some((e) => e.name === groupEntry);
    if (patched === thread.data && hasGroup) {
        console.log(`${file}: 이미 적용됨`);
        return;
    }
    thread.data = patched;
    if (!hasGroup) archive.entries.push({ name: groupEntry, data: groupClass });
    writeFileSync(path, writeArchive(archive));
    console.log(`${file}: Thread 생성자 ${ctors.length}개, ${groupEntry}`);
};

// javac가 보는 시그니처 (본문 없음)
const G = 'Ljava/lang/ThreadGroup;';
const R = 'Ljava/lang/Runnable;';
const S = 'Ljava/lang/String;';
patchArchive(
    'public/java/compile-classlib.bin',
    'java/lang/Thread.class',
    'java/lang/ThreadGroup.class',
    stubClass('java/lang/ThreadGroup', 'java/lang/Object', false),
    [
        { desc: `(${G}${R})V` },
        { desc: `(${G}${S})V` },
        { desc: `(${G}${R}${S})V` },
        { desc: `(${G}${R}${S}J)V` },
    ]
);

// TeaVM이 실행하는 구현: 스레드 그룹과 스택 크기는 버리고 기존 생성자를 부릅니다.
// (TeaVM 클래스 라이브러리 안에서는 java.lang.X를 org.teavm.classlib.java.lang.TX로 씁니다)
const TG = 'Lorg/teavm/classlib/java/lang/TThreadGroup;';
const TR = 'Lorg/teavm/classlib/java/lang/TRunnable;';
patchArchive(
    'public/java/runtime-classlib.bin',
    'org/teavm/classlib/java/lang/TThread.class',
    'org/teavm/classlib/java/lang/TThreadGroup.class',
    stubClass(
        'org/teavm/classlib/java/lang/TThreadGroup',
        'org/teavm/classlib/java/lang/TObject',
        true
    ),
    [
        { desc: `(${TG}${TR})V`, target: `(${TR})V`, args: [2], locals: 3 },
        { desc: `(${TG}${S})V`, target: `(${S})V`, args: [2], locals: 3 },
        { desc: `(${TG}${TR}${S})V`, target: `(${TR}${S})V`, args: [2, 3], locals: 4 },
        { desc: `(${TG}${TR}${S}J)V`, target: `(${TR}${S})V`, args: [2, 3], locals: 6 },
    ]
);
