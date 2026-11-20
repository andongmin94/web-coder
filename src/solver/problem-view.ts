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

export const renderProblem = (container: HTMLElement, problem: ProblemData) => {
    const limits = h('div', { class: 'problem-limits' }, [
        problem.limitText.time && h('span', { class: 'chip' }, `시간 ${problem.limitText.time}`),
        problem.limitText.memory &&
            h('span', { class: 'chip' }, `메모리 ${problem.limitText.memory}`),
        problem.isSpecialJudge && h('span', { class: 'chip chip-warn' }, '스페셜 저지'),
    ]);

    const header = h('header', { class: 'problem-header' }, [
        h('h1', {}, [
            h(
                'a',
                { href: problem.url, target: '_blank', rel: 'noopener noreferrer' },
                `${problem.id}번`
            ),
            ` ${problem.title}`,
        ]),
        limits,
    ]);

    const body = h('div', { class: 'problem-body' });
    for (const section of problem.sections) {
        const content = h('div', { class: 'problem-section-content' });
        content.innerHTML = sanitize(section.html);
        body.append(
            h('section', { class: 'problem-section' }, [h('h2', {}, section.title), content])
        );
    }

    container.replaceChildren(header, body);

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

export const renderProblemError = (container: HTMLElement, message: string, url: string) => {
    container.replaceChildren(
        h('div', { class: 'empty' }, [
            h('p', {}, message),
            h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, '문제 페이지 열기'),
        ])
    );
};
