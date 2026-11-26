// 결과 패널: 예제·내 테스트 카드 목록과 상태 줄 (카드 하나의 모양은 tests-view.ts)
import { judgeMemoryLimitMB, problemTimeLimitMs, type RuntimeKey } from '../shared/languages.ts';
import type { CodeStore } from './code-store.ts';
import { h } from './dom.ts';
import type { CodeEditor } from './editor.ts';
import type { Elements } from './elements.ts';
import { linkifyLocations } from './locations.ts';
import { resultKeyOf, type SolverState } from './state.ts';
import {
    renderTest,
    verdictOf,
    type JudgeContext,
    type TestCase,
    type Verdict,
} from './tests-view.ts';

const RUNTIME_NAME: Record<RuntimeKey, string> = {
    cpp: 'C++ 컴파일러',
    python: 'Python 실행기',
    javascript: 'node.js 실행기',
    java: 'Java 컴파일러',
};

const formatDuration = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.max(0, Math.round(ms))}ms`;

/** 내 테스트 id (같은 밀리초에 두 번 만들어도 겹치지 않게) */
let testIdSeq = 0;
export const newTestId = () => `custom-${Date.now()}-${++testIdSeq}`;

export const createResultsView = (deps: {
    state: SolverState;
    els: Elements;
    editor: CodeEditor;
    store: CodeStore;
    /** 카드의 "이 테스트만 실행" */
    runOne: (id: string) => void;
}) => {
    const { state, els, editor, store } = deps;

    const allTests = (): TestCase[] => [
        ...(state.problem?.samples ?? []).map((s, i) => ({
            id: `sample-${i}`,
            kind: 'sample' as const,
            label: `예제 ${i + 1}`,
            input: s.input,
            expected: s.output,
        })),
        ...state.customTests.map((t, i) => ({
            id: t.id,
            kind: 'custom' as const,
            label: `내 테스트 ${i + 1}`,
            input: t.input,
            expected: t.expected,
        })),
    ];

    const judgeContext = (): JudgeContext => {
        const { problem, current } = state;
        return {
            specialJudge: problem?.isSpecialJudge ?? false,
            tolerance: problem?.tolerance ?? null,
            toleranceMode: problem?.toleranceMode ?? 'either',
            interactive: problem?.kind === 'interactive',
            memoryLimitMB:
                current && problem?.memoryLimitMB
                    ? judgeMemoryLimitMB(current, problem.memoryLimitMB)
                    : null,
        };
    };

    /** 지금 언어에 BOJ가 적용하는 시간 제한. 문제 정보가 없으면 null (경고를 띄우지 않음) */
    const judgeLimitMs = () => {
        const { problem, current } = state;
        return current && problem?.timeLimitSec
            ? problemTimeLimitMs(current, { ...problem, timeLimitSec: problem.timeLimitSec })
            : null;
    };

    /** 예제는 펼친 채로 시작하고(접은 것만 기억), 내 테스트는 펼친 것만 기억합니다. */
    const isOpen = (id: string) =>
        id.startsWith('sample-') ? !state.closedSamples.has(id) : state.openTests.has(id);
    const setOpen = (id: string, open: boolean) => {
        if (id.startsWith('sample-')) {
            if (open) state.closedSamples.delete(id);
            else state.closedSamples.add(id);
        } else if (open) state.openTests.add(id);
        else state.openTests.delete(id);
    };

    /** 에러의 소스 위치를 누르면 에디터의 그 줄로 갑니다. */
    const jumpToSource = (line: number, column: number | null) => editor.goTo(line, column);

    const callbacks = {
        onJumpToSource: jumpToSource,
        onRunOne: (test: TestCase) => deps.runOne(test.id),
        onToggle: (id: string) => {
            setOpen(id, !isOpen(id));
            const test = allTests().find((t) => t.id === id);
            if (test) renderOne(test);
        },
        onReplaceCustom: (id: string, patch: { input?: string; expected?: string }) => {
            callbacks.onChangeCustom(id, patch);
            const test = allTests().find((t) => t.id === id);
            if (test) renderOne(test);
        },
        onChangeCustom: (id: string, patch: { input?: string; expected?: string }) => {
            state.customTests = state.customTests.map((t) =>
                t.id === id ? { ...t, ...patch } : t
            );
            // 입력이 바뀌면 그 결과는 더 이상 이 테스트의 결과가 아닙니다. (기대 출력만 바뀌면 다시 판정)
            if (patch.input !== undefined && state.testStates.get(id)?.phase === 'done')
                state.testStates.set(id, { phase: 'idle' });
            store.scheduleTestsSave();
            renderStatus();
        },
        onCommitCustom: (id: string) => {
            // 같은 카드의 다른 칸으로 옮겨 갔으면 아직 고치는 중이니 다시 그리지 않습니다.
            const card = els.testList.querySelector(`[data-id="${CSS.escape(id)}"]`);
            if (card?.contains(document.activeElement)) return;
            const test = allTests().find((t) => t.id === id);
            if (test) renderOne(test);
        },
        onDuplicate: (test: TestCase) => {
            const id = newTestId();
            state.customTests = [
                ...state.customTests,
                { id, input: test.input, expected: test.expected },
            ];
            state.openTests.add(id);
            store.saveTestsImmediately();
            renderTests();
            const card = els.testList.querySelector(`[data-id="${id}"]`);
            card?.scrollIntoView({ block: 'nearest' });
            card?.querySelector('textarea')?.focus();
        },
        onDeleteCustom: (id: string) => {
            state.customTests = state.customTests.filter((t) => t.id !== id);
            state.testStates.delete(id);
            state.openTests.delete(id);
            store.saveTestsImmediately();
            renderTests();
        },
    };

    /** "+ 테스트": 빈 내 테스트를 추가하고 입력 칸으로 */
    const addTest = () => {
        const id = newTestId();
        state.customTests = [...state.customTests, { id, input: '', expected: '' }];
        state.openTests.add(id);
        store.saveTestsImmediately();
        renderTests();
        els.testList.querySelector<HTMLTextAreaElement>(`[data-id="${id}"] textarea`)?.focus();
    };

    const renderCard = (t: TestCase) =>
        renderTest(
            t,
            state.testStates.get(t.id) ?? { phase: 'idle' },
            isOpen(t.id),
            judgeContext(),
            judgeLimitMs(),
            callbacks
        );

    const renderTests = () => {
        const tests = allTests();
        els.testList.replaceChildren(
            ...(tests.length
                ? tests.map(renderCard)
                : [
                      h(
                          'p',
                          { class: 'empty' },
                          state.problem
                              ? '예제가 없습니다. 테스트를 추가해 보세요.'
                              : '문제 페이지를 열면 예제가 여기에 나타납니다.'
                      ),
                  ])
        );
        renderStatus();
    };

    /** 한 카드만 다시 그립니다 (입력 중인 다른 카드의 포커스를 지키기 위해). */
    const renderOne = (test: TestCase) => {
        const old = els.testList.querySelector(`[data-id="${CSS.escape(test.id)}"]`);
        if (old) old.replaceWith(renderCard(test));
        renderStatus();
    };

    const doneVerdicts = (): Verdict[] =>
        allTests().flatMap((t) => {
            const s = state.testStates.get(t.id);
            return s?.phase === 'done' ? [verdictOf(t, s.result, judgeContext())] : [];
        });

    const timingText = () => {
        const timing = state.lastTiming;
        if (!timing) return null;
        const parts: string[] = [];
        if (timing.compileMs !== null) {
            parts.push(
                timing.compileMs < 30
                    ? '컴파일 결과 재사용'
                    : `컴파일 ${formatDuration(timing.compileMs)}${timing.firstLoad ? ' (컴파일러 불러오기 포함)' : ''}`
            );
        }
        if (timing.runMs !== null) parts.push(`실행 ${formatDuration(timing.runMs)}`);
        return parts.length ? parts.join(' · ') : null;
    };

    /** 실행(불러오기·컴파일 포함)을 시작한 시각 */
    let stageStarted = 0;
    const elapsedText = () => {
        const elapsed = performance.now() - stageStarted;
        return elapsed >= 1000 ? `${(elapsed / 1000).toFixed(1)}초` : '';
    };
    const stageBegan = () => (stageStarted = performance.now());
    /** 경과 시간 칸의 글자만 바꿉니다. (화면 낭독기가 상태 줄 전체를 다시 읽지 않게) */
    const updateElapsed = () => {
        const span = els.statusBox.querySelector('.status-elapsed');
        if (span) span.textContent = elapsedText();
    };

    const renderStatus = () => {
        const { stage, current, compileMessage } = state;
        const parts: (Node | string)[] = [];
        if (stage) {
            parts.push(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
            if (stage.kind === 'loading' && current) {
                parts.push(
                    h('span', {}, `${RUNTIME_NAME[current.runtime]} 불러오는 중`),
                    h('span', { class: 'status-sub' }, '처음 한 번만 몇 초 걸립니다')
                );
            } else if (stage.kind === 'compiling') {
                parts.push(h('span', {}, '컴파일 중'));
            } else {
                parts.push(h('span', {}, `실행 중 ${stage.done ?? 0}/${stage.total ?? 0}`));
            }
            // 1초가 넘으면 경과 시간을 보여 줍니다. (시간 초과가 날 코드도 멈춘 게 아님을 알 수 있게)
            // 화면 낭독기가 0.2초마다 상태 줄 전체를 다시 읽지 않도록 경과 시간은 읽지 않는 칸에 두고
            // 그 칸의 글자만 바꿉니다. (updateElapsed)
            parts.push(
                h(
                    'span',
                    { class: 'status-sub status-elapsed', 'aria-hidden': 'true' },
                    elapsedText()
                )
            );
        } else if (compileMessage?.kind === 'error') {
            parts.push(h('span', { class: 'status-fail' }, '✕ 컴파일 에러'));
            const timing = timingText();
            if (timing) parts.push(h('span', { class: 'status-sub' }, timing));
        } else {
            const verdicts = doneVerdicts();
            if (verdicts.length === 0) {
                // 실행 단축키는 에디터 아래 막대에 있으므로 여기서는 무엇을 돌릴지만 알려 줍니다.
                const samples = state.problem?.samples.length ?? 0;
                const custom = state.customTests.length;
                parts.push(
                    h(
                        'span',
                        { class: 'status-hint' },
                        custom ? `예제 ${samples}개 · 내 테스트 ${custom}개` : `예제 ${samples}개`
                    )
                );
            } else if (verdicts.every((v) => v === 'cancelled')) {
                parts.push(h('span', { class: 'status-hint' }, '중단했습니다'));
            } else {
                const judged = verdicts.filter((v) => v !== 'output' && v !== 'cancelled');
                const passed = judged.filter((v) => v === 'pass').length;
                if (judged.length === 0) parts.push(h('span', {}, '실행 완료'));
                else if (passed === judged.length)
                    parts.push(
                        h(
                            'span',
                            { class: 'status-pass' },
                            `✓ 모두 통과 (${passed}/${judged.length})`
                        )
                    );
                else
                    parts.push(
                        h('span', { class: 'status-fail' }, `✕ ${passed}/${judged.length} 통과`)
                    );
                const timing = timingText();
                if (timing) parts.push(h('span', { class: 'status-sub' }, timing));
                // 결과를 낸 뒤 코드를 고쳤으면, 이 결과가 지금 코드의 것이 아님을 알립니다.
                if (
                    current &&
                    state.resultsKey !== null &&
                    state.resultsKey !== resultKeyOf(current.id, editor.value)
                )
                    parts.push(
                        h(
                            'span',
                            { class: 'status-sub status-stale' },
                            '코드를 고친 뒤 아직 실행하지 않음'
                        )
                    );
            }
        }
        els.statusBox.replaceChildren(...parts);

        els.compileBox.hidden = !compileMessage;
        if (compileMessage) {
            els.compileBox.className = `compile-box compile-${compileMessage.kind}`;
            els.compileBox.replaceChildren(
                h('h3', {}, compileMessage.kind === 'error' ? '컴파일 에러' : '컴파일 경고'),
                h('pre', {}, linkifyLocations(compileMessage.text, jumpToSource))
            );
        }
    };

    return {
        allTests,
        judgeContext,
        setOpen,
        addTest,
        renderTests,
        renderOne,
        renderStatus,
        doneVerdicts,
        stageBegan,
        updateElapsed,
    };
};

export type ResultsView = ReturnType<typeof createResultsView>;
