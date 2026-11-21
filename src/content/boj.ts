// BOJ /submit 페이지에서 솔버 iframe을 띄우는 content script (격리 world).
// 페이지는 BOJ 원래 화면 그대로 두고, 제출 버튼 옆에 "웹 코더로 제출" 버튼만 붙입니다.
// (원래 폼으로 바로 제출하려는 사람을 방해하지 않기 위해 자동으로 열지 않습니다)
// 버튼을 누르면: 문제/폼 정보 수집 → iframe에 전달, iframe의 제출 요청을 원래 폼으로 처리.
import { fetchProblem, loadProblem, problemKey, saveProblem } from './problem.ts';
import {
    MAIN_REPLY_EVENT,
    MAIN_REQUEST_EVENT,
    type CodeOpenOption,
    type MainReply,
    type MainRequest,
    type ParentToSolver,
    type ProblemData,
    type SolverToParent,
    type SubmitFormData,
} from '../shared/protocol.ts';
import type { BojLanguage } from '../shared/languages.ts';

const ROOT_ID = 'webcoder-root';
const HIDDEN_CLASS = 'webcoder-hidden';
const SOLVER_URL = chrome.runtime.getURL('solver.html');
const SOLVER_ORIGIN = new URL(SOLVER_URL).origin;

const injectStyle = () => {
    if (document.getElementById('webcoder-style')) return;
    const style = document.createElement('style');
    style.id = 'webcoder-style';
    style.textContent = `
        .${HIDDEN_CLASS} { display: none !important; }
        html.webcoder-open-page, html.webcoder-open-page body { overflow: hidden !important; }
        /* BOJ 화면 위를 꽉 채우는 작업 공간 (reCAPTCHA 배지 등 고정 요소보다 위) */
        #${ROOT_ID} {
            position: fixed; inset: 0; z-index: 2147483647;
            background: #fff; color-scheme: light dark;
        }
        @media (prefers-color-scheme: dark) { #${ROOT_ID} { background: #1b1e23; } }
        #${ROOT_ID} iframe { display: block; width: 100%; height: 100%; border: 0; }
        .webcoder-open {
            display: inline-flex; align-items: center; gap: 6px; margin: 0 0 12px;
            padding: 8px 14px; border: 0; border-radius: 6px;
            background: #0b6bcb; color: #fff; font-weight: 600; cursor: pointer;
        }
        .webcoder-open:hover { background: #0a5cad; }
        /* 제출 버튼 바로 옆에 놓일 때: 같은 줄, 같은 높이 */
        .webcoder-open.webcoder-inline { margin: 0 0 0 8px; padding: 6px 12px; vertical-align: middle; }
        .webcoder-notice {
            margin: 0 0 12px; padding: 10px 12px; border-radius: 4px;
            background: #fff8e1; border: 1px solid #f0c36d; color: #5d4500;
        }
    `;
    document.head.appendChild(style);
};

// ── MAIN world 호출 ──────────────────────────────────────────────

let mainRequestId = 1;
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
const callMain = (request: WithoutId<MainRequest>, timeoutMs = 3000): Promise<MainReply> => {
    const id = mainRequestId++;
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            window.removeEventListener(MAIN_REPLY_EVENT, onReply);
            resolve({ id, ok: false, message: '페이지 스크립트가 응답하지 않습니다.' });
        }, timeoutMs);
        function onReply(event: Event) {
            let reply: MainReply;
            try {
                reply = JSON.parse(String((event as CustomEvent).detail)) as MainReply;
            } catch {
                return;
            }
            if (reply.id !== id) return;
            clearTimeout(timer);
            window.removeEventListener(MAIN_REPLY_EVENT, onReply);
            resolve(reply);
        }
        window.addEventListener(MAIN_REPLY_EVENT, onReply);
        window.dispatchEvent(
            new CustomEvent(MAIN_REQUEST_EVENT, { detail: JSON.stringify({ ...request, id }) })
        );
    });
};

// ── 페이지 정보 수집 ─────────────────────────────────────────────

const getForm = () => document.querySelector<HTMLFormElement>('#submit_form');

const getProblemId = (): string | null => {
    const fromInput = document.querySelector<HTMLInputElement>('input[name="problem_id"]')?.value;
    if (fromInput && /^\d+$/.test(fromInput)) return fromInput;
    return /\/submit\/(\d+)/.exec(location.pathname)?.[1] ?? null;
};

const labelFor = (input: HTMLInputElement): string => {
    const byFor = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
    const label = byFor ?? input.closest('label');
    return (label?.textContent ?? input.value).replace(/\s+/g, ' ').trim();
};

const readFormData = async (form: HTMLFormElement): Promise<SubmitFormData> => {
    const languages: BojLanguage[] = [];
    let selectedLanguageId: string | null = null;
    const select = form.querySelector<HTMLSelectElement>('select[name="language"]');
    if (select) {
        for (const option of select.options) {
            if (!option.value) continue;
            languages.push({ id: option.value, label: option.text.replace(/\s+/g, ' ').trim() });
        }
        selectedLanguageId = select.value || null;
    } else {
        for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="language"]')) {
            languages.push({ id: radio.value, label: labelFor(radio) });
            if (radio.checked) selectedLanguageId = radio.value;
        }
    }

    const codeOpenOptions: CodeOpenOption[] = [];
    let codeOpenValue: string | null = null;
    for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="code_open"]')) {
        codeOpenOptions.push({ value: radio.value, label: labelFor(radio) });
        if (radio.checked) codeOpenValue = radio.value;
    }

    // MAIN world 스크립트가 늦게 로드될 수 있어 몇 번 재시도합니다.
    let reply: MainReply = { id: 0, ok: false };
    for (let i = 0; i < 3 && !reply.ok; i++) reply = await callMain({ type: 'read-source' }, 1000);
    const initialSource =
        (reply.ok ? reply.source : undefined) ??
        form.querySelector<HTMLTextAreaElement>('textarea[name="source"]')?.value ??
        '';

    return { languages, selectedLanguageId, codeOpenOptions, codeOpenValue, initialSource };
};

// ── 화면 전환 ─────────────────────────────────────────────────────

let removeListener: (() => void) | null = null;

const showNativeForm = (notice?: string) => {
    removeListener?.();
    removeListener = null;
    document.getElementById(ROOT_ID)?.remove();
    document.documentElement.classList.remove('webcoder-open-page');
    const form = getForm();
    if (!form) return;
    injectStyle();
    form.classList.remove(HIDDEN_CLASS);

    document.querySelector('.webcoder-open')?.remove();
    document.querySelector('.webcoder-notice')?.remove();

    if (notice) {
        const box = document.createElement('div');
        box.className = 'webcoder-notice';
        box.textContent = notice;
        form.before(box);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'webcoder-open';
    button.textContent = '웹 코더로 제출';
    button.addEventListener('click', () => void mount());
    // 원래 제출 버튼 옆에 둡니다. 버튼을 못 찾으면(BOJ 화면이 바뀐 경우) 폼 위에 둡니다.
    const submit = form.querySelector<HTMLElement>(
        '#submit_button, button[type="submit"], input[type="submit"]'
    );
    if (submit) {
        button.classList.add('webcoder-inline');
        submit.after(button);
    } else {
        form.before(button);
    }
};

const mount = async () => {
    const form = getForm();
    const problemId = getProblemId();
    if (!form || !problemId) return;

    injectStyle();
    document.querySelector('.webcoder-open')?.remove();
    document.querySelector('.webcoder-notice')?.remove();
    document.getElementById(ROOT_ID)?.remove();

    const root = document.createElement('div');
    root.id = ROOT_ID;
    const iframe = document.createElement('iframe');
    iframe.src = SOLVER_URL;
    iframe.title = '웹 코더';
    iframe.allow = 'clipboard-read; clipboard-write';
    root.appendChild(iframe);
    document.body.appendChild(root);
    document.documentElement.classList.add('webcoder-open-page');
    form.classList.add(HIDDEN_CLASS);

    const formDataPromise = readFormData(form);
    // 문제 페이지를 열 때 저장해 둔 데이터를 먼저 쓰고, 없으면 직접 받아 봅니다.
    const problemPromise = (async () => {
        const cached = await loadProblem(problemId).catch(() => null);
        if (cached) return { problem: cached, error: undefined };
        try {
            const problem = await fetchProblem(problemId);
            void saveProblem(problem);
            return { problem, error: undefined };
        } catch {
            return {
                problem: null,
                error: '문제 페이지를 한 번 열면 본문과 예제가 여기에 표시됩니다.',
            };
        }
    })();

    const post = (message: ParentToSolver) =>
        iframe.contentWindow?.postMessage(message, SOLVER_ORIGIN);

    // 다른 탭에서 문제 페이지를 열어 저장되면 바로 반영합니다.
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        const change = changes[problemKey(problemId)];
        if (area === 'local' && change?.newValue) {
            post({ type: 'problem', problem: change.newValue as ProblemData });
        }
    };
    chrome.storage.onChanged.addListener(onStorage);

    const onMessage = async (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow || event.origin !== SOLVER_ORIGIN) return;
        const message = event.data as SolverToParent;

        if (message.type === 'ready') {
            const [formData, { problem, error }] = await Promise.all([
                formDataPromise,
                problemPromise,
            ]);
            post({ type: 'init', problemId, problem, problemError: error, form: formData });
            return;
        }

        if (message.type === 'restore') {
            showNativeForm();
            return;
        }

        if (message.type === 'submit') {
            const reply = await callMain({
                type: 'submit',
                languageId: message.languageId,
                source: message.source,
                codeOpen: message.codeOpen,
            });
            if (reply.needsVerification) {
                // 코드는 이미 원래 폼에 채워져 있으므로 원래 폼을 보여 주고 인증을 맡깁니다.
                showNativeForm(
                    '코드를 원래 제출 폼에 옮겨 두었습니다. 봇 확인을 완료한 뒤 제출 버튼을 눌러 주세요.'
                );
                return;
            }
            post({ type: 'submit-result', ok: reply.ok, message: reply.message });
        }
    };

    removeListener?.();
    window.addEventListener('message', onMessage);
    removeListener = () => {
        window.removeEventListener('message', onMessage);
        chrome.storage.onChanged.removeListener(onStorage);
    };
};

const waitForForm = async (): Promise<HTMLFormElement | null> => {
    for (let i = 0; i < 40; i++) {
        const form = getForm();
        if (form) return form;
        await new Promise((r) => setTimeout(r, 150));
    }
    return null;
};

void (async () => {
    if (!(await waitForForm())) return;
    showNativeForm();
})();
