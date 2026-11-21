// 깊은 재귀 모드: 컴파일된 wasm을 고쳐서 브라우저의 호출 스택 한계(약 1MB)를 넘겨 실행합니다.
//
// 브라우저는 wasm 호출 스택 크기를 바꿀 수 없어서 재귀 깊이가 수천~1만을 넘으면
// "Maximum call stack size exceeded"가 납니다. 대신 JSPI(WebAssembly.promising/Suspending)로
// 스택을 어느 정도 쓸 때마다 새 스택으로 넘어가 이어서 실행합니다.
//
// 모든 함수 F의 본문을 래퍼와 맞바꿉니다. (원래 본문은 새 함수 F_impl로 옮김)
//   F(args):
//     used += F의 예상 프레임 크기
//     if (스택 예산 경계를 넘지 않았으면) 결과 = F_impl(args)
//     else { 인자를 전역 변수에 저장; grow(id); 결과를 전역 변수에서 읽음 }   ← grow는 JS import
//     used -= F의 예상 프레임 크기
// JS의 grow(id)는 새 스택에서 __webcoder_resume(id)를 실행하고, 이 함수가 전역 변수에서
// 인자를 꺼내 F_impl을 부릅니다. 함수 인덱스가 바뀌지 않으므로 명령어를 해석할 필요가 없고,
// 섹션 단위로만 다시 조립합니다.
//
// C++(clang) 결과물과 Java(TeaVM wasm-gc) 결과물에 씁니다.

/**
 * 한 스택에서 쓰는 예상 바이트 수 (2의 거듭제곱). 브라우저 스택은 약 1MB이고,
 * 동시에 살아 있을 수 있는 스택 수에도 한계(약 700개)가 있어서 너무 작게 잡으면 깊이가 줄어듭니다.
 */
const STACK_BUDGET = 1 << 19;

/**
 * 래퍼 + 원래 함수의 프레임 크기 추정 (바이트). 실제 크기는 알 수 없어서
 * 인자·지역 변수 수로 넉넉하게 잡습니다. (기본 프레임, 피연산자 스택 여유 포함)
 */
const estimateFrame = (params: number, locals: number) => 240 + 8 * (2 * params + locals);

export const RESUME_EXPORT = '__webcoder_resume';

export type DeepStackOptions = {
    /**
     * 새 스택으로 넘어갈 때 부를 import. 타입은 (i32) -> ().
     * import를 새로 넣으면 함수 인덱스가 밀리므로, 모듈에 이미 있는 것을 씁니다.
     */
    grow: { module: string; name: string };
    /**
     * grow에 넘기는 값 = idBase + 함수 번호. 원래 다른 용도가 있는 import를 빌려 쓸 때
     * 정상 호출과 구별할 수 있는 값으로 잡습니다.
     */
    idBase: number;
};

/** C++: cpp-header.ts가 링크해 둔 전용 import */
export const CPP_DEEP_STACK: DeepStackOptions = {
    grow: { module: 'webcoder', name: 'grow' },
    idBase: 0,
};

/**
 * Java: TeaVM 결과물에는 전용 import를 넣을 수 없어서 stderr 출력 함수를 빌려 씁니다.
 * putcharStderr는 UTF-16 코드 단위(0~0xFFFF)만 받으므로 그보다 큰 값은 grow 요청입니다.
 */
export const JAVA_DEEP_STACK: DeepStackOptions = {
    grow: { module: 'teavmConsole', name: 'putcharStderr' },
    idBase: 0x10000,
};

const I32 = 0x7f;
const I64 = 0x7e;
const F32 = 0x7d;
const F64 = 0x7c;
const FUNCREF = 0x70;
const EXTERNREF = 0x6f;
const ANYREF = 0x6e;

class Unsupported extends Error {}

class Reader {
    pos = 0;
    readonly bytes: Uint8Array;
    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
    }
    get done() {
        return this.pos >= this.bytes.length;
    }
    peek() {
        return this.bytes[this.pos];
    }
    u8() {
        if (this.pos >= this.bytes.length) throw new Unsupported('잘린 모듈');
        return this.bytes[this.pos++];
    }
    /** 부호 없는 LEB128 */
    uleb() {
        let result = 0;
        let shift = 1;
        for (;;) {
            const byte = this.u8();
            result += (byte & 0x7f) * shift;
            if (!(byte & 0x80)) return result;
            shift *= 128;
        }
    }
    /** LEB128 한 개를 해석하지 않고 그대로 읽습니다. */
    rawLeb() {
        const start = this.pos;
        while (this.u8() & 0x80);
        return Array.from(this.bytes.subarray(start, this.pos));
    }
    take(length: number) {
        const slice = this.bytes.subarray(this.pos, this.pos + length);
        if (slice.length !== length) throw new Unsupported('잘린 모듈');
        this.pos += length;
        return slice;
    }
    name() {
        return new TextDecoder().decode(this.take(this.uleb()));
    }
    limits() {
        const flags = this.u8();
        this.uleb();
        if (flags & 1) this.uleb();
    }
    /** 값 타입 (인코딩된 바이트 그대로). 참조 타입은 여러 바이트일 수 있습니다. */
    valtype(): number[] {
        const byte = this.u8();
        return byte === 0x63 || byte === 0x64 ? [byte, ...this.rawLeb()] : [byte];
    }
}

const uleb = (value: number): number[] => {
    const out: number[] = [];
    do {
        let byte = value % 128;
        value = Math.floor(value / 128);
        if (value > 0) byte |= 0x80;
        out.push(byte);
    } while (value > 0);
    return out;
};

/** 부호 있는 LEB128 (0 이상의 값만 씁니다) */
const sleb = (value: number): number[] => {
    const out: number[] = [];
    for (;;) {
        const byte = value % 128;
        value = Math.floor(value / 128);
        if (value === 0 && !(byte & 0x40)) {
            out.push(byte);
            return out;
        }
        out.push(byte | 0x80);
    }
};

class Writer {
    private chunks: Uint8Array[] = [];
    length = 0;
    push(data: Uint8Array | number[]) {
        const chunk = data instanceof Uint8Array ? data : Uint8Array.from(data);
        this.chunks.push(chunk);
        this.length += chunk.length;
    }
    finish() {
        const out = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }
}

const section = (id: number, payload: Writer) => {
    const body = payload.finish();
    const out = new Writer();
    out.push([id, ...uleb(body.length)]);
    out.push(body);
    return out.finish();
};

type ValType = number[];
type TypeDef =
    | { kind: 'func'; params: ValType[]; results: ValType[] }
    | { kind: 'struct' }
    | { kind: 'array' };
type FuncType = Extract<TypeDef, { kind: 'func' }>;

const sameType = (a: ValType, b: ValType) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameList = (a: ValType[], b: ValType[]) =>
    a.length === b.length && a.every((v, i) => sameType(v, b[i]));

/** 인자·결과를 잠시 담아 두는 전역 변수의 종류 */
const SLOT_KINDS = ['i32', 'i64', 'f32', 'f64', 'any', 'func', 'extern'] as const;
type SlotKind = (typeof SLOT_KINDS)[number];

/** 종류별 전역 변수 선언: 타입, 가변, 초기값 식 */
const SLOT_GLOBAL: Record<SlotKind, number[]> = {
    i32: [I32, 1, 0x41, 0, 0x0b],
    i64: [I64, 1, 0x42, 0, 0x0b],
    f32: [F32, 1, 0x43, 0, 0, 0, 0, 0x0b],
    f64: [F64, 1, 0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0x0b],
    any: [ANYREF, 1, 0xd0, ANYREF, 0x0b],
    func: [FUNCREF, 1, 0xd0, FUNCREF, 0x0b],
    extern: [EXTERNREF, 1, 0xd0, EXTERNREF, 0x0b],
};

const NUMERIC_SLOT: Record<number, SlotKind> = {
    [I32]: 'i32',
    [I64]: 'i64',
    [F32]: 'f32',
    [F64]: 'f64',
};
/** 추상 힙 타입이 속한 계층 */
const ABSTRACT_HEAP: Record<number, SlotKind> = {
    [ANYREF]: 'any',
    0x6d: 'any', // eq
    0x6c: 'any', // i31
    0x6b: 'any', // struct
    0x6a: 'any', // array
    0x71: 'any', // none
    [FUNCREF]: 'func',
    0x73: 'func', // nofunc
    [EXTERNREF]: 'extern',
    0x72: 'extern', // noextern
};

type Slot = {
    kind: SlotKind;
    /** 전역 변수(계층의 최상위 타입)에서 꺼낸 뒤 원래 타입으로 되돌리는 명령 */
    cast: number[];
};

/**
 * 모듈을 깊은 재귀용으로 고칩니다. 고칠 수 없는 모듈이면 null.
 * (grow import가 없거나, 여기서 해석하지 않는 기능을 쓰는 경우)
 */
export const instrumentDeepStack = (
    module: Uint8Array,
    options: DeepStackOptions
): Uint8Array | null => instrumentDeepStackWithMap(module, options)?.module ?? null;

export type DeepStackResult = {
    module: Uint8Array;
    /**
     * 고친 모듈 안의 코드 주소(모듈 시작 기준)를 원래 모듈의 주소로 바꿉니다.
     * 새로 넣은 코드(래퍼, resume)의 주소면 null. 원래 모듈의 디버그 정보로 스택을 해석할 때 씁니다.
     */
    toOriginal: (address: number) => number | null;
};

export const instrumentDeepStackWithMap = (
    module: Uint8Array,
    options: DeepStackOptions
): DeepStackResult | null => {
    try {
        return instrument(module, options);
    } catch (error) {
        if (error instanceof Unsupported) return null;
        throw error;
    }
};

const instrument = (module: Uint8Array, options: DeepStackOptions): DeepStackResult => {
    const top = new Reader(module);
    const header = top.take(8);
    const sections: Array<{ id: number; payload: Uint8Array }> = [];
    while (!top.done) {
        const id = top.u8();
        sections.push({ id, payload: top.take(top.uleb()) });
    }
    const find = (id: number) => sections.find((s) => s.id === id)?.payload;

    // ── 타입 ──
    const typePayload = find(1);
    if (!typePayload) throw new Unsupported('타입 섹션 없음');
    const types: TypeDef[] = [];
    let typeEntries = 0;
    {
        const r = new Reader(typePayload);
        const valtypes = () => {
            const list: ValType[] = [];
            for (let n = r.uleb(); n > 0; n--) list.push(r.valtype());
            return list;
        };
        const field = () => {
            if (r.peek() === 0x78 || r.peek() === 0x77) r.u8(); // i8, i16
            else r.valtype();
            r.u8(); // 가변 여부
        };
        const composite = () => {
            const form = r.u8();
            if (form === 0x60) {
                types.push({ kind: 'func', params: valtypes(), results: valtypes() });
            } else if (form === 0x5f) {
                for (let n = r.uleb(); n > 0; n--) field();
                types.push({ kind: 'struct' });
            } else if (form === 0x5e) {
                field();
                types.push({ kind: 'array' });
            } else {
                throw new Unsupported('알 수 없는 타입 형식');
            }
        };
        const subtype = () => {
            if (r.peek() === 0x50 || r.peek() === 0x4f) {
                r.u8();
                for (let n = r.uleb(); n > 0; n--) r.uleb();
            }
            composite();
        };
        typeEntries = r.uleb();
        for (let i = 0; i < typeEntries; i++) {
            if (r.peek() === 0x4e) {
                r.u8();
                for (let n = r.uleb(); n > 0; n--) subtype();
            } else {
                subtype();
            }
        }
        if (!r.done) throw new Unsupported('타입 섹션 해석 실패');
    }
    const funcType = (index: number): FuncType => {
        const type = types[index];
        if (!type || type.kind !== 'func') throw new Unsupported('함수 타입이 아님');
        return type;
    };
    const addedTypes: FuncType[] = [];
    const typeIndex = (params: ValType[], results: ValType[]) => {
        const matches = (t: TypeDef) =>
            t.kind === 'func' && sameList(t.params, params) && sameList(t.results, results);
        const added = addedTypes.findIndex(matches);
        if (added >= 0) return types.length + added;
        // 원래 있던 타입은 하위 타입 선언이 붙어 있을 수 있어 블록 타입으로 쓰지 않고 새로 넣습니다.
        addedTypes.push({ kind: 'func', params, results });
        return types.length + addedTypes.length - 1;
    };

    /** 값 타입을 어떤 전역 변수에 담을지. 담을 수 없으면(v128 등) null */
    const slotOf = (type: ValType): Slot | null => {
        if (type.length === 1) {
            const numeric = NUMERIC_SLOT[type[0]];
            if (numeric) return { kind: numeric, cast: [] };
            const kind = ABSTRACT_HEAP[type[0]];
            if (!kind) return null;
            const isTop = type[0] === ANYREF || type[0] === FUNCREF || type[0] === EXTERNREF;
            return { kind, cast: isTop ? [] : [0xfb, 0x17, type[0]] };
        }
        const heap = type.slice(1);
        let kind: SlotKind | undefined;
        if (heap.length === 1 && heap[0] & 0x40) {
            kind = ABSTRACT_HEAP[heap[0]];
        } else {
            const def = types[new Reader(Uint8Array.from(heap)).uleb()];
            if (def) kind = def.kind === 'func' ? 'func' : 'any';
        }
        if (!kind) return null;
        return { kind, cast: [0xfb, type[0] === 0x63 ? 0x17 : 0x16, ...heap] };
    };

    // ── import ──
    let funcImports = 0;
    let globalImports = 0;
    let grow = -1;
    const importPayload = find(2);
    if (importPayload) {
        const r = new Reader(importPayload);
        for (let n = r.uleb(); n > 0; n--) {
            const mod = r.name();
            const field = r.name();
            const kind = r.u8();
            if (kind === 0) {
                const type = types[r.uleb()];
                if (mod === options.grow.module && field === options.grow.name) {
                    const ok =
                        type?.kind === 'func' &&
                        sameList(type.params, [[I32]]) &&
                        type.results.length === 0;
                    if (!ok) throw new Unsupported('grow 타입 불일치');
                    grow = funcImports;
                }
                funcImports++;
            } else if (kind === 1) {
                r.valtype();
                r.limits();
            } else if (kind === 2) {
                r.limits();
            } else if (kind === 3) {
                r.valtype();
                r.u8();
                globalImports++;
            } else if (kind === 4) {
                r.u8();
                r.uleb();
            } else {
                throw new Unsupported('알 수 없는 import');
            }
        }
    }
    if (grow < 0) throw new Unsupported('grow import 없음');

    // ── 함수, 코드 ──
    const funcPayload = find(3);
    const codePayload = find(10);
    const globalPayload = find(6);
    const exportPayload = find(7);
    if (!funcPayload || !codePayload || !globalPayload || !exportPayload)
        throw new Unsupported('필요한 섹션 없음');

    const funcTypes: number[] = [];
    {
        const r = new Reader(funcPayload);
        for (let n = r.uleb(); n > 0; n--) funcTypes.push(r.uleb());
    }
    const bodies: Uint8Array[] = [];
    {
        const r = new Reader(codePayload);
        for (let n = r.uleb(); n > 0; n--) bodies.push(r.take(r.uleb()));
    }
    if (bodies.length !== funcTypes.length) throw new Unsupported('함수 수 불일치');

    /** 함수 본문 머리의 지역 변수 선언에서 개수를 셉니다. */
    const countLocals = (body: Uint8Array) => {
        const r = new Reader(body);
        let total = 0;
        for (let groups = r.uleb(); groups > 0; groups--) {
            total += r.uleb();
            r.valtype();
        }
        return total;
    };

    type Wrapped = { def: number; type: FuncType; params: Slot[]; results: Slot[] };
    const wrapped: Wrapped[] = []; // 정의된 함수 중 래퍼를 씌울 것
    funcTypes.forEach((typeIdx, def) => {
        const type = funcType(typeIdx);
        const params = type.params.map(slotOf);
        const results = type.results.map(slotOf);
        if (params.includes(null) || results.includes(null)) return;
        wrapped.push({ def, type, params: params as Slot[], results: results as Slot[] });
    });

    // ── 전역 변수: used + 종류별 인자/결과 저장 칸 ──
    const globalReader = new Reader(globalPayload);
    const globalBase = globalImports + globalReader.uleb();
    const existingGlobals = globalPayload.subarray(globalReader.pos);
    const slotCount = new Map<SlotKind, number>(SLOT_KINDS.map((k) => [k, 0]));
    const countOf = (list: Slot[], kind: SlotKind) => list.filter((s) => s.kind === kind).length;
    for (const w of wrapped) {
        for (const kind of SLOT_KINDS) {
            const need = Math.max(countOf(w.params, kind), countOf(w.results, kind));
            if (need > slotCount.get(kind)!) slotCount.set(kind, need);
        }
    }
    const usedGlobal = globalBase;
    const slotBase = new Map<SlotKind, number>();
    let nextGlobal = globalBase + 1;
    for (const kind of SLOT_KINDS) {
        slotBase.set(kind, nextGlobal);
        nextGlobal += slotCount.get(kind)!;
    }
    /** 값 목록의 각 항목이 쓰는 전역 변수 인덱스 */
    const globalsFor = (list: Slot[]) => {
        const taken = new Map<SlotKind, number>();
        return list.map((slot) => {
            const k = taken.get(slot.kind) ?? 0;
            taken.set(slot.kind, k + 1);
            return slotBase.get(slot.kind)! + k;
        });
    };

    // ── 새 함수 인덱스 ──
    const totalFuncs = funcImports + funcTypes.length;
    const implIndex = (k: number) => totalFuncs + k;
    const resumeIndex = totalFuncs + wrapped.length;
    const resumeType = typeIndex([[I32]], []);

    const GET_LOCAL = 0x20;
    const GET_GLOBAL = 0x23;
    const SET_GLOBAL = 0x24;
    const CALL = 0x10;
    const END = 0x0b;

    const wrapperBody = (k: number, w: Wrapped, original: Uint8Array) => {
        const { type } = w;
        // 지역 변수 하나(i32): 더하기 전의 used 값
        const code: number[] = [0x01, 0x01, I32];
        const used = uleb(usedGlobal);
        const before = uleb(type.params.length);
        const frame = sleb(
            Math.min(estimateFrame(type.params.length, countLocals(original)), STACK_BUDGET)
        );
        // used += frame; 예산 경계(STACK_BUDGET의 배수)를 넘었는지 = 상위 비트가 달라졌는지
        code.push(GET_GLOBAL, ...used, 0x22, ...before, 0x41, ...frame, 0x6a, SET_GLOBAL, ...used);
        code.push(GET_LOCAL, ...before, GET_GLOBAL, ...used, 0x73);
        code.push(0x41, ...sleb(STACK_BUDGET), 0x49);
        const blockType =
            type.results.length === 0
                ? [0x40]
                : type.results.length === 1
                  ? type.results[0]
                  : sleb(typeIndex([], type.results));
        code.push(0x04, ...blockType);
        type.params.forEach((_, i) => code.push(GET_LOCAL, ...uleb(i)));
        code.push(CALL, ...uleb(implIndex(k)));
        code.push(0x05);
        globalsFor(w.params).forEach((global, i) =>
            code.push(GET_LOCAL, ...uleb(i), SET_GLOBAL, ...uleb(global))
        );
        code.push(0x41, ...sleb(options.idBase + k), CALL, ...uleb(grow));
        globalsFor(w.results).forEach((global, i) =>
            code.push(GET_GLOBAL, ...uleb(global), ...w.results[i].cast)
        );
        code.push(END);
        code.push(GET_GLOBAL, ...used, 0x41, ...frame, 0x6b, SET_GLOBAL, ...used);
        code.push(END);
        return code;
    };

    const resumeBody = () => {
        const out = new Writer();
        out.push([0x00]);
        for (let i = 0; i <= wrapped.length; i++) out.push([0x02, 0x40]);
        const table: number[] = [GET_LOCAL, 0, 0x0e, ...uleb(wrapped.length)];
        for (let k = 0; k < wrapped.length; k++) table.push(...uleb(k));
        table.push(...uleb(wrapped.length));
        out.push(table);
        wrapped.forEach((w, k) => {
            const code: number[] = [END];
            globalsFor(w.params).forEach((global, i) =>
                code.push(GET_GLOBAL, ...uleb(global), ...w.params[i].cast)
            );
            code.push(CALL, ...uleb(implIndex(k)));
            for (const global of globalsFor(w.results).reverse())
                code.push(SET_GLOBAL, ...uleb(global));
            code.push(0x0f);
            out.push(code);
        });
        out.push([END, 0x00, END]);
        return out.finish();
    };

    // 본문을 먼저 만들어야 (여러 결과용 블록 타입이) addedTypes에 다 들어갑니다.
    const wrappedIndex = new Map(wrapped.map((w, k) => [w.def, k]));
    const newBodies: Uint8Array[] = bodies.map((body, def) => {
        const k = wrappedIndex.get(def);
        return k === undefined ? body : Uint8Array.from(wrapperBody(k, wrapped[k], body));
    });
    for (const w of wrapped) newBodies.push(bodies[w.def]);
    newBodies.push(resumeBody());

    // ── 섹션 다시 만들기 ──
    const rebuilt = new Map<number, Uint8Array>();
    {
        const w = new Writer();
        const r = new Reader(typePayload);
        r.uleb();
        w.push(uleb(typeEntries + addedTypes.length));
        w.push(typePayload.subarray(r.pos));
        const list = (items: ValType[]) => [...uleb(items.length), ...items.flat()];
        for (const t of addedTypes) w.push([0x60, ...list(t.params), ...list(t.results)]);
        rebuilt.set(1, section(1, w));
    }
    {
        const w = new Writer();
        const all = [...funcTypes, ...wrapped.map((x) => funcTypes[x.def]), resumeType];
        w.push(uleb(all.length));
        for (const t of all) w.push(uleb(t));
        rebuilt.set(3, section(3, w));
    }
    {
        const w = new Writer();
        w.push(uleb(nextGlobal - globalImports));
        w.push(existingGlobals);
        w.push(SLOT_GLOBAL.i32);
        for (const kind of SLOT_KINDS)
            for (let i = 0; i < slotCount.get(kind)!; i++) w.push(SLOT_GLOBAL[kind]);
        rebuilt.set(6, section(6, w));
    }
    {
        const w = new Writer();
        const r = new Reader(exportPayload);
        w.push(uleb(r.uleb() + 1));
        w.push(exportPayload.subarray(r.pos));
        const name = new TextEncoder().encode(RESUME_EXPORT);
        w.push([...uleb(name.length), ...name, 0x00, ...uleb(resumeIndex)]);
        rebuilt.set(7, section(7, w));
    }
    // 옮겨진 원래 본문의 위치: [코드 섹션 내용 안에서의 새 시작, 길이, 원래 모듈에서의 시작]
    const moved: Array<[number, number, number]> = [];
    let codePayloadLength = 0;
    {
        const w = new Writer();
        w.push(uleb(newBodies.length));
        for (const body of newBodies) {
            w.push(uleb(body.length));
            // 원래 모듈의 일부를 그대로 가리키는 본문이면 옮겨진 것입니다. (래퍼·resume은 새로 만든 배열)
            if (body.buffer === module.buffer)
                moved.push([w.length, body.length, body.byteOffset - module.byteOffset]);
            w.push(body);
        }
        codePayloadLength = w.length;
        rebuilt.set(10, section(10, w));
    }

    const out = new Writer();
    out.push(header);
    let codePayloadStart = 0;
    for (const s of sections) {
        const replaced = rebuilt.get(s.id);
        if (replaced) {
            if (s.id === 10) codePayloadStart = out.length + replaced.length - codePayloadLength;
            out.push(replaced);
        } else {
            out.push([s.id, ...uleb(s.payload.length)]);
            out.push(s.payload);
        }
    }
    const toOriginal = (address: number) => {
        const offset = address - codePayloadStart;
        // 본문은 새 위치 순서대로 들어 있으므로 이분 탐색합니다.
        let low = 0;
        let high = moved.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            const [start, length, original] = moved[mid];
            if (offset < start) high = mid - 1;
            else if (offset >= start + length) low = mid + 1;
            else return original + (offset - start);
        }
        return null;
    };
    return { module: out.finish(), toOriginal };
};

export type Jspi = {
    promising: <A extends unknown[]>(
        fn: (...args: A) => unknown
    ) => (...args: A) => Promise<unknown>;
    Suspending: new <A extends unknown[]>(fn: (...args: A) => unknown) => WebAssembly.ImportValue;
};

/**
 * Python(CPython WASI 빌드): 전용 import가 없어서 proc_exit를 빌려 씁니다.
 * 종료 코드로는 나올 수 없는 큰 값이 grow 요청입니다.
 */
export const PYTHON_DEEP_STACK: DeepStackOptions = {
    grow: { module: 'wasi_snapshot_preview1', name: 'proc_exit' },
    idBase: 0x40000000,
};

/** 이 브라우저가 JSPI를 지원하는지 (Chrome 137+) */
export const jspi = (): Jspi | null => {
    const api = WebAssembly as unknown as Partial<Jspi>;
    return typeof api.promising === 'function' && typeof api.Suspending === 'function'
        ? (api as Jspi)
        : null;
};

/** 브라우저의 호출 스택 한계로 난 에러인지 */
export const isStackOverflow = (error: unknown) =>
    error instanceof RangeError && /call stack/i.test(error.message);

type Imports = Record<string, Record<string, unknown>>;

/**
 * 고친 모듈을 실행할 준비를 합니다. install로 import 객체의 grow 자리를 바꿔 끼우고,
 * 인스턴스를 만든 뒤 start로 _start를 실행합니다. (grow는 인스턴스가 만들어진 뒤에 불림)
 */
export const createDeepRunner = (api: Jspi, options: DeepStackOptions) => {
    let resume: ((id: number) => Promise<unknown>) | null = null;
    return {
        install(imports: Imports) {
            const module = (imports[options.grow.module] ??= {});
            const original = module[options.grow.name] as ((value: number) => unknown) | undefined;
            // 빌려 쓰는 import는 idBase보다 작은 값이면 원래 동작을 합니다.
            module[options.grow.name] = new api.Suspending((value: number) =>
                original && value < options.idBase
                    ? original(value)
                    : resume!(value - options.idBase)
            );
        },
        start: (instance: WebAssembly.Instance) => {
            resume = api.promising(instance.exports[RESUME_EXPORT] as (id: number) => void);
            return api.promising(instance.exports._start as () => void)();
        },
    };
};
