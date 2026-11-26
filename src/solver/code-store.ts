// 코드와 내 테스트 저장 (chrome.storage.local), 다른 탭과 맞추기
//
// 코드는 고칠 때마다 0.4초 모아서, 내 테스트도 칸에 입력할 때마다가 아니라 모아서 저장합니다.
// 이 탭이 저장소에서 읽거나 쓴 마지막 코드(savedCode)와 같으면 저장하지 않습니다. 같은 문제를 탭 두 개로
// 열었을 때 고치지 않은 옛 탭이 실행·언어 바꾸기·탭 닫기 때 옛 코드를 저장해 다른 탭의 코드를 덮어쓰지 않게.
import type { CodeEditor } from './editor.ts';
import type { SolverState } from './state.ts';
import { storage, type CustomTest } from './storage.ts';
import type { ShowToast } from './toast.ts';

const SAVE_DELAY_MS = 400;

export const createCodeStore = (deps: {
    state: SolverState;
    editor: CodeEditor;
    showToast: ShowToast;
    /** 코드를 저장한 뒤 (상태 줄의 "고친 뒤 실행 안 함" 표시 갱신) */
    afterCodeSaved: () => void;
    /** 다른 탭이 내 테스트를 바꿨을 때 */
    onTestsChangedElsewhere: () => void;
    /** 지금 내 테스트 칸을 고치는 중인지 (그때는 다른 탭의 변경으로 다시 그리지 않음) */
    editingTests: () => boolean;
}) => {
    const { state, editor, showToast } = deps;

    /**
     * 저장 실패(저장 공간 부족 등)를 그냥 넘기면 새로고침 때 고친 내용이 사라지므로 알립니다.
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

    // ── 내 테스트 ──
    let testsSaveTimer = 0;
    const saveTestsNow = () => {
        if (!testsSaveTimer) return;
        clearTimeout(testsSaveTimer);
        testsSaveTimer = 0;
        if (state.problemId) persist(storage.setCustomTests(state.problemId, state.customTests));
    };
    const scheduleTestsSave = () => {
        clearTimeout(testsSaveTimer);
        testsSaveTimer = window.setTimeout(saveTestsNow, SAVE_DELAY_MS);
    };
    /** 추가·삭제처럼 바로 저장할 때 */
    const saveTestsImmediately = () => {
        clearTimeout(testsSaveTimer);
        testsSaveTimer = 0;
        if (state.problemId) persist(storage.setCustomTests(state.problemId, state.customTests));
    };

    // ── 코드 ──
    /** 저장소에 있는 지금 언어의 코드 (이 탭이 읽거나 쓴 마지막 값) */
    let savedCode: string | undefined;
    /** 언어를 고를 때 에디터에 올린 코드 (저장된 적 없는 템플릿이면 savedCode는 없음) */
    let loadedCode: string | undefined;
    let saveTimer = 0;

    const saveCodeNow = () => {
        clearTimeout(saveTimer);
        saveTestsNow();
        const { problemId, current } = state;
        if (!problemId || !current) return;
        const code = editor.value;
        if (code === savedCode) return;
        savedCode = code;
        persist(storage.setCode(problemId, current.id, code));
    };
    const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
            saveCodeNow();
            deps.afterCodeSaved();
        }, SAVE_DELAY_MS);
    };
    /** 언어를 바꿔 에디터에 코드를 올렸을 때: saved는 저장소에 있던 값(없으면 undefined) */
    const codeLoaded = (saved: string | undefined, code: string) => {
        savedCode = saved;
        loadedCode = code;
    };

    // ── 다른 탭에서 같은 문제를 고쳤을 때 ──
    // 이 탭에서 고치지 않았으면 그 코드로 맞추고(되돌리기 가능), 양쪽에서 고쳤으면 알립니다.
    let conflictShown = false;
    chrome.storage.onChanged.addListener((changes, area) => {
        const { problemId, current } = state;
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
            if (JSON.stringify(incoming) === JSON.stringify(state.customTests)) return;
            // 입력 칸을 고치는 중이면 다시 그리지 않습니다. (다음 저장 때 이 탭 것이 저장됨)
            if (deps.editingTests()) return;
            state.customTests = incoming;
            for (const key of [...state.testStates.keys()])
                if (!key.startsWith('sample-') && !incoming.some((t) => t.id === key))
                    state.testStates.delete(key);
            deps.onTestsChangedElsewhere();
        }
    });

    return {
        persist,
        saveCodeNow,
        scheduleSave,
        codeLoaded,
        scheduleTestsSave,
        saveTestsImmediately,
    };
};

export type CodeStore = ReturnType<typeof createCodeStore>;
