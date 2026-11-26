// C++ 인텔리센스: 이미 들어 있는 clang 22를 그대로 씁니다.
// - 자동완성/시그니처: clang -code-completion-at (멤버 접근이면 전역 목록 생략)
// - 실시간 진단: clang -fsyntax-only
// bits/stdc++.h PCH가 있으면 대부분 100~400ms 안에 응답합니다.
import type { CppAnalyze } from './types.ts';
import {
    parseClangCompletions,
    parseClangDiagnostics,
    parseClangSignatures,
} from './clang-parse.ts';
import { lineColOf, wordStart, type LanguageIntel } from './types.ts';

/** clang의 줄/열(열은 UTF-8 바이트, 1부터) */
const clangPosition = (code: string, pos: number) => {
    const { line, lineStart } = lineColOf(code, pos);
    const col = new TextEncoder().encode(code.slice(lineStart, pos)).length + 1;
    return { line, col };
};

/** analyze: clang으로 자동완성·진단을 돌려 출력 원문을 받는 함수 (RunnerPool.cppAnalyze) */
export const createCppIntel = (analyze: CppAnalyze, std: string): LanguageIntel => ({
    triggerCharacters: ['.', '->', '::'],

    async complete(code, pos, explicit) {
        const from = wordStart(code, pos);
        const before = code.slice(Math.max(0, from - 2), from);
        const member = /(\.|->)$/.test(before);
        // `std::` 처럼 이름공간 뒤에서는 이름공간 수준의 선언이 필요하므로 멤버 전용 모드를 쓰지 않습니다.
        const scoped = /::$/.test(before);
        if (!explicit && !member && !scoped && pos - from < 2) return null;
        const output = await analyze({
            type: 'complete',
            source: code,
            std,
            ...clangPosition(code, from),
            memberOnly: member,
        });
        if (output == null) return null;
        return {
            from,
            items: parseClangCompletions(output, {
                member,
                source: scoped ? undefined : code,
                keywords: !member && !scoped,
            }),
        };
    },

    async signature(code, pos) {
        const output = await analyze({
            type: 'complete',
            source: code,
            std,
            ...clangPosition(code, pos),
            memberOnly: true,
        });
        return output == null ? null : parseClangSignatures(output);
    },

    async diagnose(code) {
        const output = await analyze({ type: 'diagnose', source: code, std });
        return output == null ? [] : parseClangDiagnostics(output, code);
    },
});
