// 코드 정렬 (VS Code의 Shift+Alt+F 문서 서식).
// C·C++·Java·JavaScript는 clang-format, Python은 Ruff 포매터를 씁니다. (둘 다 @wasm-fmt의 wasm 빌드, MIT)
// wasm은 처음 정렬할 때 한 번만 불러옵니다. 문법이 틀린 Python은 정렬하지 않고 줄 번호를 알려 줍니다.
import { Facet } from '@codemirror/state';
import type { Command, EditorView } from '@codemirror/view';
import initClang, { format as clangFormat } from '@wasm-fmt/clang-format/web';
import initRuff, { format as ruffFormat } from '@wasm-fmt/ruff_fmt/web';
import { fetchAsset } from '../shared/assets.ts';
import type { RuntimeInfo } from '../shared/languages.ts';

export type FormatLanguage = RuntimeInfo['editor'];

/** 들여쓰기 4칸, 한 줄 100자. 중괄호는 여는 줄 끝에 (기본 템플릿과 같은 모양) */
const CLANG_STYLE = JSON.stringify({
    BasedOnStyle: 'LLVM',
    IndentWidth: 4,
    ColumnLimit: 100,
    // #include 순서는 그대로 (bits/stdc++.h를 맨 위에 두는 경우가 많음)
    SortIncludes: 'Never',
});

const CLANG_FILE: Record<
    Exclude<FormatLanguage, 'python'>,
    'main.cpp' | 'main.java' | 'main.js'
> = {
    cpp: 'main.cpp',
    java: 'main.java',
    javascript: 'main.js',
};

type WasmSource = Response | BufferSource;
/** wasm 파일을 가져오는 방법 (테스트에서는 파일을 직접 읽음) */
let loadWasm = (file: string): Promise<WasmSource> =>
    fetchAsset(new URL(`format/${file}`, location.href));

export const setFormatWasmLoader = (loader: (file: string) => Promise<WasmSource>) => {
    loadWasm = loader;
};

let clangReady: Promise<unknown> | null = null;
let ruffReady: Promise<unknown> | null = null;

const ready = (lang: FormatLanguage) => {
    if (lang === 'python') {
        ruffReady ??= loadWasm('ruff_fmt_bg.wasm').then((source) => initRuff(source));
        return ruffReady.catch((error: unknown) => {
            ruffReady = null; // 다음에 다시 시도
            throw error;
        });
    }
    clangReady ??= loadWasm('clang-format.wasm').then((source) => initClang(source));
    return clangReady.catch((error: unknown) => {
        clangReady = null;
        throw error;
    });
};

export type FormatResult = { ok: true; code: string } | { ok: false; message: string };

/** Ruff 에러의 "byte range 12..15"를 줄 번호(1부터)로 */
const lineOfByteOffset = (code: string, offset: number) => {
    const bytes = new TextEncoder().encode(code).subarray(0, offset);
    return new TextDecoder().decode(bytes).split('\n').length;
};

export const formatCode = async (lang: FormatLanguage, code: string): Promise<FormatResult> => {
    await ready(lang);
    if (lang !== 'python')
        return { ok: true, code: clangFormat(code, CLANG_FILE[lang], CLANG_STYLE) };
    try {
        return {
            ok: true,
            code: ruffFormat(code, undefined, { indent_width: 4, line_width: 100 }),
        };
    } catch (error) {
        const range = /byte range (\d+)\.\./.exec(String(error));
        const where = range ? ` (${lineOfByteOffset(code, Number(range[1]))}번째 줄)` : '';
        return { ok: false, message: `문법 오류가 있어 정렬하지 못했습니다.${where}` };
    }
};

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/**
 * 정렬 전 위치를 정렬 뒤 위치로 옮깁니다. 정렬은 대부분 공백만 바꾸므로,
 * 위치 앞의 공백이 아닌 글자 수가 같은 곳으로 갑니다. (따옴표·괄호가 바뀌면 근사)
 */
export const mapPosition = (before: string, after: string, pos: number) => {
    let count = 0;
    for (let i = 0; i < pos && i < before.length; i++) if (!isSpace(before[i])) count++;
    let i = 0;
    for (; i < after.length && count > 0; i++) if (!isSpace(after[i])) count--;
    // 커서가 다음 글자에 붙어 있었으면 정렬로 생긴 공백을 건너 그 글자 앞으로 (a+|b → a + |b)
    if (pos < before.length && !isSpace(before[pos]))
        while (i < after.length && isSpace(after[i])) i++;
    return i;
};

/** 앞뒤로 같은 부분을 빼고 바뀐 구간만 (되돌리기와 스크롤이 자연스럽게) */
export const minimalChange = (before: string, after: string) => {
    let start = 0;
    const max = Math.min(before.length, after.length);
    while (start < max && before[start] === after[start]) start++;
    let end = 0;
    while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end])
        end++;
    return {
        from: start,
        to: before.length - end,
        insert: after.slice(start, after.length - end),
    };
};

/** 에디터마다: 지금 언어와 알림 방법 */
export const formatContext = Facet.define<
    { lang: FormatLanguage; notify: (message: string) => void },
    { lang: FormatLanguage; notify: (message: string) => void } | null
>({ combine: (values) => values[0] ?? null });

const formatView = async (view: EditorView) => {
    const context = view.state.facet(formatContext);
    if (!context) return;
    const before = view.state.doc.toString();
    let result: FormatResult;
    try {
        result = await formatCode(context.lang, before);
    } catch {
        context.notify('정렬 도구를 불러오지 못했습니다.');
        return;
    }
    if (!result.ok) {
        context.notify(result.message);
        return;
    }
    // 정렬하는 동안 코드가 바뀌었으면 그만둠
    if (view.state.doc.toString() !== before || result.code === before) return;
    const after = result.code;
    view.dispatch({
        changes: minimalChange(before, after),
        selection: {
            anchor: mapPosition(before, after, view.state.selection.main.anchor),
            head: mapPosition(before, after, view.state.selection.main.head),
        },
        scrollIntoView: true,
        userEvent: 'input.format',
    });
};

/** 문서 전체 정렬 (단축키에 연결) */
export const formatDocument: Command = (view) => {
    if (!view.state.facet(formatContext) || view.state.readOnly) return false;
    void formatView(view);
    return true;
};
