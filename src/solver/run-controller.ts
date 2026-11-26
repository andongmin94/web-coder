// 예제·내 테스트 실행: 컴파일 → 병렬 실행 → 결과 판정, 진행 단계와 중단
import { localTimeoutMs, problemTimeLimitMs } from '../shared/languages.ts';
import type { RunnerPool } from '../runner/pool.ts';
import type { CodeStore } from './code-store.ts';
import type { CodeEditor } from './editor.ts';
import type { Elements } from './elements.ts';
import type { ResultsView } from './results-view.ts';
import { resultKeyOf, type SolverState, type Stage } from './state.ts';
import { isBadVerdict, verdictOf } from './tests-view.ts';
import type { ShowToast } from './toast.ts';

/** 문제에 시간 제한 정보가 없을 때 쓰는 값 (초) */
const DEFAULT_TIME_LIMIT_SEC = 2;

export const createRunController = (deps: {
    state: SolverState;
    els: Elements;
    editor: CodeEditor;
    pool: RunnerPool;
    store: CodeStore;
    results: ResultsView;
    showToast: ShowToast;
}) => {
    const { state, els, editor, pool, store, results, showToast } = deps;

    /** 경과 시간을 다시 그리는 타이머 */
    let stageTicker = 0;
    const setStage = (next: Stage | null) => {
        if (next && !state.stage) {
            results.stageBegan();
            stageTicker = window.setInterval(results.updateElapsed, 200);
        } else if (!next) {
            clearInterval(stageTicker);
        }
        state.stage = next;
        const busy = next !== null;
        els.runButton.hidden = busy;
        els.stopButton.hidden = !busy;
        els.languageSelect.disabled = busy;
        results.renderStatus();
    };

    /** 테스트를 실행합니다. only를 주면 그 테스트만 (다른 테스트의 결과는 그대로 둠) */
    const runTests = async (only?: string) => {
        if (state.stage || state.switching || !state.current) return;
        if (state.problem?.kind === 'function') {
            showToast('함수만 구현하는 문제라 로컬에서 실행할 수 없습니다. (main 함수가 없음)');
            return;
        }
        const lang = state.current;
        const all = results.allTests();
        const tests = only ? all.filter((t) => t.id === only) : all;
        if (!tests.length) {
            showToast('실행할 예제가 없습니다. "+ 테스트"로 입력을 추가해 보세요.');
            return;
        }
        store.saveCodeNow();
        const source = editor.value;
        const needsCompile = lang.runtime === 'cpp' || lang.runtime === 'java';
        const firstTime = !state.warmed.has(lang.runtime);

        state.cancelRequested = false;
        state.compileMessage = null;
        // 하나만 돌릴 때 코드(또는 언어)가 바뀌었으면, 다른 테스트의 옛 결과는 지워
        // "모두 통과" 같은 집계에 섞이지 않게 합니다.
        const resultKey = resultKeyOf(lang.id, source);
        if (only && state.resultsKey !== resultKey)
            for (const t of all) if (t.id !== only) state.testStates.set(t.id, { phase: 'idle' });
        state.resultsKey = resultKey;
        for (const t of tests) state.testStates.set(t.id, { phase: 'queued' });
        setStage({
            kind: firstTime ? 'loading' : needsCompile ? 'compiling' : 'running',
            done: 0,
            total: tests.length,
        });
        results.renderTests();
        state.lastTiming = null;

        try {
            const compileStarted = performance.now();
            const compiled = await pool.compile(lang, source);
            const timing = {
                compileMs: needsCompile ? performance.now() - compileStarted : null,
                firstLoad: needsCompile && firstTime,
                runMs: null as number | null,
            };
            state.lastTiming = timing;
            if (state.cancelRequested) {
                for (const t of tests) state.testStates.set(t.id, { phase: 'idle' });
                return;
            }
            if (!compiled.ok) {
                state.warmed.add(lang.runtime);
                state.compileMessage = { kind: 'error', text: compiled.diagnostics };
                // 컴파일이 안 되면 어떤 테스트도 돌 수 없습니다.
                for (const t of all) state.testStates.set(t.id, { phase: 'skipped' });
                state.lastRun = { source, languageId: lang.id, verdicts: [], compileError: true };
                return;
            }
            if (needsCompile) state.warmed.add(lang.runtime);
            if (compiled.diagnostics)
                state.compileMessage = { kind: 'warning', text: compiled.diagnostics };

            let done = 0;
            setStage({
                kind: state.warmed.has(lang.runtime) ? 'running' : 'loading',
                done,
                total: tests.length,
            });
            const problem = state.problem;
            const timeout = localTimeoutMs(
                lang.runtime,
                problemTimeLimitMs(lang, {
                    ...problem,
                    timeLimitSec: problem?.timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC,
                })
            );
            const runStarted = performance.now();
            await Promise.all(
                tests.map(async (test) => {
                    state.testStates.set(test.id, { phase: 'running' });
                    results.renderOne(test);
                    const result = await pool.run(
                        lang,
                        { source, artifact: compiled.artifact },
                        test.input,
                        timeout
                    );
                    state.testStates.set(test.id, { phase: 'done', result });
                    state.warmed.add(lang.runtime);
                    const verdict = verdictOf(test, result, results.judgeContext());
                    // 실패한 테스트는 접어 두었더라도 펼쳐서 보여 줍니다.
                    if (isBadVerdict(verdict)) results.setOpen(test.id, true);
                    state.stage = { kind: 'running', done: ++done, total: tests.length };
                    results.renderOne(test);
                })
            );
            // 예제는 병렬로 돌므로 모든 예제가 끝날 때까지의 시간 (런타임을 처음 불러오는 시간 포함)
            timing.runMs = performance.now() - runStarted;
            // 하나만 돌린 결과로는 "예제를 모두 통과했는지" 알 수 없으므로 제출 전 확인 기준은 바꾸지 않습니다.
            if (!only)
                state.lastRun = {
                    source,
                    languageId: lang.id,
                    verdicts: results.doneVerdicts(),
                    compileError: false,
                };
        } catch (error) {
            showToast(error instanceof Error ? error.message : String(error), 'error');
        } finally {
            setStage(null);
            results.renderTests();
            // 실패한 첫 예제가 보이도록 스크롤
            els.testList.querySelector('.test.is-fail')?.scrollIntoView({ block: 'nearest' });
        }
    };

    const stopTests = () => {
        state.cancelRequested = true;
        pool.cancelAll();
    };

    return { runTests, stopTests };
};
