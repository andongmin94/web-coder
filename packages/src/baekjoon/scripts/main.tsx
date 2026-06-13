// 백준 페이지에 직접 주입되어 동작을 시작하는 스크립트 파일입니다.
import customSubmitPage from './submit';

const url: string = window.location.pathname;

export const customBaekjoonPage = () => {
    if (url.startsWith('/submit')) {
        customSubmitPage();
    }
};
