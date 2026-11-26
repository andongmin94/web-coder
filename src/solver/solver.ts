// 솔버 iframe 진입점 (확장 페이지, BOJ 페이지 위에 전체 화면으로 뜸)
import 'katex/dist/katex.min.css';
import './solver.css';
import {
    isBojOrigin,
    type ParentToSolver,
    type ProblemData,
    type SolverToParent,
    type SubmitFormData,
} from '../shared/protocol.ts';
import {
    RUNTIMES,
    judgeMemoryLimitMB,
    problemTimeLimitMs,
    localTimeoutMs,
    resolveLanguages,
    type ResolvedLanguage,
    type RuntimeKey,
} from '../shared/languages.ts';
import { RunnerPool } from '../runner/pool.ts';
import { CodeEditor } from './editor.ts';
import { setupEditorSettings } from './editor-settings.ts';
import { linkifyLocations } from './locations.ts';
import { limitChips, renderProblem, renderProblemMissing } from './problem-view.ts';
import {
    isBadVerdict,
    renderTest,
    verdictOf,
    type TestCase,
    type TestState,
    type JudgeContext,
    type Verdict,
} from './tests-view.ts';
import { storage, type CustomTest } from './storage.ts';
import { chooseInitialLanguage, submitWarning } from './decisions.ts';
import { autoPrune, touchProblem } from './storage-prune.ts';
import { setupSplit } from './split.ts';
import { $, h } from './dom.ts';
import type { LanguageIntel } from '../intel/types.ts';
import type { JavaIndex } from '../intel/classfile.ts';
import { createCppIntel } from '../intel/cpp.ts';
import { createJavaScriptIntel } from '../intel/javascript.ts';
import { createPythonIntel } from '../intel/python.ts';
import { createJavaIntel } from '../intel/java.ts';

// ── 임베드 위치 확인 ─────────────────────────────────────────────
const parentOrigin = location.ancestorOrigins?.[0];
if (window.parent === window || !isBojOrigin(parentOrigin)) {
    document.body.textContent = '웹 코더는 백준 제출 페이지 안에서만 동작합니다.';
    throw new Error('not embedded in BOJ');
}

const bojOrigin: string = parentOrigin!;
const send = (message: SolverToParent) => window.parent.postMessage(message, bojOrigin);

/** 템플릿을 나눠 저장하는 단위 (C++17과 C++20은 같은 템플릿) */
const LANGUAGE_GROUP: Record<RuntimeKey, string> = {
    cpp: 'C++',
    python: 'Python',
    javascript: 'node.js',
    java: 'Java',
};

const RUNTIME_NAME: Record<RuntimeKey, string> = {
    cpp: 'C++ 컴파일러',
    python: 'Python 실행기',
    javascript: 'node.js 실행기',
    java: 'Java 컴파일러',
};

// ── 상태 ─────────────────────────────────────────────────────────
const pool = new RunnerPool();
let problemId = '';
let problem: ProblemData | null = null;
let languages: ResolvedLanguage[] = [];
let current: ResolvedLanguage | null = null;
let codeOpenValue: string | null = null;
let customTests: CustomTest[] = [];
const testStates = new Map<string, TestState>();
/** Mac에서는 Ctrl+B가 에디터의 '커서 왼쪽'이라 문제 접기는 Cmd+B로 받습니다. */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** 내 테스트 id (같은 밀리초에 두 번 만들어도 겹치지 않게) */
let testIdSeq = 0;
const newTestId = () => `custom-${Date.now()}-${++testIdSeq}`;
/** 펼쳐 둔 내 테스트 */
const openTests = new Set<string>();
/** 접어 둔 예제 (예제는 기본으로 펼침) */
const closedSamples = new Set<string>();
/** 이 세션에서 한 번이라도 준비가 끝난 런타임 (첫 로딩 안내용) */
const warmed = new Set<RuntimeKey>();

type Stage = { kind: 'loading' | 'compiling' | 'running'; done?: number; total?: number };
let stage: Stage | null = null;
let cancelRequested = false;
let submitting = false;
let compileMessage: { kind: 'error' | 'warning'; text: string } | null = null;
/** 마지막 실행 결과 (제출 전 확인용) */
let lastRun: {
    source: string;
    languageId: string;
    verdicts: Verdict[];
    compileError: boolean;
} | null = null;
/** 지금 보이는 테스트 결과를 만든 언어와 코드 (하나만 실행할 때 옛 결과를 지울지 판단) */
let resultsKey: string | null = null;
/** 마지막 실행에 걸린 시간: 컴파일(C++, Java)과 예제 실행을 나눠 상태 줄에 보여 줍니다. */
let lastTiming: { compileMs: number | null; firstLoad: boolean; runMs: number | null } | null =
    null;

const formatDuration = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.max(0, Math.round(ms))}ms`;

const timingText = () => {
    if (!lastTiming) return null;
    const parts: string[] = [];
    if (lastTiming.compileMs !== null) {
        parts.push(
            lastTiming.compileMs < 30
                ? '컴파일 결과 재사용'
                : `컴파일 ${formatDuration(lastTiming.compileMs)}${lastTiming.firstLoad ? ' (컴파일러 불러오기 포함)' : ''}`
        );
    }
    if (lastTiming.runMs !== null) parts.push(`실행 ${formatDuration(lastTiming.runMs)}`);
    return parts.length ? parts.join(' · ') : null;
};

// ── 요소 ─────────────────────────────────────────────────────────
const problemPane = $('#problem-pane');
const problemContent = $('#problem-content');
const problemLink = $<HTMLAnchorElement>('#problem-link');
const problemTitle = $('#problem-title');
const problemLimits = $('#problem-limits');
const languageSelect = $<HTMLSelectElement>('#language');
const codeOpenSelect = $<HTMLSelectElement>('#code-open');
const runButton = $<HTMLButtonElement>('#run');
const stopButton = $<HTMLButtonElement>('#stop');
const submitButton = $<HTMLButtonElement>('#submit');
const confirmBox = $('#confirm');
const confirmText = $('#confirm-text');
const settingsButton = $<HTMLButtonElement>('#settings-button');
const settingsPanel = $('#settings');
const resetButton = $<HTMLButtonElement>('#reset');
const closeButton = $<HTMLButtonElement>('#close');
const addTestButton = $<HTMLButtonElement>('#add-test');
const testList = $('#test-list');
const statusBox = $('#status');
const compileBox = $('#compile-box');
const toast = $('#toast');

let toastTimer = 0;
const showToast = (message: string, kind: 'info' | 'error' = 'info') => {
    toast.textContent = message;
    toast.className = `toast toast-${kind} show`;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 4000);
};

// ── 코드 저장 (디바운스) ─────────────────────────────────────────
let saveTimer = 0;
/**
 * 코드·테스트 저장. 실패(저장 공간 부족 등)를 그냥 넘기면 새로고침 때 고친 내용이 사라지므로 알립니다.
 * (같은 알림이 연달아 뜨지 않게 한 번만)
 */
let saveErrorShown = false;
const persist = (write: Promise<unknown>) => {
    write.then(
        () => (saveErrorShown = false),
        (error: unknown) => {
            if (saveErrorShown) return;
            saveErrorShown = true;
            showToast(
                `저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}. ` +
                    '지금 코드는 따로 복사해 두세요.',
                'error'
            );
        }
    );
};

/** 내 테스트는 칸에 입력할 때마다 저장하지 않고 모아서 저장합니다. (큰 입력이 여럿이면 매번 수 MB를 씀) */
let testsSaveTimer = 0;
const saveTestsNow = () => {
    if (!testsSaveTimer) return;
    clearTimeout(testsSaveTimer);
    testsSaveTimer = 0;
    if (problemId) persist(storage.setCustomTests(problemId, customTests));
};
const scheduleTestsSave = () => {
    clearTimeout(testsSaveTimer);
    testsSaveTimer = window.setTimeout(saveTestsNow, 400);
};

/**
 * 저장소에 있는 지금 언어의 코드 (이 탭이 읽거나 쓴 마지막 값). 에디터 내용이 이것과 같으면 저장하지 않습니다.
 * 같은 문제를 탭 두 개로 열었을 때, 고치지 않은 옛 탭이 실행·언어 바꾸기·탭 닫기 때 옛 코드를 저장해
 * 다른 탭에서 고친 코드를 덮어쓰던 것을 막습니다. (다른 탭의 저장은 아래 onChanged에서 받아 옴)
 */
let savedCode: string | undefined;
/** 언어를 고를 때 에디터에 올린 코드 (저장된 적 없는 템플릿이면 savedCode는 없음) */
let loadedCode: string | undefined;

const saveCodeNow = () => {
    clearTimeout(saveTimer);
    saveTestsNow();
    if (!problemId || !current) return;
    const code = editor.value;
    if (code === savedCode) return;
    savedCode = code;
    persist(storage.setCode(problemId, current.id, code));
};
/** 코드를 고치면 저장하고, 상태 줄의 "고친 뒤 실행 안 함" 표시를 갱신합니다. */
const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        saveCodeNow();
        if (!stage) renderStatus();
    }, 400);
};

const editor = new CodeEditor($('#editor'), {
    onChange: scheduleSave,
    onRun: () => void runTests(),
    onSubmit: () => requestSubmit(),
    onNotice: (message) => showToast(message, 'error'),
});

// ── 테스트 목록 ──────────────────────────────────────────────────
const allTests = (): TestCase[] => [
    ...(problem?.samples ?? []).map((s, i) => ({
        id: `sample-${i}`,
        kind: 'sample' as const,
        label: `예제 ${i + 1}`,
        input: s.input,
        expected: s.output,
    })),
    ...customTests.map((t, i) => ({
        id: t.id,
        kind: 'custom' as const,
        label: `내 테스트 ${i + 1}`,
        input: t.input,
        expected: t.expected,
    })),
];

const judgeContext = (): JudgeContext => ({
    specialJudge: problem?.isSpecialJudge ?? false,
    tolerance: problem?.tolerance ?? null,
    toleranceMode: problem?.toleranceMode ?? 'either',
    interactive: problem?.kind === 'interactive',
    memoryLimitMB:
        current && problem?.memoryLimitMB
            ? judgeMemoryLimitMB(current, problem.memoryLimitMB)
            : null,
});

/** 예제는 펼친 채로 시작하고(접은 것만 기억), 내 테스트는 펼친 것만 기억합니다. */
const isOpen = (id: string) =>
    id.startsWith('sample-') ? !closedSamples.has(id) : openTests.has(id);
const setOpen = (id: string, open: boolean) => {
    if (id.startsWith('sample-')) {
        if (open) closedSamples.delete(id);
        else closedSamples.add(id);
    } else if (open) openTests.add(id);
    else openTests.delete(id);
};

/** 에러의 소스 위치를 누르면 에디터의 그 줄로 갑니다. */
const jumpToSource = (line: number, column: number | null) => editor.goTo(line, column);

const callbacks = {
    onJumpToSource: jumpToSource,
    onRunOne: (test: TestCase) => void runTests(test.id),
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
        customTests = customTests.map((t) => (t.id === id ? { ...t, ...patch } : t));
        // 입력이 바뀌면 그 결과는 더 이상 이 테스트의 결과가 아닙니다. (기대 출력만 바뀌면 다시 판정)
        if (patch.input !== undefined && testStates.get(id)?.phase === 'done')
            testStates.set(id, { phase: 'idle' });
        scheduleTestsSave();
        renderStatus();
    },
    onCommitCustom: (id: string) => {
        // 같은 카드의 다른 칸으로 옮겨 갔으면 아직 고치는 중이니 다시 그리지 않습니다.
        const card = testList.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (card?.contains(document.activeElement)) return;
        const test = allTests().find((t) => t.id === id);
        if (test) renderOne(test);
    },
    onDuplicate: (test: TestCase) => {
        const id = newTestId();
        customTests = [...customTests, { id, input: test.input, expected: test.expected }];
        openTests.add(id);
        if (problemId) persist(storage.setCustomTests(problemId, customTests));
        renderTests();
        const card = testList.querySelector(`[data-id="${id}"]`);
        card?.scrollIntoView({ block: 'nearest' });
        card?.querySelector('textarea')?.focus();
    },
    onDeleteCustom: (id: string) => {
        customTests = customTests.filter((t) => t.id !== id);
        testStates.delete(id);
        openTests.delete(id);
        if (problemId) persist(storage.setCustomTests(problemId, customTests));
        renderTests();
    },
};

const renderCard = (t: TestCase) =>
    renderTest(
        t,
        testStates.get(t.id) ?? { phase: 'idle' },
        isOpen(t.id),
        judgeContext(),
        judgeLimitMs(),
        callbacks
    );

const renderTests = () => {
    const tests = allTests();
    testList.replaceChildren(
        ...(tests.length
            ? tests.map(renderCard)
            : [
                  h(
                      'p',
                      { class: 'empty' },
                      problem
                          ? '예제가 없습니다. 테스트를 추가해 보세요.'
                          : '문제 페이지를 열면 예제가 여기에 나타납니다.'
                  ),
              ])
    );
    renderStatus();
};

/** 한 카드만 다시 그립니다 (입력 중인 다른 카드의 포커스를 지키기 위해). */
const renderOne = (test: TestCase) => {
    const old = testList.querySelector(`[data-id="${CSS.escape(test.id)}"]`);
    if (old) old.replaceWith(renderCard(test));
    renderStatus();
};

const doneVerdicts = (): Verdict[] =>
    allTests().flatMap((t) => {
        const s = testStates.get(t.id);
        return s?.phase === 'done' ? [verdictOf(t, s.result, judgeContext())] : [];
    });

const renderStatus = () => {
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
            h('span', { class: 'status-sub status-elapsed', 'aria-hidden': 'true' }, elapsedText())
        );
    } else if (compileMessage?.kind === 'error') {
        parts.push(h('span', { class: 'status-fail' }, '✕ 컴파일 에러'));
        const timing = timingText();
        if (timing) parts.push(h('span', { class: 'status-sub' }, timing));
    } else {
        const verdicts = doneVerdicts();
        if (verdicts.length === 0) {
            // 실행 단축키는 에디터 아래 막대에 있으므로 여기서는 무엇을 돌릴지만 알려 줍니다.
            const samples = problem?.samples.length ?? 0;
            parts.push(
                h(
                    'span',
                    { class: 'status-hint' },
                    customTests.length
                        ? `예제 ${samples}개 · 내 테스트 ${customTests.length}개`
                        : `예제 ${samples}개`
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
                    h('span', { class: 'status-pass' }, `✓ 모두 통과 (${passed}/${judged.length})`)
                );
            else
                parts.push(
                    h('span', { class: 'status-fail' }, `✕ ${passed}/${judged.length} 통과`)
                );
            const timing = timingText();
            if (timing) parts.push(h('span', { class: 'status-sub' }, timing));
            // 결과를 낸 뒤 코드를 고쳤으면, 이 결과가 지금 코드의 것이 아님을 알립니다.
            if (current && resultsKey !== null && resultsKey !== `${current.id}\n${editor.value}`)
                parts.push(
                    h(
                        'span',
                        { class: 'status-sub status-stale' },
                        '코드를 고친 뒤 아직 실행하지 않음'
                    )
                );
        }
    }
    statusBox.replaceChildren(...parts);

    compileBox.hidden = !compileMessage;
    if (compileMessage) {
        compileBox.className = `compile-box compile-${compileMessage.kind}`;
        compileBox.replaceChildren(
            h('h3', {}, compileMessage.kind === 'error' ? '컴파일 에러' : '컴파일 경고'),
            h('pre', {}, linkifyLocations(compileMessage.text, jumpToSource))
        );
    }
};

// ── 실행 ─────────────────────────────────────────────────────────
/** 문제에 시간 제한 정보가 없을 때 쓰는 값 (초) */
const DEFAULT_TIME_LIMIT_SEC = 2;

/** 지금 언어에 BOJ가 적용하는 시간 제한. 문제 정보가 없으면 null (경고를 띄우지 않음) */
const judgeLimitMs = () =>
    current && problem?.timeLimitSec
        ? problemTimeLimitMs(current, { ...problem, timeLimitSec: problem.timeLimitSec })
        : null;

/** 실행(불러오기·컴파일 포함)을 시작한 시각과, 경과 시간을 다시 그리는 타이머 */
let stageStarted = 0;
let stageTicker = 0;

const elapsedText = () => {
    const elapsed = performance.now() - stageStarted;
    return elapsed >= 1000 ? `${(elapsed / 1000).toFixed(1)}초` : '';
};
const updateElapsed = () => {
    const span = statusBox.querySelector('.status-elapsed');
    if (span) span.textContent = elapsedText();
};

const setStage = (next: Stage | null) => {
    if (next && !stage) {
        stageStarted = performance.now();
        stageTicker = window.setInterval(updateElapsed, 200);
    } else if (!next) {
        clearInterval(stageTicker);
    }
    stage = next;
    const busy = next !== null;
    runButton.hidden = busy;
    stopButton.hidden = !busy;
    languageSelect.disabled = busy;
    renderStatus();
};

/** 테스트를 실행합니다. only를 주면 그 테스트만 (다른 테스트의 결과는 그대로 둠) */
const runTests = async (only?: string) => {
    if (stage || switching || !current) return;
    if (problem?.kind === 'function') {
        showToast('함수만 구현하는 문제라 로컬에서 실행할 수 없습니다. (main 함수가 없음)');
        return;
    }
    const lang = current;
    const all = allTests();
    const tests = only ? all.filter((t) => t.id === only) : all;
    if (!tests.length) {
        showToast('실행할 예제가 없습니다. "+ 테스트"로 입력을 추가해 보세요.');
        return;
    }
    saveCodeNow();
    const source = editor.value;
    const needsCompile = lang.runtime === 'cpp' || lang.runtime === 'java';
    const firstTime = !warmed.has(lang.runtime);

    cancelRequested = false;
    compileMessage = null;
    // 하나만 돌릴 때 코드(또는 언어)가 바뀌었으면, 다른 테스트의 옛 결과는 지워
    // "모두 통과" 같은 집계에 섞이지 않게 합니다.
    const resultKey = `${lang.id}\n${source}`;
    if (only && resultsKey !== resultKey)
        for (const t of all) if (t.id !== only) testStates.set(t.id, { phase: 'idle' });
    resultsKey = resultKey;
    for (const t of tests) testStates.set(t.id, { phase: 'queued' });
    setStage({
        kind: needsCompile
            ? firstTime
                ? 'loading'
                : 'compiling'
            : firstTime
              ? 'loading'
              : 'running',
        done: 0,
        total: tests.length,
    });
    renderTests();
    lastTiming = null;

    try {
        const compileStarted = performance.now();
        const compiled = await pool.compile(lang, source);
        lastTiming = {
            compileMs: needsCompile ? performance.now() - compileStarted : null,
            firstLoad: needsCompile && firstTime,
            runMs: null,
        };
        if (cancelRequested) {
            for (const t of tests) testStates.set(t.id, { phase: 'idle' });
            return;
        }
        if (!compiled.ok) {
            warmed.add(lang.runtime);
            compileMessage = { kind: 'error', text: compiled.diagnostics };
            // 컴파일이 안 되면 어떤 테스트도 돌 수 없습니다.
            for (const t of all) testStates.set(t.id, { phase: 'skipped' });
            lastRun = { source, languageId: lang.id, verdicts: [], compileError: true };
            return;
        }
        if (needsCompile) warmed.add(lang.runtime);
        if (compiled.diagnostics) compileMessage = { kind: 'warning', text: compiled.diagnostics };

        let done = 0;
        setStage({
            kind: warmed.has(lang.runtime) ? 'running' : 'loading',
            done,
            total: tests.length,
        });
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
                testStates.set(test.id, { phase: 'running' });
                renderOne(test);
                const result = await pool.run(
                    lang,
                    { source, artifact: compiled.artifact },
                    test.input,
                    timeout
                );
                testStates.set(test.id, { phase: 'done', result });
                warmed.add(lang.runtime);
                const verdict = verdictOf(test, result, judgeContext());
                // 실패한 테스트는 접어 두었더라도 펼쳐서 보여 줍니다.
                if (isBadVerdict(verdict)) setOpen(test.id, true);
                stage = { kind: 'running', done: ++done, total: tests.length };
                renderOne(test);
            })
        );
        // 예제는 병렬로 돌므로 모든 예제가 끝날 때까지의 시간 (런타임을 처음 불러오는 시간 포함)
        lastTiming.runMs = performance.now() - runStarted;
        // 하나만 돌린 결과로는 "예제를 모두 통과했는지" 알 수 없으므로 제출 전 확인 기준은 바꾸지 않습니다.
        if (!only)
            lastRun = {
                source,
                languageId: lang.id,
                verdicts: doneVerdicts(),
                compileError: false,
            };
    } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
        setStage(null);
        renderTests();
        // 실패한 첫 예제가 보이도록 스크롤
        testList.querySelector('.test.is-fail')?.scrollIntoView({ block: 'nearest' });
    }
};

const stopTests = () => {
    cancelRequested = true;
    pool.cancelAll();
};

// ── 인텔리센스 ───────────────────────────────────────────────────
// 언어별 엔진은 처음 고를 때 만들고 계속 재사용합니다.
const intels = new Map<string, LanguageIntel>();
/** Java 버전별 자동완성 색인 (build.ts). release ''는 버전을 고르지 않는 Java(최신) */
const javaIndexes = new Map<string, Promise<JavaIndex>>();
const loadJavaIndex = (release: string) => {
    let index = javaIndexes.get(release);
    if (!index) {
        index = fetch(`intel/java-index${release ? `-${release}` : ''}.json`).then((r) => {
            if (!r.ok) throw new Error(`Java 색인을 불러오지 못했습니다 (${r.status})`);
            return r.json() as Promise<JavaIndex>;
        });
        index.catch(() => javaIndexes.delete(release));
        javaIndexes.set(release, index);
    }
    return index;
};

/** 고르지 않은 언어의 인텔리센스 엔진을 끄기까지의 시간 */
const IDLE_INTEL_MS = 5 * 60_000;
const idleIntelTimers = new Map<string, number>();

const intelFor = (lang: ResolvedLanguage): LanguageIntel => {
    const key =
        lang.runtime === 'cpp'
            ? `cpp:${lang.cppStd}`
            : lang.runtime === 'java'
              ? `java:${lang.javaRelease}`
              : lang.runtime;
    let intel = intels.get(key);
    if (!intel) {
        switch (lang.runtime) {
            case 'cpp':
                intel = createCppIntel(pool, lang.cppStd ?? 'c++17');
                break;
            case 'javascript':
                intel = createJavaScriptIntel();
                break;
            case 'python':
                intel = createPythonIntel();
                break;
            case 'java':
                intel = createJavaIntel(
                    () => loadJavaIndex(lang.javaRelease ?? ''),
                    (code) => pool.javaCheck(code, lang.javaRelease ?? '')
                );
                break;
        }
        intels.set(key, intel);
    }
    // 다른 언어의 엔진(워커)은 한동안 다시 고르지 않으면 끕니다. (Pyright·TypeScript 워커는 수십 MB)
    clearTimeout(idleIntelTimers.get(key));
    idleIntelTimers.delete(key);
    for (const [other, engine] of intels) {
        if (other === key || !engine.dispose || idleIntelTimers.has(other)) continue;
        idleIntelTimers.set(
            other,
            window.setTimeout(() => {
                idleIntelTimers.delete(other);
                intels.delete(other);
                engine.dispose?.();
            }, IDLE_INTEL_MS)
        );
    }
    return intel;
};

// ── 언어 ─────────────────────────────────────────────────────────
/** 언어를 빠르게 연달아 바꿀 때 늦게 끝난 앞의 전환을 버리기 위한 번호 */
let switchSeq = 0;

/** 언어를 바꾸는 중(저장된 코드를 읽는 중)이면 실행하지 않습니다. (옛 언어로 돌아 결과가 섞임) */
let switching = false;
const switchLanguage = async (lang: ResolvedLanguage, initialCode?: string) => {
    const seq = ++switchSeq;
    switching = true;
    if (current) saveCodeNow();
    languageSelect.value = lang.id;

    const saved = problemId ? await storage.getCode(problemId, lang.id) : undefined;
    const code = initialCode ?? saved ?? (await templateFor(lang.runtime));
    // 기다리는 사이 다른 언어로 또 바꿨으면 그쪽이 이깁니다.
    // current는 새 코드를 에디터에 올린 뒤에 바꿉니다. 그 전에 바꾸면 에디터에 남은 이전 언어의 코드가
    // 새 언어 이름으로 저장됩니다. (빠르게 두 번 바꿀 때 코드가 덮어써지던 문제)
    if (seq !== switchSeq) return;
    switching = false;
    current = lang;
    savedCode = saved;
    loadedCode = code;
    editor.load(code, RUNTIMES[lang.runtime], intelFor(lang));
    void updateTemplateMenu();
    pool.warmUp(lang);

    compileMessage = null;
    testStates.clear();
    lastTiming = null;
    renderTests();
};

// ── 제출 ─────────────────────────────────────────────────────────
const closeConfirm = () => {
    confirmBox.hidden = true;
};

/** 현재 코드로 예제를 통과했는지 보고, 아니면 한 번 확인합니다. */
const requestSubmit = () => {
    if (submitting || !current) return;
    const source = editor.value;
    if (!source.trim()) {
        showToast('제출할 코드가 없습니다.', 'error');
        return;
    }
    const warning = submitWarning({
        functionOnly: problem?.kind === 'function',
        source,
        languageId: current.id,
        lastRun,
        currentVerdicts: resultsKey === `${current.id}\n${source}` ? doneVerdicts() : null,
        hasCustomTests: customTests.length > 0,
    });
    if (!warning) {
        submit();
        return;
    }
    confirmText.textContent = `${warning} 그래도 제출할까요?`;
    settingsPanel.hidden = true;
    confirmBox.hidden = false;
    $<HTMLButtonElement>('#confirm-cancel').focus();
};

const submit = () => {
    if (!current) return;
    closeConfirm();
    saveCodeNow();
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = '제출 중…';
    send({ type: 'submit', languageId: current.id, source: editor.value, codeOpen: codeOpenValue });
};

const onSubmitResult = (ok: boolean, message?: string) => {
    // 성공하면 BOJ가 채점 현황 페이지로 이동하므로 이 페이지는 사라집니다.
    if (ok) return;
    submitting = false;
    submitButton.disabled = false;
    submitButton.textContent = '제출';
    showToast(message ?? '제출에 실패했습니다.', 'error');
};

// ── 문제 ─────────────────────────────────────────────────────────
const renderHeader = () => {
    problemLink.textContent = `${problemId}번`;
    problemLink.href = `${bojOrigin}/problem/${problemId}`;
    problemTitle.textContent = problem?.title ?? '';
    problemLimits.replaceChildren(...(problem ? limitChips(problem) : []));
    document.title = problem
        ? `${problemId}번 ${problem.title} - 웹 코더`
        : `${problemId}번 - 웹 코더`;
};

/** 문제 데이터를 받으면(처음 또는 다른 탭에서 문제 페이지를 연 뒤) 화면과 예제를 갱신합니다. */
const applyProblem = (next: ProblemData) => {
    if (problem?.id !== next.id) closedSamples.clear();
    problem = next;
    renderHeader();
    renderProblem(problemContent, next);
    problemPane.scrollTop = 0;
    for (const key of [...testStates.keys()]) if (key.startsWith('sample-')) testStates.delete(key);
    renderTests();
};

// ── 초기화 ───────────────────────────────────────────────────────
const init = async (data: {
    problemId: string;
    problem: ProblemData | null;
    problemError?: string;
    form: SubmitFormData;
}) => {
    problemId = data.problemId;
    renderHeader();
    if (data.problem) applyProblem(data.problem);
    else renderProblemMissing(problemContent, `${bojOrigin}/problem/${problemId}`);

    // 공개 설정
    codeOpenSelect.replaceChildren(
        ...data.form.codeOpenOptions.map((o) => h('option', { value: o.value }, o.label))
    );
    // BOJ 폼에서 고른 값이 없으면 아무것도 보내지 않아 BOJ의 기본값을 따릅니다. (첫 항목은 "공개"일 수 있음)
    codeOpenValue = data.form.codeOpenValue ?? null;
    if (codeOpenValue) codeOpenSelect.value = codeOpenValue;
    else codeOpenSelect.selectedIndex = -1;
    (codeOpenSelect.closest('.menu-row') as HTMLElement).hidden =
        data.form.codeOpenOptions.length === 0;

    // 언어
    languages = resolveLanguages(data.form.languages);
    if (!languages.length) {
        $('#panes').replaceChildren(
            h('div', { class: 'notice-card' }, [
                h('strong', {}, '로컬 실행을 지원하지 않는 문제입니다'),
                h(
                    'span',
                    {},
                    '이 문제는 웹 코더가 지원하는 언어(C++, Python 3, node.js, Java)로 제출할 수 없습니다.'
                ),
                h('br'),
                h(
                    'button',
                    {
                        class: 'btn btn-primary',
                        type: 'button',
                        onclick: () => send({ type: 'restore' }),
                    },
                    'BOJ 기본 화면으로'
                ),
            ])
        );
        return;
    }
    languageSelect.replaceChildren(...languages.map((l) => h('option', { value: l.id }, l.label)));

    customTests = problemId ? await storage.getCustomTests(problemId) : [];

    const prefs = await storage.getPrefs();
    const choice = chooseInitialLanguage(languages, data.form, prefs.lastLanguageLabel);
    await switchLanguage(choice.language, choice.initialCode);
    // 저장 공간 자동 관리: 연 문제를 기록하고, 하루 한 번 예산을 넘었으면 오래된 것부터 정리 (storage-prune.ts)
    if (problemId)
        void touchProblem(problemId)
            .then(() => autoPrune(problemId))
            .catch(() => {});
    if (choice.unsupportedSource) {
        const label = data.form.languages.find((l) => l.id === data.form.selectedLanguageId)?.label;
        showToast(
            `이 제출의 언어${label ? `(${label})` : ''}는 웹 코더에서 실행할 수 없어 저장해 둔 코드를 열었습니다.`
        );
    }
    editor.focus();
};

// ── 이벤트 연결 ─────────────────────────────────────────────────
const restore = () => {
    saveCodeNow();
    // 편집한 코드를 원래 폼에 옮겨 둡니다. 그러지 않으면 원래 폼에 남은 옛 코드가 제출되거나,
    // 웹 코더를 다시 열 때 그 옛 코드가 저장해 둔 코드를 덮어씁니다.
    send(
        current
            ? {
                  type: 'restore',
                  languageId: current.id,
                  source: editor.value,
                  codeOpen: codeOpenValue,
              }
            : { type: 'restore' }
    );
};

languageSelect.addEventListener('change', () => {
    const lang = languages.find((l) => l.id === languageSelect.value);
    if (!lang) return;
    // 사용자가 직접 고른 언어만 기억합니다. (그 언어가 없는 문제에서 자동으로 고른 언어가
    // 다른 문제의 기본 언어를 바꾸지 않게)
    void storage.updatePrefs({ lastLanguageLabel: lang.label });
    void switchLanguage(lang);
});
codeOpenSelect.addEventListener('change', () => (codeOpenValue = codeOpenSelect.value));
runButton.addEventListener('click', () => void runTests());
stopButton.addEventListener('click', stopTests);
submitButton.addEventListener('click', requestSubmit);
$('#confirm-ok').addEventListener('click', submit);
$('#confirm-cancel').addEventListener('click', () => {
    closeConfirm();
    editor.focus();
});
closeButton.addEventListener('click', restore);

settingsButton.addEventListener('click', () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsButton.setAttribute('aria-expanded', String(!settingsPanel.hidden));
    closeConfirm();
    if (settingsPanel.hidden) return;
    // 좁은 화면에서는 결과 패널이 아래쪽이라, 아래 공간이 모자라면 위로 엽니다.
    const button = settingsButton.getBoundingClientRect();
    const below = window.innerHeight - button.bottom - 12;
    const above = button.top - 12;
    const up = settingsPanel.scrollHeight > below && above > below;
    settingsPanel.classList.toggle('menu-up', up);
    settingsPanel.style.maxHeight = `${Math.max(160, up ? above : below)}px`;
});
// ── 템플릿: 언어(런타임)별로 내 템플릿을 저장해 새 문제와 초기화에 씁니다 ──
const saveTemplateButton = $<HTMLButtonElement>('#save-template');
const clearTemplateButton = $<HTMLButtonElement>('#clear-template');

/** 내 템플릿이 있으면 그것, 없으면 기본 템플릿 */
const templateFor = async (runtime: RuntimeKey) =>
    (await storage.getTemplate(runtime)) ?? RUNTIMES[runtime].template;

const updateTemplateMenu = async () => {
    if (!current) return;
    const custom = await storage.getTemplate(current.runtime);
    resetButton.textContent = custom ? '내 템플릿으로 초기화' : '템플릿으로 초기화';
    clearTemplateButton.hidden = custom === undefined;
};

resetButton.addEventListener('click', async () => {
    settingsPanel.hidden = true;
    if (!current) return;
    const lang = current;
    const custom = await storage.getTemplate(lang.runtime);
    const what = custom ? '내 템플릿' : '기본 템플릿';
    if (!confirm(`코드를 ${what}으로 되돌릴까요? 지금 코드는 사라집니다.`)) return;
    editor.load(custom ?? RUNTIMES[lang.runtime].template, RUNTIMES[lang.runtime], intelFor(lang));
    saveCodeNow();
});
saveTemplateButton.addEventListener('click', async () => {
    settingsPanel.hidden = true;
    if (!current) return;
    const lang = current;
    await storage.setTemplate(lang.runtime, editor.value);
    await updateTemplateMenu();
    showToast(
        `${LANGUAGE_GROUP[lang.runtime]} 템플릿으로 저장했습니다. 새 문제를 열면 이 코드로 시작합니다.`
    );
});
clearTemplateButton.addEventListener('click', async () => {
    settingsPanel.hidden = true;
    if (!current) return;
    const lang = current;
    await storage.setTemplate(lang.runtime, null);
    await updateTemplateMenu();
    showToast(`${LANGUAGE_GROUP[lang.runtime]} 템플릿을 기본으로 되돌렸습니다.`);
});
document.addEventListener('click', (e) => {
    const target = e.target as Node;
    // 단추 안의 ⚙ 글자(span)를 눌러도 단추를 누른 것 (contains)
    if (
        !settingsPanel.hidden &&
        !settingsPanel.contains(target) &&
        !settingsButton.contains(target)
    ) {
        settingsPanel.hidden = true;
        settingsButton.setAttribute('aria-expanded', 'false');
    }
    if (!confirmBox.hidden && !confirmBox.contains(target) && !submitButton.contains(target))
        closeConfirm();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        settingsPanel.hidden = true;
        closeConfirm();
    }
    // Ctrl+B: 문제 패널 접기/펼치기 (에디터 안에서도)
    if (
        (IS_MAC ? e.metaKey : e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'b'
    ) {
        e.preventDefault();
        toggleProblem();
        return;
    }
    // 에디터 밖에 포커스가 있어도 단축키가 동작하게 합니다. (에디터 안에서는 에디터가 처리)
    if (
        e.key === 'Enter' &&
        (e.ctrlKey || e.metaKey) &&
        !(e.target as HTMLElement).closest('.cm-editor')
    ) {
        e.preventDefault();
        if (e.shiftKey) requestSubmit();
        else void runTests();
    }
});

addTestButton.addEventListener('click', () => {
    const id = newTestId();
    customTests = [...customTests, { id, input: '', expected: '' }];
    openTests.add(id);
    if (problemId) persist(storage.setCustomTests(problemId, customTests));
    renderTests();
    testList.querySelector<HTMLTextAreaElement>(`[data-id="${id}"] textarea`)?.focus();
});
window.addEventListener('beforeunload', saveCodeNow);

// ── 다른 탭에서 같은 문제를 고쳤을 때 ──────────────────────────────
// 이 탭에서 고치지 않았으면 그 코드로 맞추고(되돌리기 가능), 양쪽에서 고쳤으면 알립니다.
let conflictShown = false;
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !problemId) return;
    const codeChange = current ? changes[`code:${problemId}:${current.id}`] : undefined;
    if (codeChange && typeof codeChange.newValue === 'string') {
        const incoming = codeChange.newValue;
        if (incoming !== savedCode) {
            // 이 탭에서 고친 적이 있는지: 저장된 값이나 처음 올린 코드(템플릿)와 다르면 고친 것
            const editedHere = editor.value !== savedCode && editor.value !== loadedCode;
            savedCode = incoming;
            if (incoming === editor.value) {
                // 같은 내용 (이 탭이 쓴 것이 늦게 알려졌거나 우연히 같음)
            } else if (!editedHere) {
                clearTimeout(saveTimer);
                editor.replaceAll(incoming);
                clearTimeout(saveTimer); // 바꾼 내용은 이미 저장소에 있음
                showToast('다른 탭에서 고친 코드로 바꿨습니다. (Ctrl+Z로 되돌릴 수 있음)');
            } else if (!conflictShown) {
                conflictShown = true;
                showToast(
                    '이 문제의 코드를 다른 탭에서도 고쳤습니다. 이 탭에서 계속 고치면 그 탭의 변경을 덮어씁니다.',
                    'error'
                );
            }
        }
    }
    const testsChange = changes[`tests:${problemId}`];
    if (testsChange && Array.isArray(testsChange.newValue) && !testsSaveTimer) {
        const incoming = testsChange.newValue as CustomTest[];
        if (JSON.stringify(incoming) !== JSON.stringify(customTests)) {
            // 입력 칸을 고치는 중이면 다시 그리지 않습니다. (다음 저장 때 이 탭 것이 저장됨)
            if (testList.contains(document.activeElement)) return;
            customTests = incoming;
            for (const key of [...testStates.keys()])
                if (!key.startsWith('sample-') && !incoming.some((t) => t.id === key))
                    testStates.delete(key);
            renderTests();
        }
    }
});

// ── 문제 패널 접기 ───────────────────────────────────────────────
const toggleProblemButton = $<HTMLButtonElement>('#toggle-problem');
const setProblemCollapsed = (collapsed: boolean) => {
    document.documentElement.classList.toggle('problem-collapsed', collapsed);
    toggleProblemButton.setAttribute('aria-pressed', String(collapsed));
    toggleProblemButton.title = collapsed ? '문제 펼치기 (Ctrl+B)' : '문제 접기 (Ctrl+B)';
    editor.refresh();
};
function toggleProblem() {
    const collapsed = !document.documentElement.classList.contains('problem-collapsed');
    setProblemCollapsed(collapsed);
    void storage.updatePrefs({ problemCollapsed: collapsed });
}
toggleProblemButton.addEventListener('click', toggleProblem);

void storage.getPrefs().then((prefs) => {
    setupSplit(prefs);
    setProblemCollapsed(prefs.problemCollapsed === true);
});
renderStatus();

let initialized = false;
window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== bojOrigin) return;
    const message = event.data as ParentToSolver;
    // init은 한 번만 받습니다. (BOJ 페이지의 다른 스크립트가 보낸 두 번째 init으로 문제가 바뀌지 않게)
    if (message.type === 'init') {
        if (initialized) return;
        initialized = true;
        void init(message);
    } else if (message.type === 'submit-result') onSubmitResult(message.ok, message.message);
    else if (message.type === 'problem' && message.problem.id === problemId)
        applyProblem(message.problem);
});

send({ type: 'ready' });

setupEditorSettings(editor, showToast);
