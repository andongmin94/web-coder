// 테스트 목록: 예제별로 접히는 행 + 실패 시 줄 단위 비교
import {
    differingRange,
    hasDecimalNumber,
    isSameOutput,
    isSameWithTolerance,
    normalizeOutput,
} from '../judge/judge.ts';
import { OUTPUT_LIMIT } from '../runner/output.ts';
import type { RunResult } from '../runner/types.ts';
import { h } from './dom.ts';
import { linkifyLocations } from './locations.ts';

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

/** 판정에 필요한 문제 정보 */
export type JudgeContext = {
    specialJudge: boolean;
    /** 스페셜 저지 문제의 실수 허용 오차 (모르면 null) */
    tolerance: number | null;
    /** 메모리 제한 (MB, 모르면 null) */
    memoryLimitMB: number | null;
};

/** 스페셜 저지라도 허용 오차를 알고 기대 출력이 실수면 오차 안에서 비교할 수 있습니다. */
const usesTolerance = (test: TestCase, judge: JudgeContext) =>
    judge.specialJudge && judge.tolerance !== null && hasDecimalNumber(test.expected);

export const verdictOf = (test: TestCase, result: RunResult, judge: JudgeContext): Verdict => {
    if (result.status === 'cancelled') return 'cancelled';
    if (result.status === 'timeout') return 'timeout';
    if (result.status === 'internal-error' || result.status === 'runtime-error') return 'error';
    if (result.output.truncated) return 'olimit';
    if (!test.expected.trim()) return 'output';
    if (usesTolerance(test, judge))
        return isSameWithTolerance(result.output.stdout, test.expected, judge.tolerance!)
            ? 'pass'
            : 'fail';
    if (judge.specialJudge) return 'output';
    return isSameOutput(result.output.stdout, test.expected) ? 'pass' : 'fail';
};

export const isBadVerdict = (v: Verdict) =>
    v === 'fail' || v === 'error' || v === 'timeout' || v === 'olimit';

/** 판정 글씨 (색은 백준 채점 결과 색, solver.css의 .verdict-*) */
const VERDICT_TEXT: Record<Verdict, string> = {
    pass: '통과',
    fail: '틀렸습니다',
    output: '실행됨',
    error: '런타임 에러',
    timeout: '시간 초과',
    olimit: '출력 초과',
    cancelled: '중단됨',
};

type Callbacks = {
    onToggle: (id: string) => void;
    onChangeCustom: (id: string, patch: { input?: string; expected?: string }) => void;
    /** 파일로 불러오기처럼 값을 통째로 바꿀 때 (카드를 다시 그림) */
    onReplaceCustom: (id: string, patch: { input?: string; expected?: string }) => void;
    onDeleteCustom: (id: string) => void;
    /** 에러의 소스 위치(줄, 열)로 에디터 이동 */
    onJumpToSource: (line: number, column: number | null) => void;
    /** 이 테스트 하나만 실행 */
    onRunOne: (test: TestCase) => void;
    /** 예제를 고칠 수 있는 내 테스트로 복사 */
    onDuplicate: (test: TestCase) => void;
};

/** 접힌 카드에 보여 줄 입력 첫 줄 (여러 줄이면 줄 수도) */
const inputPreview = (input: string) => {
    const lines = input.replace(/\n+$/, '').split('\n');
    const first = lines[0].length > 40 ? `${lines[0].slice(0, 40)}…` : lines[0];
    if (!first.trim()) return '';
    return lines.length > 1 ? `${first}  (+${lines.length - 1}줄)` : first;
};

const MAX_LINES = 400;

const MB = 1024 * 1024;
const formatMemory = (bytes: number) =>
    bytes >= 100 * MB ? `${Math.round(bytes / MB)}MB` : `${(bytes / MB).toFixed(1)}MB`;

/**
 * 이보다 큰 입력·출력은 앞부분만 보여 줍니다. 수 MB를 그대로 textarea·pre에 넣으면
 * 편집기 선택 처리 때마다 그 글자를 다시 배치하느라 화면이 수십 초씩 멈춥니다.
 */
const BIG_TEXT = 256 << 10;
const PREVIEW_CHARS = 16 << 10;

const formatSize = (chars: number) =>
    chars >= MB ? `${(chars / MB).toFixed(1)}MB` : `${Math.max(1, Math.round(chars / 1024))}KB`;
const countLines = (text: string) => {
    let n = 0;
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
    return text.endsWith('\n') ? n : n + 1;
};

/** 큰 글은 앞부분과 크기만 */
const previewText = (text: string) =>
    text.length > BIG_TEXT
        ? [
              text.slice(0, PREVIEW_CHARS),
              h(
                  'span',
                  { class: 'io-more' },
                  `\n… 앞부분만 보여 줍니다 (전체 ${formatSize(text.length)}, ${countLines(text).toLocaleString()}줄)`
              ),
          ]
        : text.length
          ? text.replace(/\n$/, '')
          : ' ';

const plainBlock = (label: string | Node[], text: string | (Node | string)[]) =>
    h('div', { class: 'io' }, [
        h('div', { class: 'io-label' }, [h('span', { class: 'io-title' }, label)]),
        h('pre', {}, typeof text !== 'string' ? text : previewText(text)),
    ]);

/** 실제 출력에서 기대 출력과 다른 줄을 빨간 글씨로, 그 안에서 다른 글자는 밑줄로 보여 줍니다. */
const sameLineAt = (
    a: string[],
    e: string[],
    i: number,
    sameLine: (a: string, e: string) => boolean
) => a[i] !== undefined && e[i] !== undefined && sameLine(a[i], e[i]);

const diffBlocks = (
    expected: string,
    actual: string,
    /** 두 줄이 같은지 (스페셜 저지 오차 비교면 오차 안이면 같음) */
    sameLine: (a: string, e: string) => boolean = (a, e) => a === e
) => {
    const e = normalizeOutput(expected).split('\n');
    const a = normalizeOutput(actual).split('\n');
    // 처음 다른 줄이 화면에 들어오도록, 그 줄 조금 위부터 보여 줍니다.
    let firstDiff = 0;
    while (firstDiff < Math.max(a.length, e.length) && sameLineAt(a, e, firstDiff, sameLine))
        firstDiff++;
    const from = Math.max(0, firstDiff - 20);
    /** 다른 줄은 그 안에서 실제로 다른 글자만 한 번 더 강조합니다. (공백 하나 차이도 보이게) */
    const lineContent = (line: string, other: string | undefined): (Node | string)[] => {
        if (other === undefined || line === other) return [line || ' '];
        const { start, endA, endB } = differingRange(line, other);
        // 줄 전체가 다르면 빨간 글씨만으로 충분합니다.
        if (start === 0 && endA === line.length && endB === other.length) return [line || ' '];
        const mid = line.slice(start, endA);
        return [
            line.slice(0, start),
            mid
                ? h('mark', { class: 'diff-char' }, mid.replace(/ /g, '·'))
                : // 이쪽에는 없고 상대 쪽에만 있는 글자: 자리만 표시
                  endB > start
                  ? h('mark', { class: 'diff-gap', title: '이 자리에 글자가 없습니다' }, '')
                  : '',
            line.slice(endA),
        ].filter((part) => part !== '');
    };
    const render = (lines: string[], other: string[] | null) => {
        const pre = h('pre');
        const shown = Math.min(lines.length, from + MAX_LINES);
        if (from > 0 && lines.length > 0)
            pre.append(
                h(
                    'span',
                    { class: 'diff-line io-more' },
                    `… 앞의 같은 ${Math.min(from, lines.length)}줄 생략`
                )
            );
        for (let i = from; i < shown; i++) {
            const bad = other !== null && (other[i] === undefined || !sameLine(lines[i], other[i]));
            pre.append(
                h(
                    'span',
                    { class: `diff-line ${bad ? 'diff-bad' : ''}` },
                    bad ? lineContent(lines[i], other[i]) : lines[i] || ' '
                )
            );
        }
        if (lines.length > shown)
            pre.append(h('span', { class: 'diff-line' }, `… ${lines.length - shown}줄 더`));
        return pre;
    };
    return [
        h('div', { class: 'io' }, [
            h('div', { class: 'io-label' }, [h('span', { class: 'io-title' }, '실제 출력')]),
            render(a, e),
        ]),
        h('div', { class: 'io' }, [
            h('div', { class: 'io-label' }, [h('span', { class: 'io-title' }, '기대 출력')]),
            render(e, null),
        ]),
    ];
};

/** 파일 고르기 → 글자로 읽어 넘깁니다. (큰 입력을 붙여 넣지 않고 넣을 수 있게) */
const pickTextFile = (onText: (text: string) => void) => {
    const input = h('input', { type: 'file', accept: '.txt,.in,.out,.ans,text/plain' });
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (file) onText((await file.text()).replace(/\r\n?/g, '\n'));
    });
    input.click();
};

const editable = (
    label: string,
    value: string,
    placeholder: string,
    onInput: (v: string) => void,
    onReplace: (v: string) => void
) => {
    const fileLink = h(
        'button',
        { class: 'link-button io-file', type: 'button', onclick: () => pickTextFile(onReplace) },
        '파일에서 불러오기'
    );
    const head = h('div', { class: 'io-label' }, [
        h('span', { class: 'io-title' }, label),
        fileLink,
    ]);
    // 큰 값은 고쳐 쓸 일이 거의 없고 화면만 느려지므로 요약과 비우기만 둡니다.
    if (value.length > BIG_TEXT) {
        return h('div', { class: 'io' }, [
            head,
            h('pre', {}, previewText(value)),
            h('div', {}, [
                h(
                    'button',
                    {
                        class: 'link-button link-button-danger',
                        type: 'button',
                        onclick: () => onReplace(''),
                    },
                    '비우기'
                ),
            ]),
        ]);
    }
    const area = h('textarea', { class: 'io-edit', spellcheck: 'false', placeholder, rows: 3 });
    area.value = value;
    // 큰 값을 붙여 넣으면 바로 요약 화면으로 바꿉니다. (큰 textarea가 남아 있으면 화면이 계속 느림)
    area.addEventListener('input', () =>
        area.value.length > BIG_TEXT ? onReplace(area.value) : onInput(area.value)
    );
    return h('div', { class: 'io' }, [head, area]);
};

export const renderTest = (
    test: TestCase,
    state: TestState,
    open: boolean,
    judge: JudgeContext,
    /** 지금 언어에 BOJ가 적용하는 시간 제한 (모르면 null) */
    judgeLimitMs: number | null,
    callbacks: Callbacks
): HTMLElement => {
    // 실행 중일 때만 제목 앞에 스피너를 둡니다.
    let spinner: HTMLElement | null = null;
    let verdictText: HTMLElement;
    let time: string | null = null;
    let verdict: Verdict | null = null;
    // 끝까지 돌았지만 BOJ 제한보다 오래 걸린 경우 (로컬은 채점 서버보다 느려서 판정은 바꾸지 않고 알리기만 함)
    let slow = false;
    // 메모리도 BOJ 제한을 넘었으면 알리기만 합니다. (로컬 측정은 wasm 선형 메모리 기준 근삿값)
    let memory: number | null = null;
    let heavy = false;

    switch (state.phase) {
        case 'idle':
        case 'skipped':
            verdictText = h(
                'span',
                { class: 'test-verdict verdict-muted' },
                state.phase === 'skipped' ? '실행 안 함' : ''
            );
            break;
        case 'queued':
            verdictText = h('span', { class: 'test-verdict verdict-muted' }, '대기');
            break;
        case 'running':
            spinner = h('span', { class: 'spinner', 'aria-hidden': 'true' });
            verdictText = h('span', { class: 'test-verdict verdict-muted' }, '실행 중');
            break;
        case 'done':
            verdict = verdictOf(test, state.result, judge);
            verdictText = h(
                'span',
                { class: `test-verdict verdict-${verdict}` },
                VERDICT_TEXT[verdict]
            );
            if (verdict !== 'timeout' && verdict !== 'cancelled') {
                time = `${Math.round(state.result.timeMs)}ms`;
                slow = judgeLimitMs !== null && state.result.timeMs > judgeLimitMs;
                memory = state.result.output.memoryBytes ?? null;
                heavy =
                    memory !== null &&
                    judge.memoryLimitMB !== null &&
                    memory > judge.memoryLimitMB * MB;
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
            spinner ?? '',
            h('span', { class: 'test-name' }, test.label),
            verdictText,
            // 접혀 있을 때 입력 첫 줄을 미리 보여 줍니다.
            h('span', { class: 'test-preview' }, open ? '' : inputPreview(test.input)),
            h('span', { class: `test-time ${slow || heavy ? 'is-slow' : ''}` }, [
                time ?? '',
                memory !== null && time ? ` · ${formatMemory(memory)}` : '',
            ]),
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
            editable(
                '입력',
                test.input,
                '입력값',
                (v) => callbacks.onChangeCustom(test.id, { input: v }),
                (v) => callbacks.onReplaceCustom(test.id, { input: v })
            ),
            editable(
                '기대 출력',
                test.expected,
                '비우면 비교하지 않고 출력만 봅니다',
                (v) => callbacks.onChangeCustom(test.id, { expected: v }),
                (v) => callbacks.onReplaceCustom(test.id, { expected: v })
            )
        );
    } else {
        body.append(plainBlock('입력', test.input));
    }
    if (state.phase === 'done') {
        const { stdout, stderr } = state.result.output;
        if (verdict === 'fail') {
            const tolerance = usesTolerance(test, judge) ? judge.tolerance! : null;
            body.append(
                ...diffBlocks(
                    test.expected,
                    stdout,
                    tolerance === null ? undefined : (a, e) => isSameWithTolerance(a, e, tolerance)
                )
            );
        } else if (verdict !== 'cancelled') {
            if (test.kind === 'sample' && verdict !== 'pass')
                body.append(plainBlock('기대 출력', test.expected));
            body.append(
                plainBlock(verdict === 'timeout' ? '실제 출력 (중단 전까지)' : '실제 출력', stdout)
            );
        }
        if (stderr.trim())
            body.append(
                plainBlock(
                    '표준 에러',
                    linkifyLocations(stderr.replace(/\n$/, ''), callbacks.onJumpToSource)
                )
            );
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
        if (state.result.notice) body.append(h('p', { class: 'io-note' }, state.result.notice));
        if (heavy && memory !== null && judge.memoryLimitMB !== null) {
            body.append(
                h(
                    'p',
                    { class: 'io-note io-note-warn' },
                    `메모리를 약 ${formatMemory(memory)} 썼습니다. 이 문제의 메모리 제한은 ` +
                        `${judge.memoryLimitMB}MB라서 백준에서 메모리 초과가 날 수 있습니다.`
                )
            );
        }
        if ((verdict === 'pass' || verdict === 'fail') && usesTolerance(test, judge)) {
            body.append(
                h(
                    'p',
                    { class: 'io-note' },
                    `스페셜 저지 문제라서 실수는 오차 ${judge.tolerance!.toExponential(0)} 이내로 비교했습니다.`
                )
            );
        }
        if (state.result.output.truncated)
            body.append(
                h(
                    'p',
                    { class: 'io-note' },
                    `출력이 ${formatSize(OUTPUT_LIMIT)}를 넘어 잘랐습니다.`
                )
            );
    } else if (test.kind === 'sample') {
        body.append(plainBlock('기대 출력', test.expected));
    }

    // 카드 아래 동작: 이것만 실행 · 복제(예제) / 삭제(내 테스트)
    const link = (text: string, onclick: () => void, extra = '', title?: string) =>
        h('button', { class: `link-button ${extra}`, type: 'button', title, onclick }, text);
    body.append(
        h('div', { class: 'test-actions' }, [
            link('이 테스트만 실행', () => callbacks.onRunOne(test)),
            test.kind === 'sample'
                ? link(
                      '테스트 복제',
                      () => callbacks.onDuplicate(test),
                      '',
                      '이 예제의 입력과 기대 출력을 고칠 수 있는 내 테스트로 복사합니다'
                  )
                : link(
                      '이 테스트 삭제',
                      () => callbacks.onDeleteCustom(test.id),
                      'link-button-danger'
                  ),
        ])
    );
    card.append(body);
    return card;
};
