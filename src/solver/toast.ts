// 화면 아래에 잠깐 뜨는 알림
import { els } from './elements.ts';

let toastTimer = 0;

export type ShowToast = (message: string, kind?: 'info' | 'error') => void;

export const showToast: ShowToast = (message, kind = 'info') => {
    els.toast.textContent = message;
    els.toast.className = `toast toast-${kind} show`;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 4000);
};
