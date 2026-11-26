// 문제 패널: 머리(번호·제목·제한), 본문, 접기 (본문 그리기는 problem-view.ts)
import type { ProblemData } from '../shared/protocol.ts';
import type { CodeEditor } from './editor.ts';
import type { Elements } from './elements.ts';
import { limitChips, renderProblem, renderProblemMissing } from './problem-view.ts';
import type { ResultsView } from './results-view.ts';
import type { SolverState } from './state.ts';
import { storage } from './storage.ts';

export const createProblemPane = (deps: {
    state: SolverState;
    els: Elements;
    editor: CodeEditor;
    results: ResultsView;
    bojOrigin: string;
}) => {
    const { state, els, editor, bojOrigin } = deps;

    const renderHeader = () => {
        const { problemId, problem } = state;
        els.problemLink.textContent = `${problemId}번`;
        els.problemLink.href = `${bojOrigin}/problem/${problemId}`;
        els.problemTitle.textContent = problem?.title ?? '';
        els.problemLimits.replaceChildren(...(problem ? limitChips(problem) : []));
        document.title = problem
            ? `${problemId}번 ${problem.title} - 웹 코더`
            : `${problemId}번 - 웹 코더`;
    };

    /** 문제 데이터를 받으면(처음 또는 다른 탭에서 문제 페이지를 연 뒤) 화면과 예제를 갱신합니다. */
    const applyProblem = (next: ProblemData) => {
        if (state.problem?.id !== next.id) state.closedSamples.clear();
        state.problem = next;
        renderHeader();
        renderProblem(els.problemContent, next);
        els.problemPane.scrollTop = 0;
        for (const key of [...state.testStates.keys()])
            if (key.startsWith('sample-')) state.testStates.delete(key);
        deps.results.renderTests();
    };

    /** 문제 페이지를 아직 열지 않아 본문이 없을 때 */
    const showMissing = () =>
        renderProblemMissing(els.problemContent, `${bojOrigin}/problem/${state.problemId}`);

    const setProblemCollapsed = (collapsed: boolean) => {
        document.documentElement.classList.toggle('problem-collapsed', collapsed);
        els.toggleProblemButton.setAttribute('aria-pressed', String(collapsed));
        els.toggleProblemButton.title = collapsed ? '문제 펼치기 (Ctrl+B)' : '문제 접기 (Ctrl+B)';
        editor.refresh();
    };
    const toggleProblem = () => {
        const collapsed = !document.documentElement.classList.contains('problem-collapsed');
        setProblemCollapsed(collapsed);
        void storage.updatePrefs({ problemCollapsed: collapsed });
    };
    els.toggleProblemButton.addEventListener('click', toggleProblem);

    return { renderHeader, applyProblem, showMissing, setProblemCollapsed, toggleProblem };
};
