import customSubmitPage from './submit';

const url: string = window.location.pathname;

export const customBaekjoonPage = () => {
    if (url.startsWith('/submit')) {
        customSubmitPage();
    }
};
