// BOJ 문제 메뉴(문제 번호 | 제출 | 맞힌 사람 …)의 "제출" 옆에 "웹 코더로 제출" 탭을 붙입니다.
// 원래 "제출"은 그대로 두어, BOJ 폼으로 바로 제출하려는 사람을 방해하지 않습니다.

/** 이 표시가 붙은 제출 페이지 주소는 열리자마자 웹 코더를 띄웁니다. */
export const SOLVER_HASH = '#webcoder';
const TAB_CLASS = 'webcoder-tab';

/**
 * onOpen을 주면(제출 페이지) 탭을 눌렀을 때 이동하지 않고 그 함수를 부릅니다.
 * 메뉴를 못 찾으면(BOJ 화면이 바뀐 경우) false.
 */
export const addSolverTab = (onOpen?: () => void): boolean => {
    if (document.querySelector(`.${TAB_CLASS}`)) return true;
    const submit = document.querySelector<HTMLAnchorElement>('ul.problem-menu a[href*="/submit/"]');
    const item = submit?.closest('li');
    if (!submit || !item) return false;

    const link = document.createElement('a');
    link.href = `${submit.pathname}${SOLVER_HASH}`;
    link.textContent = '웹 코더로 제출';
    if (onOpen)
        link.addEventListener('click', (event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            onOpen();
        });
    const tab = document.createElement('li');
    tab.className = TAB_CLASS;
    tab.appendChild(link);
    item.after(tab);
    return true;
};
