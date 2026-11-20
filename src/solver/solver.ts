// 솔버 iframe 진입점 (확장 페이지, BOJ 페이지 안에 임베드됨)
import 'katex/dist/katex.min.css';
import './solver.css';
import {
    isBojOrigin,
    type ParentToSolver,
    type ProblemData,
    type SolverToParent,
    type SubmitFormData,
} from '../shared/protocol.ts';
import { RUNTIMES, resolveLanguages, type ResolvedLanguage } from '../shared/languages.ts';
import { RunnerPool } from '../runner/pool.ts';
import { CodeEditor } from './editor.ts';
import { renderProblem, renderProblemError } from './problem-view.ts';
import { renderTestCard, verdictOf, type TestCase, type TestState } from './tests-view.ts';
import { storage, type CustomTest } from './storage.ts';
import { setupSplit } from './split.ts';
import { $, h } from './dom.ts';

// ── 임베드 위치 확인 ─────────────────────────────────────────────
const parentOrigin = location.ancestorOrigins?.[0];
if (window.parent === window || !isBojOrigin(parentOrigin)) {
    document.body.textContent = '웹 코더는 백준 제출 페이지 안에서만 동작합니다.';
    throw new Error('not embedded in BOJ');
}

const bojOrigin: string = parentOrigin!;
const send = (message: SolverToParent) => window.parent.postMessage(message, bojOrigin);

// ── 상태 ─────────────────────────────────────────────────────────
const pool = new RunnerPool();
let problemId = '';
let problem: ProblemData | null = null;
let languages: ResolvedLanguage[] = [];
let current: ResolvedLanguage | null = null;
let codeOpenValue: string | null = null;
let customTests: CustomTest[] = [];
const testStates = new Map<string, TestState>();
let running = false;
let cancelRequested = false;
let submitting = false;
let compileMessage: { kind: 'error' | 'warning'; text: string } | null = null;

// ── 요소 ─────────────────────────────────────────────────────────
const problemPane = $('#problem-pane');
const languageSelect = $<HTMLSelectElement>('#language');
const codeOpenSelect = $<HTMLSelectElement>('#code-open');
const runButton = $<HTMLButtonElement>('#run');
const stopButton = $<HTMLButtonElement>('#stop');
const submitButton = $<HTMLButtonElement>('#submit');
const resetButton = $<HTMLButtonElement>('#reset');
const nativeButton = $<HTMLButtonElement>('#native');
const addTestButton = $<HTMLButtonElement>('#add-test');
const testList = $('#test-list');
const summary = $('#test-summary');
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
const saveCodeNow = () => {
    clearTimeout(saveTimer);
    if (problemId && current) void storage.setCode(problemId, current.id, editor.value);
};
const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveCodeNow, 400);
};

const editor = new CodeEditor($('#editor'), {
    onChange: scheduleSave,
    onRun: () => void runTests(),
    onSubmit: () => submit(),
});

// ── 테스트 ───────────────────────────────────────────────────────
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

const cardCallbacks = {
    onChangeCustom: (id: string, patch: { input?: string; expected?: string }) => {
        customTests = customTests.map((t) => (t.id === id ? { ...t, ...patch } : t));
        if (problemId) void storage.setCustomTests(problemId, customTests);
    },
    onDeleteCustom: (id: string) => {
        customTests = customTests.filter((t) => t.id !== id);
        testStates.delete(id);
        if (problemId) void storage.setCustomTests(problemId, customTests);
        renderTests();
    },
};

const renderTests = () => {
    const tests = allTests();
    const spj = problem?.isSpecialJudge ?? false;
    testList.replaceChildren(
        ...(tests.length
            ? tests.map((t) =>
                  renderTestCard(t, testStates.get(t.id) ?? { phase: 'idle' }, spj, cardCallbacks)
              )
            : [h('p', { class: 'empty' }, '예제가 없습니다. 테스트를 추가해 보세요.')])
    );
    renderSummary(tests);
};

/** 한 카드만 다시 그립니다 (입력 중인 다른 카드의 포커스를 지키기 위해). */
const renderTest = (test: TestCase) => {
    const old = testList.querySelector(`[data-id="${CSS.escape(test.id)}"]`);
    const card = renderTestCard(
        test,
        testStates.get(test.id) ?? { phase: 'idle' },
        problem?.isSpecialJudge ?? false,
        cardCallbacks
    );
    if (old) old.replaceWith(card);
    renderSummary(allTests());
};

const renderSummary = (tests: TestCase[]) => {
    const spj = problem?.isSpecialJudge ?? false;
    const done = tests.flatMap((t) => {
        const s = testStates.get(t.id);
        return s?.phase === 'done' ? [verdictOf(t, s.result, spj)] : [];
    });
    const anyCompileError = tests.some((t) => testStates.get(t.id)?.phase === 'compile-error');
    if (running) summary.textContent = `실행 중… (${done.length}/${tests.length})`;
    else if (anyCompileError) summary.textContent = '컴파일 에러';
    else if (done.length === 0) summary.textContent = '';
    else {
        const passed = done.filter((v) => v === 'pass').length;
        const judged = done.filter((v) => v !== 'output').length;
        summary.textContent = judged ? `${passed}/${judged} 통과` : '실행 완료';
    }

    compileBox.hidden = !compileMessage;
    if (compileMessage) {
        compileBox.className = `compile-box compile-${compileMessage.kind}`;
        compileBox.replaceChildren(
            h(
                'div',
                { class: 'io-title' },
                compileMessage.kind === 'error' ? '컴파일 에러' : '컴파일 경고'
            ),
            h('pre', { class: 'io-pre' }, compileMessage.text)
        );
    }
};

const localTimeoutMs = () => {
    // 브라우저 WASM은 네이티브보다 느리므로 BOJ 제한보다 넉넉하게 잡습니다.
    const limit = (problem?.timeLimitSec ?? 2) * 1000;
    return Math.min(20_000, Math.max(3_000, limit * 4));
};

const setRunning = (value: boolean) => {
    running = value;
    runButton.disabled = value;
    stopButton.hidden = !value;
    languageSelect.disabled = value;
};

const runTests = async () => {
    if (running || !current) return;
    const lang = current;
    const tests = allTests();
    if (!tests.length) {
        showToast('실행할 테스트가 없습니다. 테스트를 추가해 주세요.');
        return;
    }
    saveCodeNow();
    const source = editor.value;

    setRunning(true);
    cancelRequested = false;
    compileMessage = null;
    for (const t of tests) testStates.set(t.id, { phase: 'queued' });
    renderTests();

    try {
        if (lang.runtime === 'cpp') summary.textContent = '컴파일 중…';
        const compiled = await pool.compile(lang, source);
        if (cancelRequested) {
            for (const t of tests) testStates.set(t.id, { phase: 'idle' });
            return;
        }
        if (!compiled.ok) {
            compileMessage = { kind: 'error', text: compiled.diagnostics };
            for (const t of tests) testStates.set(t.id, { phase: 'compile-error' });
            return;
        }
        if (compiled.diagnostics) compileMessage = { kind: 'warning', text: compiled.diagnostics };
        renderSummary(tests);

        const timeout = localTimeoutMs();
        await Promise.all(
            tests.map(async (test) => {
                testStates.set(test.id, { phase: 'running' });
                renderTest(test);
                const result = await pool.run(
                    lang,
                    { source, artifact: compiled.artifact },
                    test.input,
                    timeout
                );
                testStates.set(test.id, { phase: 'done', result });
                renderTest(test);
            })
        );
    } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
        setRunning(false);
        renderTests();
    }
};

const stopTests = () => {
    cancelRequested = true;
    pool.cancelAll();
};

// ── 언어 ─────────────────────────────────────────────────────────
const switchLanguage = async (lang: ResolvedLanguage, initialCode?: string) => {
    if (problem && current) saveCodeNow();
    current = lang;
    languageSelect.value = lang.id;
    void storage.updatePrefs({ lastLanguageLabel: lang.label });

    const saved = problemId ? await storage.getCode(problemId, lang.id) : undefined;
    const code = initialCode ?? saved ?? RUNTIMES[lang.runtime].template;
    editor.load(code, RUNTIMES[lang.runtime]);
    pool.warmUp(lang);

    compileMessage = null;
    testStates.clear();
    renderTests();
};

// ── 제출 ─────────────────────────────────────────────────────────
const submit = () => {
    if (submitting || !current) return;
    const source = editor.value;
    if (!source.trim()) {
        showToast('제출할 코드가 없습니다.', 'error');
        return;
    }
    saveCodeNow();
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = '제출 중…';
    send({ type: 'submit', languageId: current.id, source, codeOpen: codeOpenValue });
};

const onSubmitResult = (ok: boolean, message?: string) => {
    // 성공하면 BOJ가 채점 현황 페이지로 이동하므로 이 페이지는 사라집니다.
    if (ok) return;
    submitting = false;
    submitButton.disabled = false;
    submitButton.textContent = '제출';
    showToast(message ?? '제출에 실패했습니다.', 'error');
};

// ── 초기화 ───────────────────────────────────────────────────────
/** 문제 데이터를 받으면(처음 또는 다른 탭에서 문제 페이지를 연 뒤) 화면과 예제를 갱신합니다. */
const applyProblem = (next: ProblemData) => {
    problem = next;
    renderProblem(problemPane, next);
    document.title = `${next.id}번 ${next.title} - 웹 코더`;
    for (const key of [...testStates.keys()]) if (key.startsWith('sample-')) testStates.delete(key);
    renderTests();
};

const init = async (data: {
    problemId: string;
    problem: ProblemData | null;
    problemError?: string;
    form: SubmitFormData;
}) => {
    problemId = data.problemId;

    if (data.problem) {
        applyProblem(data.problem);
    } else {
        renderProblemError(
            problemPane,
            data.problemError ?? '문제를 불러오지 못했습니다.',
            `${bojOrigin}/problem/${problemId}`
        );
    }

    // 공개 설정
    codeOpenSelect.replaceChildren(
        ...data.form.codeOpenOptions.map((o) => h('option', { value: o.value }, o.label))
    );
    codeOpenValue = data.form.codeOpenValue ?? data.form.codeOpenOptions[0]?.value ?? null;
    if (codeOpenValue) codeOpenSelect.value = codeOpenValue;
    codeOpenSelect.hidden = data.form.codeOpenOptions.length === 0;

    // 언어
    languages = resolveLanguages(data.form.languages);
    if (!languages.length) {
        $('#work-pane').replaceChildren(
            h('div', { class: 'empty' }, [
                h(
                    'p',
                    {},
                    '이 문제는 웹 코더가 로컬 실행을 지원하는 언어(C++, Python 3, node.js, Java)로 제출할 수 없습니다.'
                ),
                h(
                    'button',
                    { class: 'button', type: 'button', onclick: () => send({ type: 'restore' }) },
                    '기본 제출 폼 사용'
                ),
            ])
        );
        return;
    }
    languageSelect.replaceChildren(...languages.map((l) => h('option', { value: l.id }, l.label)));

    customTests = problemId ? await storage.getCustomTests(problemId) : [];

    const prefs = await storage.getPrefs();
    const fromForm = languages.find((l) => l.id === data.form.selectedLanguageId);
    // BOJ의 빈 에디터에는 폭 없는 공백(U+200B)이 들어 있을 수 있습니다.
    const hasExistingSource = data.form.initialSource.replace(/[\s​﻿]/g, '').length > 0;
    const preferred =
        (hasExistingSource ? fromForm : undefined) ??
        languages.find((l) => l.label === prefs.lastLanguageLabel) ??
        languages.find((l) => l.label === 'C++17') ??
        fromForm ??
        languages[0];

    await switchLanguage(preferred, hasExistingSource ? data.form.initialSource : undefined);
    editor.focus();
};

// ── 이벤트 연결 ─────────────────────────────────────────────────
languageSelect.addEventListener('change', () => {
    const lang = languages.find((l) => l.id === languageSelect.value);
    if (lang) void switchLanguage(lang);
});
codeOpenSelect.addEventListener('change', () => (codeOpenValue = codeOpenSelect.value));
runButton.addEventListener('click', () => void runTests());
stopButton.addEventListener('click', stopTests);
submitButton.addEventListener('click', submit);
nativeButton.addEventListener('click', () => {
    saveCodeNow();
    send({ type: 'restore' });
});
resetButton.addEventListener('click', () => {
    if (!current) return;
    if (!confirm('코드를 기본 템플릿으로 되돌릴까요? 지금 코드는 사라집니다.')) return;
    editor.load(RUNTIMES[current.runtime].template, RUNTIMES[current.runtime]);
    saveCodeNow();
});
addTestButton.addEventListener('click', () => {
    customTests = [...customTests, { id: `custom-${Date.now()}`, input: '', expected: '' }];
    if (problemId) void storage.setCustomTests(problemId, customTests);
    renderTests();
    testList.querySelector<HTMLTextAreaElement>('.test-card:last-child textarea')?.focus();
});
window.addEventListener('beforeunload', saveCodeNow);

void storage.getPrefs().then((prefs) => setupSplit(prefs));

window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== bojOrigin) return;
    const message = event.data as ParentToSolver;
    if (message.type === 'init') void init(message);
    else if (message.type === 'submit-result') onSubmitResult(message.ok, message.message);
    else if (message.type === 'problem' && message.problem.id === problemId)
        applyProblem(message.problem);
});

send({ type: 'ready' });
