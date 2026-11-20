// 문제 본문 렌더링. BOJ에서 받은 HTML도 확장 페이지 권한으로 실행되지 않도록 반드시 정화합니다.
import DOMPurify from 'dompurify';
import renderMathInElement from 'katex/contrib/auto-render';
import type { ProblemData } from '../shared/protocol.ts';
import { h } from './dom.ts';

const sanitize = (html: string) =>
    DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
        FORBID_ATTR: ['style', 'onerror', 'onload'],
    });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLAnchorElement) {
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
    }
});

/** 상단 바용 제한 칩 */
export const limitChips = (problem: ProblemData) =>
    [
        problem.limitText.time && h('span', { class: 'chip' }, `시간 ${problem.limitText.time}`),
        problem.limitText.memory &&
            h('span', { class: 'chip' }, `메모리 ${problem.limitText.memory}`),
        problem.isSpecialJudge && h('span', { class: 'chip chip-warn' }, '스페셜 저지'),
    ].filter((el): el is HTMLSpanElement => Boolean(el));

export const renderProblem = (container: HTMLElement, problem: ProblemData) => {
    const body = h('div', { class: 'problem-body' });
    for (const section of problem.sections) {
        const content = h('div', { class: 'problem-section-content' });
        content.innerHTML = sanitize(section.html);
        body.append(
            h('section', { class: 'problem-section' }, [h('h2', {}, section.title), content])
        );
    }
    container.replaceChildren(body);
    container.scrollTop = 0;

    try {
        renderMathInElement(body, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
            ],
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
            throwOnError: false,
        });
    } catch {
        // 수식 렌더 실패 시 원문 그대로 둡니다.
    }
};

/** 문제 데이터가 아직 없을 때: BOJ는 문제 페이지를 직접 열어야 본문을 줍니다. */
export const renderProblemMissing = (container: HTMLElement, url: string) => {
    container.replaceChildren(
        h('div', { class: 'notice-card' }, [
            h('strong', {}, '문제 본문이 아직 없습니다'),
            h(
                'span',
                {},
                '문제 페이지를 한 번 열면 본문과 예제가 저장되어 여기에 바로 나타납니다.'
            ),
            h('br'),
            h(
                'a',
                {
                    class: 'btn btn-primary',
                    href: url,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                },
                '문제 페이지 열기'
            ),
        ])
    );
};
