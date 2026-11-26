// 제출: 지금 코드로 예제를 통과했는지 보고 필요하면 한 번 묻고, BOJ 페이지에 제출을 맡깁니다.
// (BOJ 원래 폼으로 제출하므로 성공하면 채점 현황으로 넘어가 이 화면은 사라짐)
import type { SolverToParent } from '../shared/protocol.ts';
import type { CodeStore } from './code-store.ts';
import { submitWarning } from './decisions.ts';
import type { CodeEditor } from './editor.ts';
import type { Elements } from './elements.ts';
import type { ResultsView } from './results-view.ts';
import { resultKeyOf, type SolverState } from './state.ts';
import type { ShowToast } from './toast.ts';

export const createSubmitFlow = (deps: {
    state: SolverState;
    els: Elements;
    editor: CodeEditor;
    store: CodeStore;
    results: ResultsView;
    showToast: ShowToast;
    send: (message: SolverToParent) => void;
}) => {
    const { state, els, editor, store, results, showToast } = deps;

    const closeConfirm = () => {
        els.confirmBox.hidden = true;
    };

    const submit = () => {
        if (!state.current) return;
        closeConfirm();
        store.saveCodeNow();
        state.submitting = true;
        els.submitButton.disabled = true;
        els.submitButton.textContent = '제출 중…';
        deps.send({
            type: 'submit',
            languageId: state.current.id,
            source: editor.value,
            codeOpen: state.codeOpenValue,
        });
    };

    /** 현재 코드로 예제를 통과했는지 보고, 아니면 한 번 확인합니다. */
    const requestSubmit = () => {
        const { current } = state;
        if (state.submitting || !current) return;
        const source = editor.value;
        if (!source.trim()) {
            showToast('제출할 코드가 없습니다.', 'error');
            return;
        }
        const warning = submitWarning({
            functionOnly: state.problem?.kind === 'function',
            source,
            languageId: current.id,
            lastRun: state.lastRun,
            currentVerdicts:
                state.resultsKey === resultKeyOf(current.id, source)
                    ? results.doneVerdicts()
                    : null,
            hasCustomTests: state.customTests.length > 0,
        });
        if (!warning) {
            submit();
            return;
        }
        els.confirmText.textContent = `${warning} 그래도 제출할까요?`;
        els.settingsPanel.hidden = true;
        els.confirmBox.hidden = false;
        els.confirmCancel.focus();
    };

    const onSubmitResult = (ok: boolean, message?: string) => {
        // 성공하면 BOJ가 채점 현황 페이지로 이동하므로 이 페이지는 사라집니다.
        if (ok) return;
        state.submitting = false;
        els.submitButton.disabled = false;
        els.submitButton.textContent = '제출';
        showToast(message ?? '제출에 실패했습니다.', 'error');
    };

    els.submitButton.addEventListener('click', requestSubmit);
    els.confirmOk.addEventListener('click', submit);
    els.confirmCancel.addEventListener('click', () => {
        closeConfirm();
        editor.focus();
    });

    return { requestSubmit, onSubmitResult, closeConfirm };
};
