// 테스트 케이스 목록과 결과 표시
import { firstDiffLine, isSameOutput } from '../judge/judge.ts';
import type { RunResult } from '../runner/types.ts';
import { h } from './dom.ts';

export type TestCase = {
    id: string;
    kind: 'sample' | 'custom';
    label: string;
    input: string;
    expected: string;
};

export type TestState =
    | { phase: 'idle' }
    | { phase: 'queued' }
    | { phase: 'running' }
    | { phase: 'compile-error' }
    | { phase: 'done'; result: RunResult };

export type Verdict = 'pass' | 'fail' | 'output' | 'error' | 'timeout' | 'olimit' | 'cancelled';

export const verdictOf = (test: TestCase, result: RunResult, specialJudge: boolean): Verdict => {
    if (result.status === 'cancelled') return 'cancelled';
    if (result.status === 'timeout') return 'timeout';
    if (result.status === 'internal-error' || result.status === 'runtime-error') return 'error';
    if (result.output.truncated) return 'olimit';
    if (specialJudge || !test.expected.trim()) return 'output';
    return isSameOutput(result.output.stdout, test.expected) ? 'pass' : 'fail';
};

const VERDICT_TEXT: Record<Verdict, string> = {
    pass: '통과',
    fail: '틀림',
    output: '실행됨',
    error: '런타임 에러',
    timeout: '시간 초과',
    olimit: '출력 초과',
    cancelled: '중단됨',
};

type Callbacks = {
    onChangeCustom: (id: string, patch: { input?: string; expected?: string }) => void;
    onDeleteCustom: (id: string) => void;
};

const block = (title: string, content: string, extra?: string) =>
    h('div', { class: `io-block ${extra ?? ''}` }, [
        h('div', { class: 'io-title' }, title),
        h('pre', { class: 'io-pre' }, content.length ? content : ' '),
    ]);

const editableBlock = (
    title: string,
    value: string,
    placeholder: string,
    onInput: (v: string) => void
) => {
    const area = h('textarea', { class: 'io-edit', spellcheck: 'false', placeholder, rows: 3 });
    area.value = value;
    area.addEventListener('input', () => onInput(area.value));
    return h('div', { class: 'io-block' }, [h('div', { class: 'io-title' }, title), area]);
};

export const renderTestCard = (
    test: TestCase,
    state: TestState,
    specialJudge: boolean,
    callbacks: Callbacks
): HTMLElement => {
    let badge: HTMLElement;
    let resultNode: HTMLElement | null = null;

    switch (state.phase) {
        case 'idle':
            badge = h('span', { class: 'badge' }, '대기');
            break;
        case 'queued':
            badge = h('span', { class: 'badge badge-muted' }, '대기 중');
            break;
        case 'running':
            badge = h('span', { class: 'badge badge-running' }, '실행 중');
            break;
        case 'compile-error':
            badge = h('span', { class: 'badge badge-error' }, '컴파일 에러');
            break;
        case 'done': {
            const verdict = verdictOf(test, state.result, specialJudge);
            const time =
                verdict === 'timeout' || verdict === 'cancelled'
                    ? ''
                    : ` · ${Math.round(state.result.timeMs)}ms`;
            badge = h('span', { class: `badge badge-${verdict}` }, VERDICT_TEXT[verdict] + time);

            const { stdout, stderr, exitCode } = state.result.output;
            const diffLine = verdict === 'fail' ? firstDiffLine(stdout, test.expected) : null;
            resultNode = h('div', { class: 'io-result' }, [
                verdict !== 'cancelled' &&
                    block(
                        diffLine ? `실제 출력 (${diffLine}번째 줄부터 다름)` : '실제 출력',
                        stdout,
                        verdict === 'fail' ? 'io-wrong' : verdict === 'pass' ? 'io-right' : ''
                    ),
                stderr.trim() && block('표준 에러', stderr, 'io-stderr'),
                verdict === 'error' &&
                    h('p', { class: 'io-note' }, state.result.message ?? `종료 코드 ${exitCode}`),
                verdict === 'timeout' &&
                    h(
                        'p',
                        { class: 'io-note' },
                        `로컬 실행 제한 ${Math.round(state.result.timeMs / 1000)}초를 넘어 중단했습니다.`
                    ),
                state.result.output.truncated &&
                    h('p', { class: 'io-note' }, '출력이 1MB를 넘어 잘랐습니다.'),
            ]);
            break;
        }
    }

    const header = h('div', { class: 'test-header' }, [
        h('span', { class: 'test-label' }, test.label),
        badge,
        test.kind === 'custom' &&
            h(
                'button',
                {
                    class: 'icon-button',
                    type: 'button',
                    title: '테스트 삭제',
                    'aria-label': `${test.label} 삭제`,
                    onclick: () => callbacks.onDeleteCustom(test.id),
                },
                '✕'
            ),
    ]);

    const io =
        test.kind === 'custom'
            ? h('div', { class: 'io-grid' }, [
                  editableBlock('입력', test.input, '입력값', (v) =>
                      callbacks.onChangeCustom(test.id, { input: v })
                  ),
                  editableBlock('기대 출력', test.expected, '비우면 비교하지 않음', (v) =>
                      callbacks.onChangeCustom(test.id, { expected: v })
                  ),
              ])
            : h('div', { class: 'io-grid' }, [
                  block('입력', test.input),
                  block('기대 출력', test.expected),
              ]);

    return h('article', { class: `test-card phase-${state.phase}`, 'data-id': test.id }, [
        header,
        io,
        resultNode,
    ]);
};
