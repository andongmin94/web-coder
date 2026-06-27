// 백준 기능에서 재사용하는 계산과 변환 로직을 담은 유틸 파일입니다.
import React from 'react';
import { TestCase } from '@/baekjoon/types/problem';
import uuid from 'react-uuid';
import { trimLineByLine } from '@/common/utils/string';

// 문자열이 BOJ 문제 번호처럼 숫자로만 이루어졌는지 확인합니다.
const isNumericId = (value: string | null | undefined): value is string => {
    return !!value && /^\d+$/.test(value);
};

// 현재 페이지에서 문제 번호를 최대한 여러 경로로 찾아냅니다.
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

// 문제 상세 HTML에서 제출 폼과 불필요한 버튼을 제거하고 본문만 렌더링합니다.
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

// 수식 렌더링에 필요한 스타일 태그만 추출합니다.
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

// BOJ 샘플 입력/출력을 읽어서 테스트 케이스 배열로 바꿉니다.
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
