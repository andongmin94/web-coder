// 솔버 iframe 진입점 (확장 페이지, BOJ 페이지 위에 전체 화면으로 뜸)
// 여기서는 모듈을 만들어 서로 잇고, 초기화·언어 바꾸기·화면 전역 단축키와 BOJ 페이지와의 메시지만 다룹니다.
// - state.ts: 상태            - code-store.ts: 코드·내 테스트 저장, 다른 탭과 맞추기
// - results-view.ts: 결과 패널  - run-controller.ts: 실행
// - submit-flow.ts: 제출       - templates.ts: 내 템플릿
// - problem-pane.ts: 문제 패널  - intel-registry.ts: 언어별 인텔리센스
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
import { createCodeStore } from './code-store.ts';
import { chooseInitialLanguage } from './decisions.ts';
import { h } from './dom.ts';
import { CodeEditor } from './editor.ts';
import { setupEditorSettings } from './editor-settings.ts';
import { els } from './elements.ts';
import { createIntelRegistry } from './intel-registry.ts';
import { createProblemPane } from './problem-pane.ts';
import { createResultsView } from './results-view.ts';
import { createRunController } from './run-controller.ts';
import { setupSplit } from './split.ts';
import { createState } from './state.ts';
import { storage } from './storage.ts';
import { autoPrune, touchProblem } from './storage-prune.ts';
import { createSubmitFlow } from './submit-flow.ts';
import { setupTemplates, templateFor } from './templates.ts';
import { showToast } from './toast.ts';

// ── 임베드 위치 확인 ─────────────────────────────────────────────
const parentOrigin = location.ancestorOrigins?.[0];
if (window.parent === window || !isBojOrigin(parentOrigin)) {
    document.body.textContent = '웹 코더는 백준 제출 페이지 안에서만 동작합니다.';
    throw new Error('not embedded in BOJ');
}

const bojOrigin: string = parentOrigin!;
const send = (message: SolverToParent) => window.parent.postMessage(message, bojOrigin);

/** Mac에서는 Ctrl+B가 에디터의 '커서 왼쪽'이라 문제 접기는 Cmd+B로 받습니다. */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

// ── 모듈 잇기 ────────────────────────────────────────────────────
// 서로 부르는 것(편집 → 저장 → 상태 줄, 카드 → 실행)은 아래에서 만든 뒤에 불리므로 화살표 함수로 늦게 잇습니다.
const pool = new RunnerPool();
const state = createState();

const editor = new CodeEditor(els.editor, {
    onChange: () => store.scheduleSave(),
    onRun: () => void runner.runTests(),
    onSubmit: () => submitFlow.requestSubmit(),
    onNotice: (message) => showToast(message, 'error'),
});

const store = createCodeStore({
    state,
    editor,
    showToast,
    afterCodeSaved: () => {
        if (!state.stage) results.renderStatus();
    },
    onTestsChangedElsewhere: () => results.renderTests(),
    editingTests: () => els.testList.contains(document.activeElement),
});

const results = createResultsView({
    state,
    els,
    editor,
    store,
    runOne: (id) => void runner.runTests(id),
});

const runner = createRunController({ state, els, editor, pool, store, results, showToast });
const submitFlow = createSubmitFlow({ state, els, editor, store, results, showToast, send });
const { intelFor } = createIntelRegistry(pool);
const templates = setupTemplates({ state, els, editor, store, intelFor, showToast });
const problemPane = createProblemPane({ state, els, editor, results, bojOrigin });

// ── 언어 ─────────────────────────────────────────────────────────
/** 언어를 빠르게 연달아 바꿀 때 늦게 끝난 앞의 전환을 버리기 위한 번호 */
let switchSeq = 0;

const switchLanguage = async (lang: ResolvedLanguage, initialCode?: string) => {
    const seq = ++switchSeq;
    state.switching = true;
    if (state.current) store.saveCodeNow();
    els.languageSelect.value = lang.id;

    const saved = state.problemId ? await storage.getCode(state.problemId, lang.id) : undefined;
    const code = initialCode ?? saved ?? (await templateFor(lang.runtime));
    // 기다리는 사이 다른 언어로 또 바꿨으면 그쪽이 이깁니다.
    // current는 새 코드를 에디터에 올린 뒤에 바꿉니다. 그 전에 바꾸면 에디터에 남은 이전 언어의 코드가
    // 새 언어 이름으로 저장됩니다. (빠르게 두 번 바꿀 때 코드가 덮어써지던 문제)
    if (seq !== switchSeq) return;
    state.switching = false;
    state.current = lang;
    store.codeLoaded(saved, code);
    editor.load(code, RUNTIMES[lang.runtime], intelFor(lang));
    void templates.updateTemplateMenu();
    pool.warmUp(lang);

    state.compileMessage = null;
    state.testStates.clear();
    state.lastTiming = null;
    results.renderTests();
};

// ── 초기화 ───────────────────────────────────────────────────────
const init = async (data: {
    problemId: string;
    problem: ProblemData | null;
    problemError?: string;
    form: SubmitFormData;
}) => {
    state.problemId = data.problemId;
    problemPane.renderHeader();
    if (data.problem) problemPane.applyProblem(data.problem);
    else problemPane.showMissing();

    // 공개 설정
    els.codeOpenSelect.replaceChildren(
        ...data.form.codeOpenOptions.map((o) => h('option', { value: o.value }, o.label))
    );
    // BOJ 폼에서 고른 값이 없으면 아무것도 보내지 않아 BOJ의 기본값을 따릅니다. (첫 항목은 "공개"일 수 있음)
    state.codeOpenValue = data.form.codeOpenValue ?? null;
    if (state.codeOpenValue) els.codeOpenSelect.value = state.codeOpenValue;
    else els.codeOpenSelect.selectedIndex = -1;
    (els.codeOpenSelect.closest('.menu-row') as HTMLElement).hidden =
        data.form.codeOpenOptions.length === 0;

    // 언어
    state.languages = resolveLanguages(data.form.languages);
    if (!state.languages.length) {
        els.panes.replaceChildren(
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
    els.languageSelect.replaceChildren(
        ...state.languages.map((l) => h('option', { value: l.id }, l.label))
    );

    state.customTests = state.problemId ? await storage.getCustomTests(state.problemId) : [];

    const prefs = await storage.getPrefs();
    const choice = chooseInitialLanguage(state.languages, data.form, prefs.lastLanguageLabel);
    await switchLanguage(choice.language, choice.initialCode);
    // 저장 공간 자동 관리: 연 문제를 기록하고, 하루 한 번 예산을 넘었으면 오래된 것부터 정리 (storage-prune.ts)
    if (state.problemId) {
        const problemId = state.problemId;
        void touchProblem(problemId)
            .then(() => autoPrune(problemId))
            .catch(() => {});
    }
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
    store.saveCodeNow();
    // 편집한 코드를 원래 폼에 옮겨 둡니다. 그러지 않으면 원래 폼에 남은 옛 코드가 제출되거나,
    // 웹 코더를 다시 열 때 그 옛 코드가 저장해 둔 코드를 덮어씁니다.
    send(
        state.current
            ? {
                  type: 'restore',
                  languageId: state.current.id,
                  source: editor.value,
                  codeOpen: state.codeOpenValue,
              }
            : { type: 'restore' }
    );
};

els.languageSelect.addEventListener('change', () => {
    const lang = state.languages.find((l) => l.id === els.languageSelect.value);
    if (!lang) return;
    // 사용자가 직접 고른 언어만 기억합니다. (그 언어가 없는 문제에서 자동으로 고른 언어가
    // 다른 문제의 기본 언어를 바꾸지 않게)
    void storage.updatePrefs({ lastLanguageLabel: lang.label });
    void switchLanguage(lang);
});
els.codeOpenSelect.addEventListener(
    'change',
    () => (state.codeOpenValue = els.codeOpenSelect.value)
);
els.runButton.addEventListener('click', () => void runner.runTests());
els.stopButton.addEventListener('click', runner.stopTests);
els.closeButton.addEventListener('click', restore);
els.addTestButton.addEventListener('click', results.addTest);

els.settingsButton.addEventListener('click', () => {
    const { settingsPanel, settingsButton } = els;
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsButton.setAttribute('aria-expanded', String(!settingsPanel.hidden));
    submitFlow.closeConfirm();
    if (settingsPanel.hidden) return;
    // 좁은 화면에서는 결과 패널이 아래쪽이라, 아래 공간이 모자라면 위로 엽니다.
    const button = settingsButton.getBoundingClientRect();
    const below = window.innerHeight - button.bottom - 12;
    const above = button.top - 12;
    const up = settingsPanel.scrollHeight > below && above > below;
    settingsPanel.classList.toggle('menu-up', up);
    settingsPanel.style.maxHeight = `${Math.max(160, up ? above : below)}px`;
});
document.addEventListener('click', (e) => {
    const target = e.target as Node;
    const { settingsPanel, settingsButton, confirmBox, submitButton } = els;
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
        submitFlow.closeConfirm();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        els.settingsPanel.hidden = true;
        submitFlow.closeConfirm();
    }
    // Ctrl+B: 문제 패널 접기/펼치기 (에디터 안에서도)
    if (
        (IS_MAC ? e.metaKey : e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'b'
    ) {
        e.preventDefault();
        problemPane.toggleProblem();
        return;
    }
    // 에디터 밖에 포커스가 있어도 단축키가 동작하게 합니다. (에디터 안에서는 에디터가 처리)
    if (
        e.key === 'Enter' &&
        (e.ctrlKey || e.metaKey) &&
        !(e.target as HTMLElement).closest('.cm-editor')
    ) {
        e.preventDefault();
        if (e.shiftKey) submitFlow.requestSubmit();
        else void runner.runTests();
    }
});
window.addEventListener('beforeunload', store.saveCodeNow);

void storage.getPrefs().then((prefs) => {
    setupSplit(prefs);
    problemPane.setProblemCollapsed(prefs.problemCollapsed === true);
});
results.renderStatus();

// ── BOJ 페이지와의 메시지 ────────────────────────────────────────
let initialized = false;
window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== bojOrigin) return;
    const message = event.data as ParentToSolver;
    // init은 한 번만 받습니다. (BOJ 페이지의 다른 스크립트가 보낸 두 번째 init으로 문제가 바뀌지 않게)
    if (message.type === 'init') {
        if (initialized) return;
        initialized = true;
        void init(message);
    } else if (message.type === 'submit-result')
        submitFlow.onSubmitResult(message.ok, message.message);
    else if (message.type === 'problem' && message.problem.id === state.problemId)
        problemPane.applyProblem(message.problem);
});

send({ type: 'ready' });

setupEditorSettings(editor, showToast);
