// wasm 함수 하나의 i32 상수 하나를 바꿉니다. (빌드할 때 Python 인터프리터의 C 재귀 한도를 늘리는 데 씀)
// 함수는 name 섹션의 이름으로 찾고, 본문에서 `i32.const 옛값`이 정확히 한 번 나와야 바꿉니다.
// 새 값의 LEB128 길이가 달라질 수 있어 그 함수의 크기와 code 섹션 크기만 다시 씁니다.
// (다른 섹션은 코드 위치를 가리키지 않으므로 그대로 둡니다. 디버그 섹션은 이미 지운 빌드)

const readU32 = (bytes: Uint8Array, pos: number): [value: number, next: number] => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
        byte = bytes[pos++];
        result |= (byte & 0x7f) << shift;
        shift += 7;
    } while (byte & 0x80);
    return [result >>> 0, pos];
};

const writeU32 = (value: number) => {
    const out: number[] = [];
    do {
        let byte = value & 0x7f;
        value >>>= 7;
        if (value) byte |= 0x80;
        out.push(byte);
    } while (value);
    return out;
};

const writeS32 = (value: number) => {
    const out: number[] = [];
    for (;;) {
        const byte = value & 0x7f;
        value >>= 7;
        const done = (value === 0 && !(byte & 0x40)) || (value === -1 && byte & 0x40);
        out.push(done ? byte : byte | 0x80);
        if (done) return out;
    }
};

/** header: 섹션 id 바이트의 위치, start~end: 내용 */
type Section = { id: number; header: number; start: number; end: number };

const sectionsOf = (bytes: Uint8Array) => {
    const sections: Section[] = [];
    let pos = 8;
    while (pos < bytes.length) {
        const id = bytes[pos];
        const [size, start] = readU32(bytes, pos + 1);
        sections.push({ id, header: pos, start, end: start + size });
        pos = start + size;
    }
    return sections;
};

/** 가져온(import) 함수 수: 함수 인덱스는 import 함수부터 셉니다. */
const importedFunctions = (bytes: Uint8Array, section: Section | undefined) => {
    if (!section) return 0;
    let [count, pos] = readU32(bytes, section.start);
    let functions = 0;
    const skip = () => {
        const [, next] = readU32(bytes, pos);
        pos = next;
    };
    const limits = () => {
        const flags = bytes[pos++];
        skip();
        if (flags & 1) skip();
    };
    for (; count > 0; count--) {
        for (let k = 0; k < 2; k++) {
            const [len, next] = readU32(bytes, pos);
            pos = next + len;
        }
        const kind = bytes[pos++];
        if (kind === 0) {
            skip();
            functions++;
        } else if (kind === 1) {
            pos++; // 참조 타입
            limits();
        } else if (kind === 2) limits();
        else if (kind === 3) pos += 2;
        else if (kind === 4) pos += 2;
        else throw new Error(`알 수 없는 import 종류 ${kind}`);
    }
    return functions;
};

const functionIndexByName = (bytes: Uint8Array, sections: Section[], name: string) => {
    const decoder = new TextDecoder();
    for (const section of sections.filter((s) => s.id === 0)) {
        let [len, pos] = readU32(bytes, section.start);
        if (decoder.decode(bytes.subarray(pos, pos + len)) !== 'name') continue;
        pos += len;
        while (pos < section.end) {
            const sub = bytes[pos];
            const [size, start] = readU32(bytes, pos + 1);
            if (sub === 1) {
                let [count, p] = readU32(bytes, start);
                for (; count > 0; count--) {
                    const [index, afterIndex] = readU32(bytes, p);
                    const [nameLen, afterLen] = readU32(bytes, afterIndex);
                    if (decoder.decode(bytes.subarray(afterLen, afterLen + nameLen)) === name)
                        return index;
                    p = afterLen + nameLen;
                }
            }
            pos = start + size;
        }
    }
    return null;
};

export const replaceI32Const = (
    module: Uint8Array,
    functionName: string,
    from: number,
    to: number
): Uint8Array<ArrayBuffer> => {
    const sections = sectionsOf(module);
    const index = functionIndexByName(module, sections, functionName);
    if (index === null) throw new Error(`함수 ${functionName}을(를) 찾지 못했습니다.`);
    const local =
        index -
        importedFunctions(
            module,
            sections.find((s) => s.id === 2)
        );
    const code = sections.find((s) => s.id === 10);
    if (!code || local < 0) throw new Error(`${functionName}은(는) 본문이 없는 함수입니다.`);

    // code 섹션에서 그 함수의 본문 찾기
    let [count, pos] = readU32(module, code.start);
    if (local >= count) throw new Error('함수 인덱스가 code 섹션 밖입니다.');
    for (let i = 0; i < local; i++) {
        const [size, start] = readU32(module, pos);
        pos = start + size;
    }
    const bodyHeader = pos;
    const [bodySize, bodyStart] = readU32(module, pos);
    const body = module.subarray(bodyStart, bodyStart + bodySize);

    const needle = [0x41, ...writeS32(from)];
    const hits: number[] = [];
    for (let i = 0; i + needle.length <= body.length; i++)
        if (needle.every((b, k) => body[i + k] === b)) hits.push(i);
    if (hits.length !== 1)
        throw new Error(`${functionName}에서 i32.const ${from}이 ${hits.length}번 나옵니다.`);

    const constant = [0x41, ...writeS32(to)];
    const newBodySize = bodySize - needle.length + constant.length;
    const parts: ArrayLike<number>[] = [
        module.subarray(code.start, bodyHeader),
        writeU32(newBodySize),
        body.subarray(0, hits[0]),
        constant,
        body.subarray(hits[0] + needle.length),
        module.subarray(bodyStart + bodySize, code.end),
    ];
    const codeSize = parts.reduce((n, part) => n + part.length, 0);
    return concat([
        module.subarray(0, code.header),
        [10, ...writeU32(codeSize)],
        ...parts,
        module.subarray(code.end),
    ]);
};

const concat = (parts: ArrayLike<number>[]) => {
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let pos = 0;
    for (const part of parts) {
        out.set(part, pos);
        pos += part.length;
    }
    return out;
};
