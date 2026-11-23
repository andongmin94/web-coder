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
        problem.isSpecialJudge &&
            h(
                'span',
                {
                    class: 'chip chip-warn',
                    title: problem.tolerance
                        ? '실수 출력은 허용 오차 안에서 비교합니다.'
                        : '정답이 여러 개일 수 있어 출력만 보여 줍니다.',
                },
                problem.tolerance
                    ? `스페셜 저지 · 오차 ${problem.tolerance.toExponential(0)}`
                    : '스페셜 저지'
            ),
    ].filter((el): el is HTMLSpanElement => Boolean(el));

/** 예제 칸 제목 옆 "복사" 버튼 (백준과 같음) */
const copyButton = (content: HTMLElement) => {
    const button = h('button', { class: 'copy-button', type: 'button' }, '복사');
    button.addEventListener('click', async () => {
        const text = content.querySelector('pre')?.textContent ?? '';
        try {
            await navigator.clipboard.writeText(text);
            button.textContent = '복사됨';
        } catch {
            button.textContent = '복사 실패';
        }
        setTimeout(() => (button.textContent = '복사'), 1500);
    });
    return button;
};

const isSample = (id: string) => /^sample(input|output)\d+$/.test(id);

const renderSection = (section: ProblemData['sections'][number]) => {
    const content = h('div', { class: 'problem-section-content' });
    content.innerHTML = sanitize(section.html);
    const title = h('span', {}, [section.title, isSample(section.id) ? copyButton(content) : '']);
    return h('section', { class: 'problem-section' }, [h('h2', {}, [title]), content]);
};

export const renderProblem = (container: HTMLElement, problem: ProblemData) => {
    const body = h('div', { class: 'problem-body' });
    const sections = problem.sections;
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const next = sections[i + 1];
        // 백준처럼 예제 입력 n과 예제 출력 n을 나란히 둡니다.
        const n = /^sampleinput(\d+)$/.exec(section.id)?.[1];
        if (n && next?.id === `sampleoutput${n}`) {
            body.append(
                h('div', { class: 'sample-row' }, [renderSection(section), renderSection(next)])
            );
            i++;
            continue;
        }
        body.append(renderSection(section));
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
