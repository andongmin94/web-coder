// 테스트 목록: 예제별로 접히는 행 + 실패 시 줄 단위 비교
import { isSameOutput, normalizeOutput } from '../judge/judge.ts';
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
    | { phase: 'skipped' }
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

export const isBadVerdict = (v: Verdict) =>
    v === 'fail' || v === 'error' || v === 'timeout' || v === 'olimit';

const VERDICT: Record<Verdict, { text: string; icon: string }> = {
    pass: { text: '통과', icon: '✓' },
    fail: { text: '틀렸습니다', icon: '✕' },
    output: { text: '실행됨', icon: '•' },
    error: { text: '런타임 에러', icon: '!' },
    timeout: { text: '시간 초과', icon: '⏱' },
    olimit: { text: '출력 초과', icon: '!' },
    cancelled: { text: '중단됨', icon: '–' },
};

type Callbacks = {
    onToggle: (id: string) => void;
    onChangeCustom: (id: string, patch: { input?: string; expected?: string }) => void;
    onDeleteCustom: (id: string) => void;
};

const MAX_LINES = 400;

const plainBlock = (label: string | Node[], text: string, extraClass = '') =>
    h('div', { class: `io ${extraClass}` }, [
        h('div', { class: 'io-label' }, label),
        h('pre', {}, text.length ? text.replace(/\n$/, '') : ' '),
    ]);

/** 기대/실제 출력을 줄 단위로 비교해 다른 줄을 강조합니다. */
const diffBlocks = (expected: string, actual: string) => {
    const e = normalizeOutput(expected).split('\n');
    const a = normalizeOutput(actual).split('\n');
    const rows = Math.max(e.length, a.length);
    let firstDiff = -1;
    for (let i = 0; i < rows; i++) {
        if (e[i] !== a[i]) {
            firstDiff = i;
            break;
        }
    }
    const render = (lines: string[], other: string[], badClass: string) => {
        const pre = h('pre');
        const shown = Math.min(lines.length, MAX_LINES);
        for (let i = 0; i < shown; i++) {
            pre.append(
                h(
                    'span',
                    { class: `diff-line ${lines[i] !== other[i] ? badClass : ''}` },
                    lines[i] || ' '
                )
            );
        }
        if (lines.length > shown)
            pre.append(h('span', { class: 'diff-line' }, `… ${lines.length - shown}줄 더`));
        return pre;
    };
    const note =
        firstDiff >= 0 ? h('span', { class: 'note' }, `${firstDiff + 1}번째 줄부터 다름`) : null;
    return [
        h('div', { class: 'io' }, [
            h('div', { class: 'io-label' }, ['실제 출력', note]),
            render(a, e, 'diff-bad'),
        ]),
        h('div', { class: 'io' }, [
            h('div', { class: 'io-label' }, '기대 출력'),
            render(e, a, 'diff-miss'),
        ]),
    ];
};

const editable = (
    label: string,
    value: string,
    placeholder: string,
    onInput: (v: string) => void
) => {
    const area = h('textarea', { class: 'io-edit', spellcheck: 'false', placeholder, rows: 3 });
    area.value = value;
    area.addEventListener('input', () => onInput(area.value));
    return h('div', { class: 'io' }, [h('div', { class: 'io-label' }, label), area]);
};

export const renderTest = (
    test: TestCase,
    state: TestState,
    open: boolean,
    specialJudge: boolean,
    /** 지금 언어에 BOJ가 적용하는 시간 제한 (모르면 null) */
    judgeLimitMs: number | null,
    callbacks: Callbacks
): HTMLElement => {
    let icon: HTMLElement;
    let verdictText: HTMLElement;
    let time: string | null = null;
    let verdict: Verdict | null = null;
    // 끝까지 돌았지만 BOJ 제한보다 오래 걸린 경우 (로컬은 채점 서버보다 느려서 판정은 바꾸지 않고 알리기만 함)
    let slow = false;

    switch (state.phase) {
        case 'idle':
        case 'skipped':
            icon = h('span', { class: 'test-icon' }, '');
            verdictText = h(
                'span',
                { class: 'test-verdict verdict-muted' },
                state.phase === 'skipped' ? '실행 안 함' : ''
            );
            break;
        case 'queued':
            icon = h('span', { class: 'test-icon' }, '');
            verdictText = h('span', { class: 'test-verdict verdict-muted' }, '대기');
            break;
        case 'running':
            icon = h('span', { class: 'spinner', 'aria-hidden': 'true' });
            verdictText = h('span', { class: 'test-verdict verdict-muted' }, '실행 중');
            break;
        case 'done':
            verdict = verdictOf(test, state.result, specialJudge);
            icon = h('span', { class: `test-icon icon-${verdict}` }, VERDICT[verdict].icon);
            verdictText = h(
                'span',
                { class: `test-verdict verdict-${verdict}` },
                VERDICT[verdict].text
            );
            if (verdict !== 'timeout' && verdict !== 'cancelled') {
                time = `${Math.round(state.result.timeMs)}ms`;
                slow = judgeLimitMs !== null && state.result.timeMs > judgeLimitMs;
            }
            break;
    }

    const row = h(
        'button',
        {
            class: 'test-row',
            type: 'button',
            'aria-expanded': String(open),
            onclick: () => callbacks.onToggle(test.id),
        },
        [
            icon,
            h('span', { class: 'test-name' }, test.label),
            verdictText,
            h('span', { class: `test-time ${slow ? 'is-slow' : ''}` }, time ?? ''),
            h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
        ]
    );

    const card = h('article', {
        class: `test ${open ? 'open' : ''} ${verdict && isBadVerdict(verdict) ? 'is-fail' : ''}`,
        'data-id': test.id,
    });
    card.append(row);
    if (!open) return card;

    const body = h('div', { class: 'test-body' });
    if (test.kind === 'custom') {
        body.append(
            editable('입력', test.input, '입력값', (v) =>
                callbacks.onChangeCustom(test.id, { input: v })
            ),
            editable('기대 출력', test.expected, '비우면 비교하지 않고 출력만 봅니다', (v) =>
                callbacks.onChangeCustom(test.id, { expected: v })
            )
        );
    } else {
        body.append(plainBlock('입력', test.input));
    }

    if (state.phase === 'done') {
        const { stdout, stderr } = state.result.output;
        if (verdict === 'fail') {
            body.append(...diffBlocks(test.expected, stdout));
        } else if (verdict !== 'cancelled') {
            if (test.kind === 'sample' && verdict !== 'pass')
                body.append(plainBlock('기대 출력', test.expected));
            body.append(
                plainBlock(verdict === 'timeout' ? '실제 출력 (중단 전까지)' : '실제 출력', stdout)
            );
        }
        if (stderr.trim()) body.append(plainBlock('표준 에러', stderr, 'io-stderr'));
        if (verdict === 'error' && state.result.message)
            body.append(h('p', { class: 'io-note' }, state.result.message));
        if (verdict === 'error' && !stderr.trim() && !state.result.message) {
            body.append(h('p', { class: 'io-note' }, `종료 코드 ${state.result.output.exitCode}`));
        }
        if (verdict === 'timeout') {
            body.append(
                h(
                    'p',
                    { class: 'io-note' },
                    `로컬 실행 제한 ${Math.round(state.result.timeMs / 1000)}초를 넘어 중단했습니다.`
                )
            );
        }
        if (slow && judgeLimitMs !== null) {
            body.append(
                h(
                    'p',
                    { class: 'io-note io-note-warn' },
                    `백준의 이 언어 시간 제한(${judgeLimitMs / 1000}초)보다 오래 걸렸습니다. ` +
                        '로컬 실행은 채점 서버보다 느려서 참고용입니다.'
                )
            );
        }
        if (state.result.output.truncated)
            body.append(h('p', { class: 'io-note' }, '출력이 1MB를 넘어 잘랐습니다.'));
    } else if (test.kind === 'sample') {
        body.append(plainBlock('기대 출력', test.expected));
    }

    if (test.kind === 'custom') {
        body.append(
            h('div', {}, [
                h(
                    'button',
                    {
                        class: 'btn btn-ghost btn-sm test-remove',
                        type: 'button',
                        onclick: () => callbacks.onDeleteCustom(test.id),
                    },
                    '이 테스트 삭제'
                ),
            ])
        );
    }
    card.append(body);
    return card;
};
