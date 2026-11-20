// 언어별 인텔리센스 엔진이 에디터에 제공하는 공통 인터페이스
export type CompletionKind =
    | 'method'
    | 'function'
    | 'variable'
    | 'field'
    | 'property'
    | 'class'
    | 'type'
    | 'namespace'
    | 'keyword'
    | 'constant'
    | 'snippet';

export type IntelCompletion = {
    label: string;
    kind: CompletionKind;
    /** 오른쪽에 보이는 짧은 설명 (반환형, 타입 등) */
    detail?: string;
    /** 선택 시 넣을 텍스트 (없으면 label). `${}` 자리표시자를 쓰면 스니펫으로 처리 */
    apply?: string;
    /** 정렬 가중치 (클수록 위) */
    boost?: number;
};

export type IntelCompletionResult = {
    /** 바꿀 범위의 시작 (현재 입력 중인 단어의 시작) */
    from: number;
    items: IntelCompletion[];
};

export type IntelDiagnostic = {
    from: number;
    to: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
};

export type IntelSignature = {
    /** 표시할 시그니처 전체 */
    label: string;
    /** 현재 인자의 label 안 위치 [시작, 끝) */
    active?: [number, number];
    doc?: string;
};

export interface LanguageIntel {
    complete?(code: string, pos: number, explicit: boolean): Promise<IntelCompletionResult | null>;
    diagnose?(code: string): Promise<IntelDiagnostic[]>;
    signature?(code: string, pos: number): Promise<IntelSignature[] | null>;
    hover?(code: string, pos: number): Promise<string | null>;
    /** 이 문자가 입력되면 자동완성을 바로 띄웁니다. */
    triggerCharacters?: string[];
    dispose?(): void;
}

// ── 공통 도우미 ──────────────────────────────────────────────────────

/** offset → 1부터 시작하는 줄/열(UTF-16 기준) */
export const lineColOf = (code: string, pos: number) => {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < pos; i++) {
        if (code.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, col: pos - lineStart + 1, lineStart };
};

/** 1부터 시작하는 줄/열 → offset. byteColumn이면 열을 UTF-8 바이트로 해석합니다 (clang). */
export const offsetOf = (code: string, line: number, col: number, byteColumn = false) => {
    let pos = 0;
    for (let l = 1; l < line && pos <= code.length; l++) {
        const next = code.indexOf('\n', pos);
        if (next < 0) return code.length;
        pos = next + 1;
    }
    if (!byteColumn) return Math.min(code.length, pos + col - 1);
    let bytes = 1;
    let i = pos;
    while (i < code.length && bytes < col && code.charCodeAt(i) !== 10) {
        const c = code.codePointAt(i)!;
        bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
        i += c > 0xffff ? 2 : 1;
    }
    return i;
};

/** pos에서 끝나는 식별자 단어의 시작 */
export const wordStart = (code: string, pos: number) => {
    let i = pos;
    while (i > 0 && /[\w$]/.test(code[i - 1])) i--;
    return i;
};

/** 오류 위치가 가리키는 토큰의 끝 (밑줄 범위) */
export const tokenEnd = (code: string, from: number) => {
    let i = from;
    if (/[\w$]/.test(code[i] ?? '')) while (i < code.length && /[\w$]/.test(code[i])) i++;
    else i = Math.min(code.length, i + 1);
    return Math.max(i, from + 1);
};
