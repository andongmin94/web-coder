// TeaVM이 결과물 wasm에 넣어 두는 디버그 정보(custom 섹션 teavm_*)를 읽어
// 코드 주소를 Java 스택 프레임(클래스, 메서드, 파일, 줄 번호)으로 바꿉니다.
//
// TeaVM은 이 일을 하는 별도의 wasm(deobfuscator)을 따로 배포하지만 여기서는 싣지 않으므로,
// 형식을 직접 해석합니다. (TeaVM 0.17의 org.teavm.backend.wasm.debug 패키지가 쓰는 형식)
//
//   teavm_str   문자열 목록: [길이, UTF-8]...
//   teavm_pkg   패키지: [부모 번호 + 1 (0이면 최상위), 이름 문자열]...
//   teavm_cls   클래스: [패키지 번호 + 1 (0이면 기본 패키지), 이름 문자열]...
//   teavm_mtd   메서드: [클래스 번호, 이름 문자열]...
//   teavm_file  경로: [부모 번호 + 1, 이름 문자열 × 2 + (파일이면 1)], 파일이면 뒤에 [확장자 문자열]
//   teavm_line  주소별 위치를 만드는 명령 목록
//     0 m   메서드 m 시작 (인라인된 호출이면 겹쳐 쌓임)     1   메서드 끝
//     2 d   줄 += d (부호 있음)                             3 f 파일 = f - 1, 줄 = 1
//     4 d   주소 += d
//     10+v  주소 += v % 32, 줄 += floor(v / 32) - 3
// 숫자는 모두 LEB128이고, 주소는 모듈 시작 기준입니다.

export type JavaFrame = {
    className: string;
    method: string;
    file: string | null;
    line: number;
};

class Reader {
    private pos = 0;
    private readonly bytes: Uint8Array;
    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
    }
    get done() {
        return this.pos >= this.bytes.length;
    }
    u8() {
        return this.bytes[this.pos++];
    }
    leb() {
        let result = 0;
        let scale = 1;
        for (;;) {
            const byte = this.bytes[this.pos++];
            result += (byte & 0x7f) * scale;
            scale *= 128;
            if (!(byte & 0x80)) return result;
        }
    }
    sleb() {
        let result = 0;
        let scale = 1;
        for (;;) {
            const byte = this.bytes[this.pos++];
            result += (byte & 0x7f) * scale;
            scale *= 128;
            if (!(byte & 0x80)) return byte & 0x40 ? result - scale : result;
        }
    }
    text() {
        const length = this.leb();
        const text = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + length));
        this.pos += length;
        return text;
    }
}

/** 모듈의 custom 섹션을 이름별로 모읍니다. */
const customSections = (module: Uint8Array) => {
    const sections = new Map<string, Uint8Array>();
    let pos = 8;
    while (pos < module.length) {
        const id = module[pos++];
        let size = 0;
        let scale = 1;
        for (;;) {
            const byte = module[pos++];
            size += (byte & 0x7f) * scale;
            scale *= 128;
            if (!(byte & 0x80)) break;
        }
        if (id === 0) {
            const payload = module.subarray(pos, pos + size);
            const nameLength = payload[0];
            const name = new TextDecoder().decode(payload.subarray(1, 1 + nameLength));
            sections.set(name, payload.subarray(1 + nameLength));
        }
        pos += size;
    }
    return sections;
};

type Position = { method: number; file: number; line: number };

/**
 * 결과물의 디버그 정보를 읽어, 코드 주소를 프레임 목록으로 바꾸는 함수를 만듭니다.
 * 한 주소가 인라인된 호출 안이면 여러 프레임(안쪽 먼저)이 나옵니다. 디버그 정보가 없으면 null.
 */
export const createJavaStackDecoder = (
    module: Uint8Array
): ((address: number) => JavaFrame[]) | null => {
    const sections = customSections(module);
    const need = ['teavm_str', 'teavm_pkg', 'teavm_cls', 'teavm_mtd', 'teavm_file', 'teavm_line'];
    if (need.some((name) => !sections.has(name))) return null;
    const read = (name: string) => new Reader(sections.get(name)!);

    const strings: string[] = [];
    for (const r = read('teavm_str'); !r.done;) strings.push(r.text());
    const pairs = (name: string) => {
        const list: Array<[number, number]> = [];
        for (const r = read(name); !r.done;) list.push([r.leb(), r.leb()]);
        return list;
    };

    const packages: string[] = [];
    for (const [parent, name] of pairs('teavm_pkg'))
        packages.push((parent > 0 ? `${packages[parent - 1]}.` : '') + strings[name]);
    const classes = pairs('teavm_cls').map(
        ([pkg, name]) => (pkg > 0 ? `${packages[pkg - 1]}.` : '') + strings[name]
    );
    const methods = pairs('teavm_mtd').map(([cls, name]) => ({
        className: classes[cls] ?? '?',
        method: strings[name] ?? '?',
    }));
    // 스택 트레이스에는 Java처럼 경로 없이 파일 이름만 씁니다.
    const files: Array<string | null> = [];
    for (const r = read('teavm_file'); !r.done;) {
        r.leb();
        const value = r.leb();
        files.push(value & 1 ? `${strings[value >> 1]}.${strings[r.leb()]}` : null);
    }

    // 주소 구간별 위치. starts[i] <= 주소 < starts[i + 1] 이면 stacks[i]
    const starts: number[] = [];
    const stacks: Position[][] = [];
    {
        const r = read('teavm_line');
        const outer: Position[] = [];
        let current: Position = { method: -1, file: 0, line: 1 };
        let address = 0;
        const advance = (delta: number) => {
            if (delta <= 0) return;
            starts.push(address);
            stacks.push([...outer, current].filter((p) => p.method >= 0).map((p) => ({ ...p })));
            address += delta;
        };
        while (!r.done) {
            const op = r.u8();
            if (op === 0) {
                outer.push(current);
                current = { method: r.leb(), file: 0, line: 1 };
            } else if (op === 1) {
                current = outer.pop() ?? { method: -1, file: 0, line: 1 };
            } else if (op === 2) {
                current.line += r.sleb();
            } else if (op === 3) {
                current.file = r.leb();
                current.line = 1;
            } else if (op === 4) {
                advance(r.leb());
            } else if (op >= 10) {
                const value = op - 10;
                advance(value % 32);
                current.line += Math.floor(value / 32) - 3;
            } else {
                return null; // 모르는 명령: 형식이 바뀐 것
            }
        }
        starts.push(address);
        stacks.push([]);
    }

    return (address) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (starts[mid] <= address) low = mid;
            else high = mid - 1;
        }
        if (starts.length === 0 || starts[low] > address) return [];
        return stacks[low]
            .map((p) => ({
                ...(methods[p.method] ?? { className: '?', method: '?' }),
                file: p.file > 0 ? (files[p.file - 1] ?? null) : null,
                line: p.file > 0 ? p.line : -1,
            }))
            .reverse();
    };
};
