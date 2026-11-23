// BOJ 문제 페이지에서 본문/예제/제한을 뽑고 chrome.storage에 저장합니다.
//
// BOJ는 주소창으로 연 페이지 이동에만 본문을 주고, fetch·iframe 요청에는 빈 응답을 줍니다.
// 그래서 사용자가 문제 페이지(/problem/*)를 열 때 그 페이지에서 읽어 저장해 두고,
// 제출 페이지는 저장된 데이터를 씁니다.
import { findToleranceInfo } from '../judge/judge.ts';
import { normalizeLabel } from '../shared/languages.ts';
import type { ProblemData, ProblemSection, Sample } from '../shared/protocol.ts';

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/ /g, ' ').trim();

const absolutize = (root: Element, base: string) => {
    for (const el of root.querySelectorAll<HTMLElement>('[src], [href]')) {
        for (const attr of ['src', 'href']) {
            const value = el.getAttribute(attr);
            if (!value || value.startsWith('#') || /^(data|javascript):/i.test(value)) continue;
            try {
                el.setAttribute(attr, new URL(value, base).href);
            } catch {
                el.removeAttribute(attr);
            }
        }
    }
};

const parseNumber = (value: string): number | null => {
    const match = /(\d+(?:\.\d+)?)/.exec(value);
    return match ? Number(match[1]) : null;
};

/**
 * 구분자가 붙은 TeX 원문(`\(N\)`, `\[x\]`, `$N$`, `$$x$$`)을 나눕니다.
 * BOJ의 MathJax 3은 원문을 `span.mjx-copytext`에 이 꼴로만 남깁니다.
 */

/** 스페셜 저지 문제의 허용 오차와 종류 (절대/상대) */
const toleranceOf = (isSpecialJudge: boolean, text: string) => {
    // 답이 여러 개인 문제는 예제와 다른 답도 맞으므로 오차 비교를 하지 않고 출력만 보여 줍니다.
    const manyAnswers =
        /(정답|답|방법)[이은가]?\s*여러\s*(개|가지)|아무거나|any\s+(one\s+)?of\s+them|multiple\s+(answers|solutions)/i.test(
            text
        );
    const info = isSpecialJudge && !manyAnswers ? findToleranceInfo(text) : null;
    return { tolerance: info?.value ?? null, toleranceMode: info?.mode ?? null };
};

export const splitTexDelimiters = (text: string): { tex: string; display: boolean } | null => {
    const value = text.trim();
    const patterns: [RegExp, boolean][] = [
        [/^\\\(([\s\S]*)\\\)$/, false],
        [/^\\\[([\s\S]*)\\\]$/, true],
        [/^\$\$([\s\S]*)\$\$$/, true],
        [/^\$([\s\S]*)\$$/, false],
    ];
    for (const [pattern, display] of patterns) {
        const match = pattern.exec(value);
        if (match?.[1]?.trim()) return { tex: match[1].trim(), display };
    }
    return null;
};

/** MathJax가 이미 렌더링한 수식은 원래 TeX로 되돌립니다. (솔버에서 KaTeX로 다시 렌더링) */
const restoreMath = (root: Element) => {
    for (const container of root.querySelectorAll('mjx-container')) {
        const tex = container.querySelector('mjx-assistive-mml, script[type^="math/tex"]');
        let source = container.getAttribute('data-tex') ?? tex?.getAttribute('alttext');
        let display = container.getAttribute('display') === 'true';
        if (!source) {
            const copied = splitTexDelimiters(
                container.querySelector('.mjx-copytext')?.textContent ?? ''
            );
            if (copied) ({ tex: source, display } = copied);
        }
        if (source) container.replaceWith(display ? `$$${source}$$` : `$${source}$`);
        // 원문이 없으면 수식을 읽을 수 있는 글자로라도 남깁니다.
        else container.replaceWith(text(container.querySelector('mjx-assistive-mml')));
    }
    for (const script of root.querySelectorAll('script[type^="math/tex"]')) {
        const display = (script.getAttribute('type') ?? '').includes('mode=display');
        script.replaceWith(display ? `$$${script.textContent}$$` : `$${script.textContent}$`);
    }
    for (const el of root.querySelectorAll(
        '.MathJax_Preview, .MathJax, .MathJax_Display, mjx-assistive-mml'
    )) {
        el.remove();
    }
};

export const parseProblemDocument = (id: string, doc: Document, origin: string): ProblemData => {
    const url = `${origin}/problem/${id}`;
    const original = doc.querySelector('#problem-body');
    if (!original) throw new Error('문제 본문을 찾지 못했습니다.');
    const body = original.cloneNode(true) as Element;

    absolutize(body, url);
    restoreMath(body);

    const sections: ProblemSection[] = [];
    for (const section of body.querySelectorAll<HTMLElement>('section[id]')) {
        const content = section.querySelector('.problem-text, pre');
        if (!content) continue;
        const hasMedia = content.querySelector('img, table, svg, pre');
        if (!text(content) && !hasMedia) continue;
        const title = text(section.querySelector('.headline h2, h2'))
            .replace(/\s*복사\s*$/, '')
            .trim();
        sections.push({ id: section.id, title, html: content.outerHTML });
    }

    const samples: Sample[] = [];
    for (const input of doc.querySelectorAll<HTMLElement>('[id^="sample-input-"]')) {
        const n = input.id.slice('sample-input-'.length);
        const output = doc.getElementById(`sample-output-${n}`);
        samples.push({
            // 예제의 &nbsp;는 채점 데이터에서는 보통 공백입니다. (그대로 두면 cin, int()가 못 읽음)
            input: (input.textContent ?? '').replace(/\r/g, '').replace(/\u00a0/g, ' '),
            output: (output?.textContent ?? '').replace(/\r/g, '').replace(/\u00a0/g, ' '),
        });
    }

    const infoCells = doc.querySelectorAll('#problem-info tbody tr td');
    const time = text(infoCells[0]);
    const memory = text(infoCells[1]);

    const isSpecialJudge = Boolean(doc.querySelector('.problem-label-spj'));
    // 제목 옆 라벨: 함수 구현(main 없이 함수만 제출), 인터랙티브(채점기와 입출력을 주고받음)
    const labels = [...doc.querySelectorAll('[class*="problem-label"]')].map(
        (el) => `${el.className} ${text(el)}`
    );
    const kind: ProblemData['kind'] = labels.some((l) => /problem-label-func|함수 구현/.test(l))
        ? 'function'
        : labels.some((l) => /interactive|인터랙티브/i.test(l))
          ? 'interactive'
          : null;

    // "하단 참고" 문제의 언어별 시간 제한 목록 (<li>Java 8: 1.5 초</li>)
    const languageTimeLimits: Record<string, number> = {};
    for (const li of doc.querySelectorAll('#problem-time-limit li')) {
        const match = /^(.+):\s*([\d.]+)\s*초/.exec(text(li));
        if (match) languageTimeLimits[normalizeLabel(match[1])] = Number(match[2]);
    }

    return {
        id,
        title: text(doc.querySelector('#problem_title')) || `${id}번`,
        url,
        timeLimitSec: parseNumber(time),
        noExtraTime: /추가\s*시간\s*없음/.test(time),
        languageTimeLimits,
        memoryLimitMB: parseNumber(memory),
        limitText: { time, memory },
        isSpecialJudge,
        kind,
        ...toleranceOf(isSpecialJudge, body.textContent ?? ''),
        sections,
        samples,
    };
};

// ── 저장소 ─────────────────────────────────────────────────────────────

const CACHE_LIMIT = 100;
export const problemKey = (id: string) => `problem:${id}`;
const INDEX_KEY = 'problem-index';

const writeProblem = async (problem: ProblemData) => {
    const { [INDEX_KEY]: index = [] } = (await chrome.storage.local.get(INDEX_KEY)) as {
        [INDEX_KEY]?: string[];
    };
    const next = [problem.id, ...index.filter((id) => id !== problem.id)];
    const evicted = next.splice(CACHE_LIMIT);
    await chrome.storage.local.set({ [problemKey(problem.id)]: problem, [INDEX_KEY]: next });
    if (evicted.length) await chrome.storage.local.remove(evicted.map(problemKey));
};

/**
 * 문제 목록(index)은 읽고-고쳐-쓰기라서, 여러 탭이 동시에 문제를 열면 한쪽이 덮어써
 * 목록에서 빠진(지워지지 않는) 문제가 남을 수 있습니다. 같은 사이트의 탭끼리 Web Locks로 차례를 맞춥니다.
 */
export const saveProblem = (problem: ProblemData) =>
    navigator.locks
        ? navigator.locks.request('webcoder-problem-index', () => writeProblem(problem))
        : writeProblem(problem);

export const loadProblem = async (id: string): Promise<ProblemData | null> => {
    const data = await chrome.storage.local.get(problemKey(id));
    return (data[problemKey(id)] as ProblemData | undefined) ?? null;
};

/** 저장된 데이터가 없을 때 시도합니다. (BOJ가 빈 응답을 주면 실패) */
export const fetchProblem = async (id: string): Promise<ProblemData> => {
    const response = await fetch(`/problem/${id}`, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return parseProblemDocument(id, doc, location.origin);
};
