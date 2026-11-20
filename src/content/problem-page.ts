// 문제 페이지(/problem/*) content script: 본문과 예제를 읽어 저장해 둡니다. 화면은 바꾸지 않습니다.
import { parseProblemDocument, saveProblem } from './problem.ts';

const id = /^\/problem\/(\d+)\/?$/.exec(location.pathname)?.[1];

const save = () => {
    if (!id || !document.querySelector('#problem-body')) return;
    try {
        void saveProblem(parseProblemDocument(id, document, location.origin));
    } catch {
        // 구조가 달라 읽지 못하면 저장하지 않습니다.
    }
};

if (id) {
    // MathJax 렌더링 전후 모두 원문 TeX를 복원하므로 바로 저장해도 됩니다.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', save, { once: true });
    } else {
        save();
    }
}
