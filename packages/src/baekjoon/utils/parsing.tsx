import React from 'react';
import { TestCase } from '@/baekjoon/types/problem';
import uuid from 'react-uuid';
import { trimLineByLine } from '@/common/utils/string';

const isNumericId = (value: string | null | undefined): value is string => {
    return !!value && /^\d+$/.test(value);
};

export const getProblemId = (): string | null => {
    // 1) submit form hidden input
    const formProblemId = document.querySelector<HTMLInputElement>(
        '#submit_form input[name="problem_id"], input[name="problem_id"]'
    )?.value;
    if (isNumericId(formProblemId)) {
        return formProblemId;
    }

    // 2) problem menu link
    const problemLink = document.querySelector<HTMLAnchorElement>(
        'ul.problem-menu li a[href*="/problem/"]'
    );
    const href = problemLink?.getAttribute('href') ?? '';
    const hrefMatch = href.match(/\/problem\/(\d+)/);
    if (hrefMatch) {
        return hrefMatch[1];
    }

    const textMatch = (problemLink?.textContent ?? '').match(/\d+/);
    if (textMatch) {
        return textMatch[0];
    }

    // 3) query string
    const queryProblemId = new URLSearchParams(window.location.search).get(
        'problem_id'
    );
    if (isNumericId(queryProblemId)) {
        return queryProblemId;
    }

    // 4) pathname
    const pathMatch = window.location.pathname.match(
        /\/(?:submit|problem)\/(\d+)/
    );
    if (pathMatch) {
        return pathMatch[1];
    }

    console.error('문제 번호 가져오기 실패');
    return null;
};

export const parsingProblemDetail = (html: string): JSX.Element => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const problemContainer = (doc.querySelector(
        '.container.content .row'
    ) ??
        doc.querySelector('#problem-body') ??
        doc.querySelector('.row')) as HTMLElement | null;

    if (problemContainer) {
        const elementsToRemove = [
            'ul.problem-menu',
            '.problem-button',
            '#problem_tags',
            '#problem_memo',
            '#submit_form',
            '#webcoder-solve-root',
            '#andongmin-web-coder-wrapper',
        ];

        elementsToRemove.forEach((selector) => {
            const elem = problemContainer.querySelector(selector);
            if (elem && elem.parentNode) {
                elem.parentNode.removeChild(elem);
            }
        });

        const copyButtons = problemContainer.querySelectorAll('.copy-button');
        copyButtons.forEach((button) => {
            button.parentNode?.removeChild(button);
        });

        problemContainer.style.margin = '0';

        return (
            <div
                className='problem-content'
                dangerouslySetInnerHTML={{
                    __html: problemContainer.innerHTML,
                }}
            ></div>
        );
    }

    return <h1>문제를 불러오는데 실패했습니다.</h1>;
};

export const parsingStyle = (html: string): JSX.Element => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const style =
        doc.querySelector('#MJX-CHTML-styles') ??
        doc.querySelector('style[id*="MJX"]') ??
        doc.querySelector('style');

    if (style) {
        return <style>{style.textContent}</style>;
    }
    return <style>{''}</style>;
};

export const parsingTestCases = (html: string): TestCase[] => {
    const testCases: TestCase[] = [];
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const inputs = doc.querySelectorAll('[id^="sample-input-"]');
    const outputs = doc.querySelectorAll('[id^="sample-output-"]');
    const isMultiAnswer = doc.querySelector('.problem-label-spj');
    const count = inputs.length;

    for (let i = 0; i < count; ++i) {
        testCases.push({
            uuid: uuid(),
            input: (inputs[i].textContent as string).trim(),
            output: trimLineByLine(outputs[i].textContent as string),
            isMultiAnswer: isMultiAnswer != null,
        });
    }

    return testCases;
};
