// 최소 Java class 파일 파서 → 자동완성용 색인 (public 멤버, 제네릭 시그니처 포함)

export type JavaMember = {
    /** 이름 */
    n: string;
    /** 인자 타입 (메서드/생성자) */
    p?: string[];
    /** 반환형 또는 필드 타입 (제네릭 포함, 단순 이름) */
    t: string;
    /** static */
    s?: 1;
    /** 메서드 자체의 타입 매개변수 */
    tp?: string[];
    /** 가변 인자 메서드 (마지막 매개변수가 String... 같은 것) */
    v?: 1;
};

export type JavaClass = {
    /** 단순 이름 (중첩 클래스는 Outer.Inner) */
    n: string;
    /** 상위 클래스 (제네릭 포함, 패키지 포함 이름) */
    sup?: string;
    /** 인터페이스 */
    itf?: string[];
    /** 타입 매개변수 이름 */
    tp?: string[];
    f: JavaMember[];
    m: JavaMember[];
    c: JavaMember[];
    iface?: 1;
};

const ACC_PUBLIC = 0x0001;
const ACC_STATIC = 0x0008;
const ACC_BRIDGE = 0x0040;
/** 메서드의 마지막 매개변수가 가변 인자(...) */
const ACC_VARARGS = 0x0080;
const ACC_SYNTHETIC = 0x1000;
const ACC_INTERFACE = 0x0200;

class Reader {
    private view: DataView;
    private bytes: Uint8Array;
    pos = 0;
    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    u1() {
        return this.view.getUint8(this.pos++);
    }
    u2() {
        const v = this.view.getUint16(this.pos);
        this.pos += 2;
        return v;
    }
    u4() {
        const v = this.view.getUint32(this.pos);
        this.pos += 4;
        return v;
    }
    bytesAt(len: number) {
        const b = this.bytes.subarray(this.pos, this.pos + len);
        this.pos += len;
        return b;
    }
}

const decoder = new TextDecoder();

// ── 시그니처 → 읽기 쉬운 타입 ──────────────────────────────────────────

const PRIMS: Record<string, string> = {
    B: 'byte',
    C: 'char',
    D: 'double',
    F: 'float',
    I: 'int',
    J: 'long',
    S: 'short',
    Z: 'boolean',
    V: 'void',
};

/** JVM 시그니처(제네릭 포함) 하나를 읽어 Java 표기로. 클래스는 패키지 포함 이름 */
const readType = (sig: string, i: { p: number }): string => {
    const ch = sig[i.p];
    if (PRIMS[ch]) {
        i.p++;
        return PRIMS[ch];
    }
    if (ch === '[') {
        i.p++;
        return `${readType(sig, i)}[]`;
    }
    if (ch === 'T') {
        const end = sig.indexOf(';', i.p);
        const name = sig.slice(i.p + 1, end);
        i.p = end + 1;
        return name;
    }
    if (ch === 'L') {
        i.p++;
        let name = '';
        let result = '';
        while (i.p < sig.length) {
            const c = sig[i.p];
            if (c === ';') {
                i.p++;
                break;
            }
            if (c === '<') {
                i.p++;
                const args: string[] = [];
                while (sig[i.p] !== '>') args.push(readTypeArg(sig, i));
                i.p++;
                result += `${name.replaceAll('/', '.')}<${args.join(', ')}>`;
                name = '';
                continue;
            }
            if (c === '.') {
                // 제네릭 바깥 클래스의 중첩 클래스: Outer<T>.Inner
                result += '.';
                i.p++;
                continue;
            }
            name += c;
            i.p++;
        }
        return result + name.replaceAll('/', '.').replaceAll('$', '.');
    }
    throw new Error(`bad signature ${sig} at ${i.p}`);
};

const readTypeArg = (sig: string, i: { p: number }): string => {
    const ch = sig[i.p];
    if (ch === '*') {
        i.p++;
        return '?';
    }
    if (ch === '+') {
        i.p++;
        return `? extends ${readType(sig, i)}`;
    }
    if (ch === '-') {
        i.p++;
        return `? super ${readType(sig, i)}`;
    }
    return readType(sig, i);
};

/** `<K:Ljava/lang/Object;V:...>` → ['K', 'V'] */
const readTypeParams = (sig: string, i: { p: number }): string[] => {
    const names: string[] = [];
    if (sig[i.p] !== '<') return names;
    i.p++;
    while (sig[i.p] !== '>') {
        const colon = sig.indexOf(':', i.p);
        names.push(sig.slice(i.p, colon));
        i.p = colon;
        // 경계: ':' [ClassBound] (':' InterfaceBound)* — 클래스 경계는 비어 있을 수 있습니다.
        while (sig[i.p] === ':') {
            i.p++;
            if (sig[i.p] === 'L' || sig[i.p] === 'T' || sig[i.p] === '[') readType(sig, i);
        }
    }
    i.p++;
    return names;
};

export const parseMethodSignature = (sig: string) => {
    const i = { p: 0 };
    const tp = readTypeParams(sig, i);
    const params: string[] = [];
    i.p++; // (
    while (sig[i.p] !== ')') params.push(readType(sig, i));
    i.p++;
    const ret = readType(sig, i);
    return { tp, params, ret };
};

export const parseFieldSignature = (sig: string) => readType(sig, { p: 0 });

export const parseClassSignature = (sig: string) => {
    const i = { p: 0 };
    const tp = readTypeParams(sig, i);
    const sup = readType(sig, i);
    const itf: string[] = [];
    while (i.p < sig.length) itf.push(readType(sig, i));
    return { tp, sup, itf };
};

// ── class 파일 ───────────────────────────────────────────────────────

export const parseClassFile = (
    bytes: Uint8Array
): (JavaClass & { fqn: string; access: number }) | null => {
    const r = new Reader(bytes);
    if (r.u4() !== 0xcafebabe) return null;
    r.u2();
    r.u2();
    const count = r.u2();
    const utf8: (string | undefined)[] = new Array(count);
    const classRef: (number | undefined)[] = new Array(count);
    for (let idx = 1; idx < count; idx++) {
        const tag = r.u1();
        switch (tag) {
            case 1: {
                const len = r.u2();
                utf8[idx] = decoder.decode(r.bytesAt(len));
                break;
            }
            case 7:
                classRef[idx] = r.u2();
                break;
            case 8:
            case 16:
            case 19:
            case 20:
                r.u2();
                break;
            case 3:
            case 4:
            case 9:
            case 10:
            case 11:
            case 12:
            case 17:
            case 18:
                r.u4();
                break;
            case 5:
            case 6:
                r.u4();
                r.u4();
                idx++;
                break;
            case 15:
                r.u1();
                r.u2();
                break;
            default:
                return null;
        }
    }
    const className = (i: number) => (i ? utf8[classRef[i]!] : undefined);

    const access = r.u2();
    const fqnRaw = className(r.u2())!;
    const superRaw = className(r.u2());
    const itfRaw: string[] = [];
    for (let n = r.u2(); n > 0; n--) itfRaw.push(className(r.u2())!);

    const readAttributes = () => {
        const attrs: Record<string, Uint8Array> = {};
        for (let n = r.u2(); n > 0; n--) {
            const name = utf8[r.u2()]!;
            const len = r.u4();
            attrs[name] = r.bytesAt(len);
        }
        return attrs;
    };
    const signatureOf = (attrs: Record<string, Uint8Array>) => {
        const sig = attrs.Signature;
        return sig ? utf8[(sig[0] << 8) | sig[1]] : undefined;
    };

    const fields: JavaMember[] = [];
    for (let n = r.u2(); n > 0; n--) {
        const acc = r.u2();
        const name = utf8[r.u2()]!;
        const desc = utf8[r.u2()]!;
        const attrs = readAttributes();
        if (!(acc & ACC_PUBLIC) || acc & ACC_SYNTHETIC) continue;
        const t = parseFieldSignature(signatureOf(attrs) ?? desc);
        fields.push({ n: name, t, ...(acc & ACC_STATIC ? { s: 1 as const } : {}) });
    }

    const methods: JavaMember[] = [];
    const ctors: JavaMember[] = [];
    for (let n = r.u2(); n > 0; n--) {
        const acc = r.u2();
        const name = utf8[r.u2()]!;
        const desc = utf8[r.u2()]!;
        const attrs = readAttributes();
        if (!(acc & ACC_PUBLIC) || acc & (ACC_SYNTHETIC | ACC_BRIDGE) || name === '<clinit>')
            continue;
        let sig: ReturnType<typeof parseMethodSignature>;
        try {
            sig = parseMethodSignature(signatureOf(attrs) ?? desc);
        } catch {
            sig = parseMethodSignature(desc);
        }
        const member: JavaMember = {
            n: name,
            p: sig.params,
            t: sig.ret,
            ...(acc & ACC_STATIC ? { s: 1 as const } : {}),
            ...(sig.tp.length ? { tp: sig.tp } : {}),
            ...(acc & ACC_VARARGS ? { v: 1 as const } : {}),
        };
        if (name === '<init>') ctors.push({ ...member, n: '' });
        else methods.push(member);
    }

    const classAttrs = readAttributes();
    const fqn = fqnRaw.replaceAll('/', '.').replaceAll('$', '.');
    const classSig = signatureOf(classAttrs);
    let sup = superRaw?.replaceAll('/', '.').replaceAll('$', '.');
    let itf = itfRaw.map((x) => x.replaceAll('/', '.').replaceAll('$', '.'));
    let tp: string[] = [];
    if (classSig) {
        try {
            const parsed = parseClassSignature(classSig);
            tp = parsed.tp;
            sup = parsed.sup;
            itf = parsed.itf;
        } catch {
            // 시그니처를 못 읽으면 지운(erased) 타입을 씁니다.
        }
    }
    const simple = fqn.slice(fqnRaw.lastIndexOf('/') + 1);
    return {
        fqn,
        access,
        n: simple,
        ...(sup && sup !== 'java.lang.Object' ? { sup } : {}),
        ...(itf.length ? { itf } : {}),
        ...(tp.length ? { tp } : {}),
        f: fields,
        m: methods,
        c: ctors,
        ...(access & ACC_INTERFACE ? { iface: 1 as const } : {}),
    };
};

export type JavaIndex = { classes: Record<string, JavaClass> };

/** SDK 아카이브 항목들 → 색인 (public 최상위/중첩 클래스, 지정한 패키지만) */
export const buildJavaIndex = (
    entries: { name: string; data: Uint8Array }[],
    packages: RegExp = /^java\.(lang|util|io|math|text|time|nio\.charset)(\.|$)/
): JavaIndex => {
    const classes: Record<string, JavaClass> = {};
    for (const { name, data } of entries) {
        if (!name.endsWith('.class') || name.endsWith('module-info.class')) continue;
        const cls = parseClassFile(data);
        if (!cls || !(cls.access & ACC_PUBLIC)) continue;
        const pkg = cls.fqn.slice(0, cls.fqn.length - cls.n.length - 1);
        if (!packages.test(pkg) && !packages.test(cls.fqn)) continue;
        const { fqn, access: _a, ...rest } = cls;
        classes[fqn] = rest;
    }
    return { classes };
};
