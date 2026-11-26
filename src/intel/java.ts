// Java 인텔리센스
// - 실시간 진단: sandbox의 javac (WebAssembly 생성 없이 javac만)
// - 자동완성/시그니처/호버: JDK 색인(SDK 클래스 시그니처) + 소스의 선언을 보고 타입을 추론
//   예) Scanner sc → sc. → nextInt…, List<Integer> list → list.get(0). → Integer 멤버
import type { JavaClass, JavaIndex, JavaMember } from './classfile.ts';
import { blankLiterals } from '../shared/source-text.ts';
import {
    enclosingClasses,
    parseUserClasses,
    splitTop,
    TYPE,
    type UserClass,
} from './java-source.ts';
import {
    wordStart,
    type IntelCompletion,
    type IntelSignature,
    type LanguageIntel,
} from './types.ts';

const KEYWORDS = (
    'abstract boolean break byte case catch char class continue default do double else enum extends final finally ' +
    'float for if implements import instanceof int interface long new null package private protected public return ' +
    'short static super switch this throw throws try void while var true false record'
).split(' ');

/** IntelliJ식 라이브 템플릿 */
const TEMPLATES: IntelCompletion[] = [
    {
        label: 'sout',
        kind: 'snippet',
        detail: 'System.out.println',
        apply: 'System.out.println(${});',
    },
    {
        label: 'fori',
        kind: 'snippet',
        detail: 'for (int i = 0; i < n; i++)',
        apply: 'for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}',
    },
    {
        label: 'br',
        kind: 'snippet',
        detail: 'BufferedReader 입력',
        apply: 'BufferedReader br = new BufferedReader(new InputStreamReader(System.in));',
    },
    {
        label: 'st',
        kind: 'snippet',
        detail: 'StringTokenizer 한 줄',
        apply: 'StringTokenizer st = new StringTokenizer(br.readLine());',
    },
    {
        label: 'pint',
        kind: 'snippet',
        detail: 'Integer.parseInt(st.nextToken())',
        apply: 'Integer.parseInt(st.nextToken())',
    },
    {
        label: 'sb',
        kind: 'snippet',
        detail: 'StringBuilder 출력',
        apply: 'StringBuilder sb = new StringBuilder();',
    },
    {
        label: 'psvm',
        kind: 'snippet',
        detail: 'main 메서드',
        apply: 'public static void main(String[] args) throws IOException {\n\t${}\n}',
    },
];

const PRIMITIVES = new Set([
    'int',
    'long',
    'double',
    'float',
    'boolean',
    'char',
    'byte',
    'short',
    'void',
]);

/** 패키지 접두어를 지운 짧은 표기: java.util.List<java.lang.Integer> → List<Integer> */
export const shortType = (t: string) => t.replace(/\b(?:[a-z_]\w*\.)+(?=[A-Z])/g, '');

type TypeRef = { name: string; args: string[]; dims: number };

export const parseTypeRef = (text: string): TypeRef => {
    let t = text.trim().replace(/\s+/g, ' ');
    let dims = 0;
    while (t.endsWith('[]')) {
        dims++;
        t = t.slice(0, -2).trim();
    }
    if (t.endsWith('...')) {
        dims++;
        t = t.slice(0, -3);
    }
    const lt = t.indexOf('<');
    if (lt < 0) return { name: t.replace(/^\? (extends|super) /, ''), args: [], dims };
    return {
        name: t.slice(0, lt).replace(/^\? (extends|super) /, ''),
        args: splitTop(t.slice(lt + 1, t.lastIndexOf('>'))),
        dims,
    };
};

const formatType = (ref: TypeRef) =>
    `${ref.name}${ref.args.length ? `<${ref.args.join(', ')}>` : ''}${'[]'.repeat(ref.dims)}`;

/** 타입 문자열의 타입 변수를 바꿉니다: E → Integer */
const substitute = (type: string, map: Record<string, string>) =>
    Object.keys(map).length ? type.replace(/\b[A-Z]\w*\b/g, (m) => map[m] ?? m) : type;

// ── 소스 분석 ────────────────────────────────────────────────────────

const TYPE_RE = TYPE;
/** 선언 앞에 붙는 수식어 (static int[] arr 처럼 필드에 흔함) */
const MODIFIERS_RE = String.raw`(?:(?:public|private|protected|static|final|volatile|transient)\s+)*`;
/** `int n, m;` `int a = 1, b;` 에서 첫 이름 뒤에 이어지는 이름들 */
const MORE_NAMES_RE =
    /^(?:\s*\[\s*\])*(?:\s*=[^,;(){}]*)?((?:\s*,\s*[A-Za-z_]\w*(?:\s*\[\s*\])*(?:\s*=[^,;(){}]*)?)+)\s*;/;
const DECL_RE = new RegExp(
    String.raw`(?:^|[;{}(,])\s*${MODIFIERS_RE}(${TYPE_RE})\s+([A-Za-z_]\w*)\s*(?=[=;,):\[])`,
    'gm'
);

/** pos 이전에 보이는 변수/필드/매개변수 선언: 이름 → 타입 (나중 선언이 이김) */
export const declarations = (code: string, pos: number) => {
    const vars = new Map<string, string>();
    // 필드(클래스 본문)는 위치와 상관없이 보이므로 전체에서, 지역 변수는 pos 이전까지 봅니다.
    // 주석·문자열 안의 글자는 선언으로 보지 않습니다. (위치가 같은 공백으로 바꾼 글에서 찾음)
    const scan = (text: string) => {
        const blank = blankLiterals(text);
        for (const m of blank.matchAll(DECL_RE)) {
            const [, type, name] = m;
            if (KEYWORDS.includes(type) && !PRIMITIVES.has(type) && type !== 'var') continue;
            if (/^(return|new|throw|else|case|import|package)$/.test(type)) continue;
            let resolved = type;
            if (type === 'var') {
                // var x = new Foo<...>(...) / var x = "..."
                const rest = text.slice(m.index! + m[0].length);
                const init = /^\s*=\s*(new\s+([\w.]+(?:\s*<[^;]*?>)?)|"[^"]*")/.exec(rest);
                if (!init) continue;
                resolved = init[2] ? init[2].replace(/<\s*>$/, '') : 'String';
            }
            vars.set(name, resolved);
            // 같은 타입으로 이어서 선언한 이름들
            const more = MORE_NAMES_RE.exec(blank.slice(m.index! + m[0].length));
            if (more && type !== 'var') {
                for (const part of more[1].split(',')) {
                    const other = /^\s*([A-Za-z_]\w*)((?:\s*\[\s*\])*)/.exec(part);
                    if (other) vars.set(other[1], type + other[2].replace(/\s+/g, ''));
                }
            }
        }
        for (const m of blank.matchAll(
            new RegExp(String.raw`for\s*\(\s*(?:final\s+)?(${TYPE_RE})\s+([A-Za-z_]\w*)\s*:`, 'g')
        )) {
            vars.set(m[2], m[1]);
        }
    };
    scan(code.slice(0, pos));
    return vars;
};

const importsOf = (code: string) => {
    const packages = new Set(['java.lang']);
    const classes = new Map<string, string>();
    for (const m of code.matchAll(/^\s*import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;/gm)) {
        if (m[1]) continue;
        if (m[3]) packages.add(m[2]);
        else classes.set(m[2].slice(m[2].lastIndexOf('.') + 1), m[2]);
    }
    return { packages, classes };
};

// ── 엔진 ─────────────────────────────────────────────────────────────

let lastContext: { index: JavaIndex; code: string; merged: JavaIndex; user: UserClass[] } | null =
    null;

/** 분석 컨텍스트: JDK 색인에 사용자 클래스를 얹고, 둘러싼 클래스의 필드를 변수로 더합니다. */
const createContext = (index: JavaIndex, code: string, pos: number, varsUntil: number): Ctx => {
    if (!lastContext || lastContext.index !== index || lastContext.code !== code) {
        const user = parseUserClasses(code);
        const classes = { ...index.classes };
        for (const cls of user) classes[cls.n] = cls;
        lastContext = { index, code, merged: { classes }, user };
    }
    const { merged, user } = lastContext;
    const vars = declarations(code, varsUntil);
    // 커서보다 아래에 선언된 필드도 보이게 합니다.
    for (const cls of enclosingClasses(user, pos))
        for (const field of cls.f) if (!vars.has(field.n)) vars.set(field.n, field.t);
    return { index: merged, user, code, pos, vars, imports: importsOf(code) };
};

/** 수신 객체 없이 부른 메서드: 둘러싼 클래스의 것부터, 없으면 소스의 아무 클래스에서 */
const userMethods = (ctx: Ctx, name?: string) => {
    const enclosing = enclosingClasses(ctx.user, ctx.pos);
    const ordered = [...enclosing, ...ctx.user.filter((c) => !enclosing.includes(c))];
    const seen = new Set<string>();
    const result: (JavaMember & { owner: string })[] = [];
    for (const cls of ordered) {
        for (const method of cls.m) {
            if (name !== undefined && method.n !== name) continue;
            const key = `${method.n}(${(method.p ?? []).join(',')})`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({ ...method, owner: cls.n });
        }
        // 이름으로 찾을 때는 가장 가까운 클래스의 것만
        if (name !== undefined && result.length) break;
    }
    return result;
};

/** 풀이에서 자주 쓰는 클래스 (전역 목록에서 위로) */
const COMMON_CLASSES = new Set(
    (
        'String StringBuilder Integer Long Double Character Boolean Math System Object ' +
        'Scanner BufferedReader BufferedWriter InputStreamReader OutputStreamWriter PrintWriter StringTokenizer ' +
        'IOException List ArrayList LinkedList Map HashMap TreeMap LinkedHashMap Set HashSet TreeSet LinkedHashSet ' +
        'Queue Deque ArrayDeque PriorityQueue Stack Arrays Collections Comparator Iterator Random BigInteger BigDecimal'
    ).split(' ')
);

type Ctx = {
    /** JDK 색인 + 사용자 소스의 클래스 */
    index: JavaIndex;
    /** 사용자 소스에 선언된 클래스 */
    user: UserClass[];
    code: string;
    pos: number;
    vars: Map<string, string>;
    imports: ReturnType<typeof importsOf>;
};

const resolveClass = (ctx: Ctx, name: string): string | null => {
    const { classes } = ctx.index;
    if (classes[name]) return name;
    const head = name.split('.')[0];
    const tail = name.slice(head.length);
    const explicit = ctx.imports.classes.get(head);
    if (explicit && classes[explicit + tail]) return explicit + tail;
    for (const pkg of ctx.imports.packages) if (classes[`${pkg}.${name}`]) return `${pkg}.${name}`;
    // import를 아직 안 쓴 경우: 이름이 하나뿐이면 그것으로
    const candidates = bySimpleName(ctx.index).get(name) ?? [];
    return candidates.length === 1 ? candidates[0] : null;
};

/**
 * 끝 이름 → 그 이름으로 끝나는 전체 이름들 ("List" → java.util.List, java.awt.List).
 * resolveClass가 타입을 풀 때마다 전체 색인을 훑지 않도록 색인(코드가 바뀔 때마다 새로 만듦)마다 한 번 만듭니다.
 */
const simpleNames = new WeakMap<JavaIndex, Map<string, string[]>>();
const bySimpleName = (index: JavaIndex) => {
    let map = simpleNames.get(index);
    if (!map) {
        map = new Map();
        for (const fqn of Object.keys(index.classes)) {
            // a.b.Outer.Inner는 Inner와 Outer.Inner 둘 다로 찾을 수 있게
            const parts = fqn.split('.');
            for (let i = 1; i < parts.length; i++) {
                const tail = parts.slice(i).join('.');
                const list = map.get(tail);
                if (list) list.push(fqn);
                else map.set(tail, [fqn]);
            }
        }
        simpleNames.set(index, map);
    }
    return map;
};

const BOXED: Record<string, string> = {
    int: 'Integer',
    long: 'Long',
    double: 'Double',
    float: 'Float',
    boolean: 'Boolean',
    char: 'Character',
    byte: 'Byte',
    short: 'Short',
};

type Members = {
    fields: (JavaMember & { owner: string })[];
    methods: (JavaMember & { owner: string })[];
};

/** 클래스와 상위 타입의 멤버 (타입 인자 치환 포함) */
const membersOf = (ctx: Ctx, typeText: string, seen = new Set<string>()): Members => {
    const ref = parseTypeRef(typeText);
    const out: Members = { fields: [], methods: [] };
    if (ref.dims > 0) {
        out.fields.push({ n: 'length', t: 'int', owner: 'array' });
        out.methods.push({ n: 'clone', p: [], t: typeText, owner: 'array' });
        return out;
    }
    const fqn = resolveClass(ctx, ref.name);
    if (!fqn || seen.has(fqn)) return out;
    seen.add(fqn);
    const cls: JavaClass = ctx.index.classes[fqn];
    const map: Record<string, string> = {};
    (cls.tp ?? []).forEach((tp, i) => (map[tp] = ref.args[i] ?? 'Object'));
    for (const f of cls.f) out.fields.push({ ...f, t: substitute(f.t, map), owner: cls.n });
    for (const m of cls.m) {
        out.methods.push({
            ...m,
            t: substitute(m.t, map),
            p: m.p?.map((p) => substitute(p, map)),
            owner: cls.n,
        });
    }
    for (const parent of [cls.sup, ...(cls.itf ?? [])]) {
        if (!parent) continue;
        const inherited = membersOf(ctx, substitute(parent, map), seen);
        out.fields.push(...inherited.fields);
        out.methods.push(...inherited.methods);
    }
    if (!cls.sup && !cls.iface && fqn !== 'java.lang.Object') {
        const obj = membersOf(ctx, 'java.lang.Object', seen);
        out.methods.push(...obj.methods);
    }
    return out;
};

/** 수신 식의 텍스트: `list.get(i).` 에서 점 앞의 `list.get(i)` */
const receiverBefore = (code: string, dot: number) => {
    let i = dot;
    let depth = 0;
    while (i > 0) {
        const ch = code[i - 1];
        if (ch === ')' || ch === ']' || ch === '>') depth++;
        else if (ch === '(' || ch === '[' || ch === '<') {
            if (depth === 0) break;
            depth--;
        } else if (depth === 0 && !/[\w$.\s"]/.test(ch)) break;
        else if (depth === 0 && /\s/.test(ch) && !/new\s*$/.test(code.slice(0, i))) {
            // `new Foo()` 의 공백은 이어 붙이고, 그 외 공백은 식의 경계
            if (!/^\s*\./.test(code.slice(i - 1, dot))) break;
        }
        i--;
    }
    let text = code.slice(i, dot).trim();
    const newAt = code.slice(Math.max(0, i - 4), i);
    if (/new\s$/.test(newAt)) text = `new ${text}`;
    return text;
};

type Resolved = { type: string; isStatic: boolean } | null;

/** 식의 타입 추론 (지원: 변수, 클래스명(static), new, 문자열 리터럴, 메서드 호출 체인, 필드, 배열 인덱스) */
const typeOf = (ctx: Ctx, expr: string): Resolved => {
    const segments = splitTop(expr, '.');
    if (!segments.length) return null;
    let current: Resolved;
    let first = segments.shift()!;
    if (/^new\s/.test(first)) {
        const m = /^new\s+([\w.]+)\s*(<[^(]*>)?\s*\(/.exec(first);
        if (!m) return null;
        const args = m[2] && m[2] !== '<>' ? m[2] : '';
        current = { type: `${m[1]}${args}`, isStatic: false };
    } else if (/^"/.test(first)) {
        current = { type: 'String', isStatic: false };
    } else {
        // 앞부분이 패키지/중첩 클래스일 수 있음: Map.Entry, java.util.List
        let index = 0;
        const arr = /^(\w+)((?:\[[^\]]*\])+)$/.exec(first);
        const name = arr ? arr[1] : first;
        const declared = ctx.vars.get(name);
        const ownCall = /^(\w+)\s*\((.*)\)((?:\[[^\]]*\])*)$/s.exec(first);
        const self = enclosingClasses(ctx.user, ctx.pos)[0];
        if (name === 'this' && self) {
            current = { type: self.n, isStatic: false };
        } else if (ownCall && userMethods(ctx, ownCall[1]).length) {
            // solve(1, 2). 처럼 같은 클래스의 메서드를 부른 결과
            const arity = ownCall[2].trim() ? splitTop(ownCall[2]).length : 0;
            const candidates = userMethods(ctx, ownCall[1]);
            const method = candidates.find((m) => (m.p?.length ?? 0) === arity) ?? candidates[0];
            const ref = parseTypeRef(method.t);
            ref.dims = Math.max(0, ref.dims - (ownCall[3].match(/\[/g) ?? []).length);
            const type = formatType(ref);
            current = {
                type: PRIMITIVES.has(type) ? (BOXED[type] ?? type) : type,
                isStatic: false,
            };
        } else if (declared) {
            const ref = parseTypeRef(declared);
            ref.dims = Math.max(0, ref.dims - (arr ? (arr[2].match(/\[/g) ?? []).length : 0));
            current = { type: formatType(ref), isStatic: false };
        } else {
            let className = name;
            while (!resolveClass(ctx, className) && index < segments.length)
                className += `.${segments[index++]}`;
            if (!resolveClass(ctx, className)) return null;
            segments.splice(0, index);
            current = { type: className, isStatic: true };
        }
        first = '';
    }
    for (const seg of segments) {
        if (!current) return null;
        const call = /^(\w+)\s*\((.*)\)((?:\[[^\]]*\])*)$/s.exec(seg);
        const field = /^(\w+)((?:\[[^\]]*\])*)$/.exec(seg);
        if (!call && !field) return null;
        const members = membersOf(ctx, current.type);
        let next: string | undefined;
        if (call) {
            const arity = call[2].trim() ? splitTop(call[2]).length : 0;
            const candidates = members.methods.filter((m) => m.n === call[1]);
            next = (candidates.find((m) => (m.p?.length ?? 0) === arity) ?? candidates[0])?.t;
        } else {
            next = members.fields.find((f) => f.n === field![1])?.t;
            if (!next) {
                // 중첩 클래스 접근: Map.Entry
                const nested: string = `${current.type}.${field![1]}`;
                if (resolveClass(ctx, nested)) {
                    current = { type: nested, isStatic: true };
                    continue;
                }
            }
        }
        if (!next) return null;
        const bracket = (call?.[3] ?? field?.[2] ?? '').match(/\[/g)?.length ?? 0;
        const ref = parseTypeRef(next);
        ref.dims = Math.max(0, ref.dims - bracket);
        // 메서드 자신의 타입 변수(T 등)나 와일드카드는 Object로
        let type = formatType(ref).replace(/\? (extends|super) /g, '');
        if (/^[A-Z]$/.test(parseTypeRef(type).name) && !resolveClass(ctx, parseTypeRef(type).name))
            type = 'Object';
        if (PRIMITIVES.has(type)) type = BOXED[type] ?? type;
        current = { type, isStatic: false };
    }
    return current;
};

const methodLabel = (m: JavaMember) => `${m.n}(${(m.p ?? []).map(shortType).join(', ')})`;

const toItems = (members: Members, wantStatic: boolean): IntelCompletion[] => {
    const items = new Map<string, IntelCompletion & { overloads: number }>();
    for (const f of members.fields) {
        if (Boolean(f.s) !== wantStatic || items.has(f.n)) continue;
        items.set(f.n, {
            label: f.n,
            kind: f.s && /^[A-Z_]+$/.test(f.n) ? 'constant' : 'field',
            detail: shortType(f.t),
            overloads: 1,
            boost: 2,
        });
    }
    for (const m of members.methods) {
        if (Boolean(m.s) !== wantStatic) continue;
        const existing = items.get(m.n);
        if (existing) {
            existing.overloads++;
            continue;
        }
        const params = m.p ?? [];
        items.set(m.n, {
            label: m.n,
            kind: 'method',
            detail: `(${params.map(shortType).join(', ')}) → ${shortType(m.t)}`,
            // 인자가 있으면 괄호 안에 커서를 두고 시그니처 힌트로 안내합니다.
            apply: params.length ? `${m.n}(\${})` : `${m.n}()`,
            overloads: 1,
            // Object 기본 메서드는 아래로
            boost: m.owner === 'Object' ? -2 : 1,
        });
    }
    return [...items.values()].map(({ overloads, ...item }) =>
        overloads > 1 ? { ...item, detail: `${item.detail}  (+${overloads - 1})` } : item
    );
};

export const javaComplete = (index: JavaIndex, code: string, pos: number, explicit: boolean) => {
    const from = wordStart(code, pos);
    const ctx = createContext(index, code, pos, from);
    const { vars } = ctx;
    const dot = code.slice(0, from).trimEnd();
    if (dot.endsWith('.')) {
        const receiver = receiverBefore(code, dot.length - 1);
        const resolved = typeOf(ctx, receiver);
        if (!resolved) return null;
        return { from, items: toItems(membersOf(ctx, resolved.type), resolved.isStatic) };
    }
    if (!explicit && pos - from < 1) return null;
    const items: IntelCompletion[] = [];
    for (const [name, type] of vars)
        items.push({ label: name, kind: 'variable', detail: shortType(type), boost: 3 });
    // 직접 만든 메서드 (같은 이름은 하나로)
    const methodItems = new Map<string, IntelCompletion & { overloads: number }>();
    for (const m of userMethods(ctx)) {
        const existing = methodItems.get(m.n);
        if (existing) {
            existing.overloads++;
            continue;
        }
        const params = m.p ?? [];
        methodItems.set(m.n, {
            label: m.n,
            kind: 'function',
            detail: `(${params.join(', ')}) → ${m.t}`,
            apply: params.length ? `${m.n}(\${})` : `${m.n}()`,
            boost: 3,
            overloads: 1,
        });
    }
    for (const { overloads, ...item } of methodItems.values())
        items.push(
            overloads > 1 ? { ...item, detail: `${item.detail}  (+${overloads - 1})` } : item
        );
    for (const t of TEMPLATES) items.push({ ...t, boost: 1 });
    for (const kw of KEYWORDS) items.push({ label: kw, kind: 'keyword' });
    const seenClass = new Set<string>();
    // 직접 만든 클래스
    for (const cls of ctx.user) {
        if (seenClass.has(cls.n)) continue;
        seenClass.add(cls.n);
        items.push({ label: cls.n, kind: cls.iface ? 'type' : 'class', boost: 3 });
    }
    for (const fqn of Object.keys(index.classes)) {
        const pkg = fqn.slice(0, fqn.lastIndexOf('.'));
        const cls = index.classes[fqn];
        if (cls.n.includes('.') || seenClass.has(cls.n)) continue;
        if (ctx.imports.packages.has(pkg) || ctx.imports.classes.get(cls.n) === fqn) {
            seenClass.add(cls.n);
            items.push({
                label: cls.n,
                kind: cls.iface ? 'type' : 'class',
                detail: pkg,
                // String이 StreamTokenizer보다, ArrayList가 ArrayStoreException보다 먼저 오게
                boost: COMMON_CLASSES.has(cls.n) ? 2 : undefined,
            });
        }
    }
    return { from, items };
};

export const javaSignature = (
    index: JavaIndex,
    code: string,
    pos: number
): IntelSignature[] | null => {
    // 열린 '(' 찾기와 현재 인자 번호 (문자열·주석 안의 쉼표와 괄호는 세지 않음)
    const scanText = blankLiterals(code.slice(0, pos));
    let depth = 0;
    let comma = 0;
    let open = -1;
    for (let i = pos - 1; i >= 0; i--) {
        const ch = scanText[i];
        if (ch === ')' || ch === ']' || ch === '}') depth++;
        else if (ch === '(' || ch === '[' || ch === '{') {
            if (depth === 0) {
                open = ch === '(' ? i : -1;
                break;
            }
            depth--;
        } else if (ch === ',' && depth === 0) comma++;
        else if (ch === ';' && depth === 0) break;
    }
    if (open < 0) return null;
    const head = code.slice(0, open).trimEnd();
    const ctx = createContext(index, code, pos, open);
    let candidates: JavaMember[] = [];
    const ctor = /new\s+([\w.]+)\s*(?:<[^(]*>)?$/.exec(head);
    if (ctor) {
        const fqn = resolveClass(ctx, ctor[1]);
        if (fqn) {
            const cls = ctx.index.classes[fqn];
            candidates = cls.c.map((c) => ({ ...c, n: cls.n }));
        }
    } else {
        const name = /([\w$]+)$/.exec(head)?.[1];
        if (!name) return null;
        const before = head.slice(0, head.length - name.length).trimEnd();
        if (before.endsWith('.')) {
            const resolved = typeOf(ctx, receiverBefore(code, before.length - 1));
            if (!resolved) return null;
            candidates = membersOf(ctx, resolved.type).methods.filter((m) => m.n === name);
        } else {
            // 직접 만든 메서드를 수신 객체 없이 부른 경우
            candidates = userMethods(ctx, name);
            if (!candidates.length) return null;
        }
    }
    const seen = new Set<string>();
    const sigs: IntelSignature[] = [];
    for (const m of candidates) {
        const params = (m.p ?? []).map(shortType);
        // 가변 인자는 Java 소스처럼 Object... 로
        if (m.v && params.length)
            params[params.length - 1] = params.at(-1)!.replace(/\[\]$/, '...');
        const label = `${m.n}(${params.join(', ')})${m.t && !ctor ? ` → ${shortType(m.t)}` : ''}`;
        if (seen.has(label)) continue;
        seen.add(label);
        let active: [number, number] | undefined;
        // 가변 인자는 마지막 매개변수 칸이 계속 이어집니다. (printf("%d %d", a, b)의 b도 Object... 칸)
        const at = m.v && params.length && comma >= params.length ? params.length - 1 : comma;
        if (at < params.length) {
            const start =
                m.n.length + 1 + params.slice(0, at).reduce((n, p) => n + p.length + 2, 0);
            active = [start, start + params[at].length];
        }
        sigs.push({ label, active });
    }
    // 인자 수가 맞는 것부터
    return sigs.sort((a, b) => Number(!b.active) - Number(!a.active));
};

export const javaHover = (index: JavaIndex, code: string, pos: number): string | null => {
    const start = wordStart(code, pos);
    let end = pos;
    while (end < code.length && /[\w$]/.test(code[end])) end++;
    const word = code.slice(start, end);
    if (!word) return null;
    const ctx = createContext(index, code, pos, start);
    const before = code.slice(0, start).trimEnd();
    if (before.endsWith('.')) {
        const resolved = typeOf(ctx, receiverBefore(code, before.length - 1));
        if (!resolved) return null;
        const members = membersOf(ctx, resolved.type);
        const methods = members.methods.filter((m) => m.n === word);
        if (methods.length)
            return methods
                .slice(0, 6)
                .map((m) => `${shortType(m.t)} ${methodLabel(m)}`)
                .join('\n');
        const field = members.fields.find((f) => f.n === word);
        return field ? `${shortType(field.t)} ${word}` : null;
    }
    const declared = ctx.vars.get(word);
    if (declared) return `${shortType(declared)} ${word}`;
    const own = userMethods(ctx, word);
    if (own.length && /^\s*\(/.test(code.slice(end)))
        return own
            .slice(0, 6)
            .map((m) => `${m.t} ${m.n}(${(m.p ?? []).join(', ')})`)
            .join('\n');
    const fqn = resolveClass(ctx, word);
    return fqn ? `${ctx.index.classes[fqn].iface ? 'interface' : 'class'} ${fqn}` : null;
};

export const createJavaIntel = (
    loadIndex: () => Promise<JavaIndex>,
    check: (
        code: string
    ) => Promise<{ from: number; to: number; severity: 'error' | 'warning'; message: string }[]>
): LanguageIntel => ({
    triggerCharacters: ['.'],
    async complete(code, pos, explicit) {
        return javaComplete(await loadIndex(), code, pos, explicit);
    },
    async signature(code, pos) {
        return javaSignature(await loadIndex(), code, pos);
    },
    async hover(code, pos) {
        return javaHover(await loadIndex(), code, pos);
    },
    async diagnose(code) {
        return check(code);
    },
});
