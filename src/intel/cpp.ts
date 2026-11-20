// C++ 인텔리센스: 이미 들어 있는 clang 22를 그대로 씁니다.
// - 자동완성/시그니처: clang -code-completion-at (멤버 접근이면 전역 목록 생략)
// - 실시간 진단: clang -fsyntax-only
// bits/stdc++.h PCH가 있으면 대부분 100~400ms 안에 응답합니다.
import type { RunnerPool } from '../runner/pool.ts';
import {
    parseClangCompletions,
    parseClangDiagnostics,
    parseClangSignatures,
} from './clang-parse.ts';
import { wordStart, type LanguageIntel } from './types.ts';

/** clang의 줄/열(열은 UTF-8 바이트, 1부터) */
const clangPosition = (code: string, pos: number) => {
    const lineStart = code.lastIndexOf('\n', pos - 1) + 1;
    const line = code.slice(0, lineStart).split('\n').length;
    const col = new TextEncoder().encode(code.slice(lineStart, pos)).length + 1;
    return { line, col };
};

export const createCppIntel = (pool: RunnerPool, std: string): LanguageIntel => ({
    triggerCharacters: ['.', '->', '::'],

    async complete(code, pos, explicit) {
        const from = wordStart(code, pos);
        const before = code.slice(Math.max(0, from - 2), from);
        const memberOnly = /(\.|->|::)$/.test(before);
        if (!explicit && !memberOnly && pos - from < 2) return null;
        const output = await pool.cppAnalyze({
            type: 'complete',
            source: code,
            std,
            ...clangPosition(code, from),
            memberOnly,
        });
        if (output == null) return null;
        return { from, items: parseClangCompletions(output) };
    },

    async signature(code, pos) {
        const output = await pool.cppAnalyze({
            type: 'complete',
            source: code,
            std,
            ...clangPosition(code, pos),
            memberOnly: true,
        });
        return output == null ? null : parseClangSignatures(output);
    },

    async diagnose(code) {
        const output = await pool.cppAnalyze({ type: 'diagnose', source: code, std });
        return output == null ? [] : parseClangDiagnostics(output, code);
    },
});
