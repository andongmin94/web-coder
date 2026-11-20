// BOJ 문제 페이지에서 본문/예제/제한을 뽑고 chrome.storage에 저장합니다.
//
// BOJ는 주소창으로 연 페이지 이동에만 본문을 주고, fetch·iframe 요청에는 빈 응답을 줍니다.
// 그래서 사용자가 문제 페이지(/problem/*)를 열 때 그 페이지에서 읽어 저장해 두고,
// 제출 페이지는 저장된 데이터를 씁니다.
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

/** MathJax가 이미 렌더링한 수식은 원래 TeX로 되돌립니다. (솔버에서 KaTeX로 다시 렌더링) */
const restoreMath = (root: Element) => {
    for (const container of root.querySelectorAll('mjx-container')) {
        const tex = container.querySelector('mjx-assistive-mml, script[type^="math/tex"]');
        const source = container.getAttribute('data-tex') ?? tex?.getAttribute('alttext');
        const display = container.getAttribute('display') === 'true';
        if (source) container.replaceWith(display ? `$$${source}$$` : `$${source}$`);
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
            input: (input.textContent ?? '').replace(/\r/g, ''),
            output: (output?.textContent ?? '').replace(/\r/g, ''),
        });
    }

    const infoCells = doc.querySelectorAll('#problem-info tbody tr td');
    const time = text(infoCells[0]);
    const memory = text(infoCells[1]);

    return {
        id,
        title: text(doc.querySelector('#problem_title')) || `${id}번`,
        url,
        timeLimitSec: parseNumber(time),
        memoryLimitMB: parseNumber(memory),
        limitText: { time, memory },
        isSpecialJudge: Boolean(doc.querySelector('.problem-label-spj')),
        sections,
        samples,
    };
};

// ── 저장소 ─────────────────────────────────────────────────────────────

const CACHE_LIMIT = 100;
export const problemKey = (id: string) => `problem:${id}`;
const INDEX_KEY = 'problem-index';

export const saveProblem = async (problem: ProblemData) => {
    const { [INDEX_KEY]: index = [] } = (await chrome.storage.local.get(INDEX_KEY)) as {
        [INDEX_KEY]?: string[];
    };
    const next = [problem.id, ...index.filter((id) => id !== problem.id)];
    const evicted = next.splice(CACHE_LIMIT);
    await chrome.storage.local.set({ [problemKey(problem.id)]: problem, [INDEX_KEY]: next });
    if (evicted.length) await chrome.storage.local.remove(evicted.map(problemKey));
};

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
