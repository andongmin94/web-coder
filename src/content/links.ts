// 채점 현황·내 제출 등에서 "수정"(제출한 코드로 다시 제출) 링크를 누르면 웹 코더가 열리도록
// 주소에 #webcoder를 붙입니다. 누르는 순간(마우스·터치·Enter)에 바꿔서, 새 탭으로 열기와
// 나중에 표에 추가되는 줄에도 적용됩니다. 그냥 "제출" 링크와 다른 링크는 건드리지 않습니다.
import { SOLVER_HASH } from './menu.ts';

/** /submit/문제번호/제출번호 꼴인지 */
export const isResubmitPath = (pathname: string) => /^\/submit\/\d+\/\d+\/?$/.test(pathname);

const markResubmitLink = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link || link.hostname !== location.hostname) return;
    if (isResubmitPath(link.pathname) && !link.hash) link.hash = SOLVER_HASH;
};

for (const type of ['pointerdown', 'keydown'])
    document.addEventListener(type, markResubmitLink, true);
