// BOJ 페이지의 MAIN world에서 실행됩니다.
// 페이지의 CodeMirror 인스턴스/jQuery는 격리 world에서 보이지 않으므로 여기서 다룹니다.
import {
    MAIN_REPLY_EVENT,
    MAIN_REQUEST_EVENT,
    type MainReply,
    type MainRequest,
} from '../shared/protocol.ts';

type CodeMirrorHost = HTMLElement & {
    CodeMirror?: { getValue(): string; setValue(v: string): void; save?(): void };
};
type JQueryLike = (el: Element) => { val(v: string): unknown; trigger(name: string): unknown };

const form = () => document.querySelector<HTMLFormElement>('#submit_form');
const codeMirror = () => form()?.querySelector<CodeMirrorHost>('.CodeMirror')?.CodeMirror ?? null;
const sourceArea = () =>
    form()?.querySelector<HTMLTextAreaElement>('textarea[name="source"]') ?? null;

const readSource = (): string => codeMirror()?.getValue() ?? sourceArea()?.value ?? '';

const setLanguage = (languageId: string) => {
    const select = form()?.querySelector<HTMLSelectElement>('select[name="language"]');
    if (select) {
        select.value = languageId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const $ = (window as unknown as { jQuery?: JQueryLike }).jQuery;
        if ($) {
            const wrapped = $(select);
            wrapped.val(languageId);
            wrapped.trigger('chosen:updated');
        }
        return select.value === languageId;
    }
    const radio = form()?.querySelector<HTMLInputElement>(
        `input[name="language"][value="${CSS.escape(languageId)}"]`
    );
    if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }
    return false;
};

const setCodeOpen = (value: string | null) => {
    if (!value) return;
    const radio = document.querySelector<HTMLInputElement>(
        `input[name="code_open"][value="${CSS.escape(value)}"]`
    );
    if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
};

const setSource = (source: string) => {
    const cm = codeMirror();
    if (cm) cm.setValue(source);
    const area = sourceArea();
    if (area) area.value = source;
};

const submit = (req: Extract<MainRequest, { type: 'submit' }>): MainReply => {
    const f = form();
    if (!f) return { id: req.id, ok: false, message: '제출 폼을 찾지 못했습니다.' };

    if (!setLanguage(req.languageId)) {
        return { id: req.id, ok: false, message: '제출 폼에서 이 언어를 선택할 수 없습니다.' };
    }
    setCodeOpen(req.codeOpen);
    setSource(req.source);

    // Cloudflare Turnstile 토큰이 아직 없으면 사용자가 원래 폼에서 인증해야 합니다.
    const turnstile = document.querySelector<HTMLInputElement>(
        'input[name="cf-turnstile-response"]'
    );
    if (turnstile && !turnstile.value) {
        return {
            id: req.id,
            ok: false,
            needsVerification: true,
            message: '봇 확인을 완료한 뒤 제출해 주세요.',
        };
    }

    const button = f.querySelector<HTMLElement>(
        '#submit_button, button[type="submit"], input[type="submit"]'
    );
    if (button) button.click();
    else f.requestSubmit();
    return { id: req.id, ok: true };
};

window.addEventListener(MAIN_REQUEST_EVENT, (event) => {
    let req: MainRequest;
    try {
        req = JSON.parse(String((event as CustomEvent).detail)) as MainRequest;
    } catch {
        return;
    }
    let reply: MainReply;
    try {
        reply =
            req.type === 'read-source'
                ? { id: req.id, ok: true, source: readSource() }
                : submit(req);
    } catch (error) {
        reply = {
            id: req.id,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
        };
    }
    window.dispatchEvent(new CustomEvent(MAIN_REPLY_EVENT, { detail: JSON.stringify(reply) }));
});
