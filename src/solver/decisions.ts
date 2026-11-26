// solver.ts에서 상태와 화면 없이 판단만 하는 부분 (decisions.test.ts에서 확인)
import type { ResolvedLanguage } from '../shared/languages.ts';
import { isBadVerdict, type Verdict } from './tests-view.ts';

/** BOJ의 빈 에디터에는 폭 없는 공백(U+200B)이나 BOM이 들어 있을 수 있습니다. */
const hasCode = (source: string) => source.replace(/[\s​﻿]/g, '').length > 0;

/**
 * 웹 코더를 열 때 고를 언어와, 에디터에 올릴 폼의 코드(수정 제출).
 * - 폼에 코드가 있고 그 언어를 지원하면: 그 언어와 그 코드
 * - 폼의 코드가 지원하지 않는 언어(Rust 등)면: 그 코드는 쓰지 않습니다. 다른 언어 칸에 올리면
 *   그 언어로 저장해 둔 코드를 덮어쓰고 엉뚱한 언어로 제출하게 됩니다. (unsupportedSource로 알림)
 * - 그 밖에는 마지막으로 고른 언어 → C++17 → 폼에서 고른 언어 → 첫 언어
 */
export const chooseInitialLanguage = (
    languages: ResolvedLanguage[],
    form: { selectedLanguageId: string | null; initialSource: string },
    lastLanguageLabel: string | undefined
): {
    language: ResolvedLanguage;
    initialCode: string | undefined;
    /** 폼에 지원하지 않는 언어의 코드가 있었음 */
    unsupportedSource: boolean;
} => {
    const fromForm = languages.find((l) => l.id === form.selectedLanguageId);
    const formCode = hasCode(form.initialSource);
    const useForm = fromForm !== undefined && formCode;
    const language =
        (useForm ? fromForm : undefined) ??
        languages.find((l) => l.label === lastLanguageLabel) ??
        languages.find((l) => l.label === 'C++17') ??
        fromForm ??
        languages[0];
    return {
        language,
        initialCode: useForm ? form.initialSource : undefined,
        unsupportedSource: !fromForm && formCode,
    };
};

/**
 * 제출 전에 물어볼 말. null이면 바로 제출합니다.
 * lastRun은 마지막 "모두 실행" 결과, currentVerdicts는 지금 보이는 결과를 지금 기대 출력으로 다시 판정한 것
 * (지금 코드의 결과일 때만).
 */
export const submitWarning = (opts: {
    functionOnly: boolean;
    source: string;
    languageId: string;
    lastRun: {
        source: string;
        languageId: string;
        verdicts: Verdict[];
        compileError: boolean;
    } | null;
    currentVerdicts: Verdict[] | null;
    hasCustomTests: boolean;
}): string | null => {
    const { lastRun } = opts;
    // 함수만 제출하는 문제는 로컬에서 컴파일·실행할 수 없으니 묻지 않습니다.
    if (opts.functionOnly) return null;
    if (!lastRun || lastRun.source !== opts.source || lastRun.languageId !== opts.languageId)
        return '지금 코드로 아직 예제를 실행하지 않았습니다.';
    if (lastRun.compileError) return '컴파일 에러가 있는 코드입니다.';
    // 실행한 뒤 기대 출력을 고쳤을 수 있으므로 지금 기준으로 다시 판정한 것을 씁니다.
    const verdicts = opts.currentVerdicts ?? lastRun.verdicts;
    const bad = verdicts.filter(isBadVerdict).length;
    if (bad === 0) return null;
    const what = opts.hasCustomTests ? '예제와 내 테스트' : '예제';
    return `${what} ${verdicts.length}개 중 ${bad}개를 통과하지 못했습니다.`;
};
