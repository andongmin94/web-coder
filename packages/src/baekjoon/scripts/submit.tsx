import 'prism-code-editor/prism/languages/cpp';
import 'prism-code-editor/prism/languages/java';
import 'prism-code-editor/prism/languages/python';
import 'prism-code-editor/prism/languages/rust';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { getProblemId } from '@/baekjoon/utils/parsing';
import SolveView from '@/baekjoon/containers/SolveView/SolveView';
import { CodeOpen } from '@/baekjoon/types/submit';
import './submit.css';

const RESTORE_NATIVE_SUBMIT_FORM_EVENT = 'webcoder:restore-native-submit-form';

const toNumericString = (
    value: string | null | undefined
): string | null => {
    if (!value) {
        return null;
    }

    const match = value.match(/\d+/);
    return match ? match[0] : null;
};

const normalizeCode = (value: string | null | undefined): string =>
    (value ?? '').replace(/\r/g, '');

const getSourceSubmissionId = (): string | null => {
    const pathMatch = window.location.pathname.match(/\/submit\/\d+\/(\d+)/);
    if (pathMatch) {
        return pathMatch[1];
    }

    const params = new URLSearchParams(window.location.search);
    const candidates = [
        params.get('source'),
        params.get('source_id'),
        params.get('submission_id'),
        params.get('submissionId'),
    ];
    for (const value of candidates) {
        const numericValue = toNumericString(value);
        if (numericValue) {
            return numericValue;
        }
    }

    const formCandidates = [
        'source',
        'source_id',
        'submission_id',
        'submissionId',
    ];
    for (const name of formCandidates) {
        const value = (
            document.querySelector(
                `#submit_form input[name="${name}"]`
            ) as HTMLInputElement | null
        )?.value;
        const numericValue = toNumericString(value);
        if (numericValue) {
            return numericValue;
        }
    }

    const sourceLink = document.querySelector<HTMLAnchorElement>(
        'a[href*="/source/"]'
    )?.href;
    const linkMatch = sourceLink?.match(/\/source\/(\d+)/);
    if (linkMatch) {
        return linkMatch[1];
    }

    return null;
};

const getEditEntryContext = (): {
    sourceSubmissionId: string | null;
    isEditMode: boolean;
} => {
    const sourceSubmissionId = getSourceSubmissionId();
    const isEditPath = /\/submit\/\d+\/\d+/.test(window.location.pathname);
    const params = new URLSearchParams(window.location.search);
    const editQueryKeys = [
        'source',
        'source_id',
        'submission_id',
        'submissionId',
    ];
    const hasEditQuery = editQueryKeys.some((key) =>
        Boolean(toNumericString(params.get(key)))
    );

    return {
        sourceSubmissionId,
        isEditMode: Boolean(sourceSubmissionId) || isEditPath || hasEditQuery,
    };
};

const getSubmitFormLanguageId = (): string | null => {
    const languageSelect = document.querySelector(
        '#submit_form select[name=language]'
    ) as HTMLSelectElement | null;
    if (languageSelect?.value) {
        return languageSelect.value;
    }

    const languageRadio = document.querySelector(
        '#submit_form input[name=language]:checked'
    ) as HTMLInputElement | null;
    if (languageRadio?.value) {
        return languageRadio.value;
    }

    const languageInput = document.querySelector(
        '#submit_form input[name=language]'
    ) as HTMLInputElement | null;
    return languageInput?.value ?? null;
};

const getSubmitFormSourceCode = (): string | null => {
    return (
        document.querySelector<HTMLTextAreaElement>(
            '#submit_form textarea[name=source]'
        )?.value ?? null
    );
};

const waitForSubmitFormMutationOrDelay = (delayMs: number): Promise<void> => {
    return new Promise((resolve) => {
        const target = document.querySelector('#submit_form') ?? document.body;
        let done = false;
        let timerId = 0;

        const cleanupAndResolve = () => {
            if (done) {
                return;
            }
            done = true;
            observer.disconnect();
            window.clearTimeout(timerId);
            resolve();
        };

        const observer = new MutationObserver(() => {
            cleanupAndResolve();
        });

        try {
            observer.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
            });
        } catch {
            resolve();
            return;
        }

        timerId = window.setTimeout(() => {
            cleanupAndResolve();
        }, delayMs);
    });
};

const fetchSourceCodeBySubmissionId = async (
    submissionId: string
): Promise<string | null> => {
    const parseSourceCodeFromHtml = (html: string): string | null => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const selectors = [
            '#source',
            'textarea#source',
            'textarea[name="source"]',
            '#submit_form textarea[name="source"]',
            'pre#source',
            'pre.source',
            'code#source',
            'code.source',
        ];

        for (const selector of selectors) {
            const element = doc.querySelector(selector) as
                | HTMLTextAreaElement
                | HTMLElement
                | null;
            if (!element) continue;

            const text =
                element instanceof HTMLTextAreaElement
                    ? element.value
                    : element.textContent ?? '';
            const normalized = normalizeCode(text);
            if (normalized.trim().length > 0) {
                return normalized;
            }
        }

        return null;
    };

    const tryFetch = async (url: string): Promise<string | null> => {
        const response = await fetch(url, {
            credentials: 'include',
        });
        if (!response.ok) {
            return null;
        }

        const text = await response.text();
        if (!text) {
            return null;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!/html/i.test(contentType)) {
            const normalized = normalizeCode(text);
            return normalized.trim().length > 0 ? normalized : null;
        }

        return parseSourceCodeFromHtml(text);
    };

    try {
        const candidates = [
            `/source/${submissionId}`,
            `/source/download/${submissionId}`,
            `/source/${submissionId}/download`,
            `/source/${submissionId}?download=1`,
        ];
        for (const url of candidates) {
            const sourceCode = await tryFetch(url);
            if (sourceCode) {
                return sourceCode;
            }
        }
        return null;
    } catch {
        return null;
    }
};

const resolveEditEntrySource = async ({
    sourceSubmissionId,
    initialSourceCode,
    initialLanguageId,
    timeoutMs = 30000,
}: {
    sourceSubmissionId: string | null;
    initialSourceCode: string | null;
    initialLanguageId: string | null;
    timeoutMs?: number;
}): Promise<{ sourceCode: string | null; languageId: string | null }> => {
    let sourceCode = normalizeCode(initialSourceCode);
    let languageId = initialLanguageId ?? getSubmitFormLanguageId();

    if (sourceCode.trim().length > 0) {
        return { sourceCode, languageId };
    }

    const startedAt = Date.now();
    let fetchBackoffMs = 400;
    let nextFetchAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const formSource = normalizeCode(getSubmitFormSourceCode());
        const formLanguageId = getSubmitFormLanguageId();

        if (formLanguageId) {
            languageId = formLanguageId;
        }

        if (formSource.trim().length > 0) {
            return { sourceCode: formSource, languageId };
        }

        if (sourceSubmissionId && Date.now() >= nextFetchAt) {
            const fetchedSourceCode = await fetchSourceCodeBySubmissionId(
                sourceSubmissionId
            );
            if (fetchedSourceCode && fetchedSourceCode.trim().length > 0) {
                return {
                    sourceCode: normalizeCode(fetchedSourceCode),
                    languageId,
                };
            }

            nextFetchAt = Date.now() + fetchBackoffMs;
            fetchBackoffMs = Math.min(fetchBackoffMs * 2, 5000);
        }

        await waitForSubmitFormMutationOrDelay(300);
    }

    const finalSourceCode = normalizeCode(getSubmitFormSourceCode());
    const finalLanguageId = getSubmitFormLanguageId() ?? languageId;

    return {
        sourceCode: finalSourceCode.trim().length > 0 ? finalSourceCode : null,
        languageId: finalLanguageId ?? null,
    };
};

const customSubmitPage = () => {
    let solveRoot: Root | null = null;
    let solveRootElement: HTMLElement | null = null;

    const restoreNativeSubmitForm = () => {
        if (solveRoot) {
            solveRoot.unmount();
            solveRoot = null;
        }

        if (solveRootElement) {
            solveRootElement.remove();
            solveRootElement = null;
        } else {
            document.querySelector('#webcoder-solve-root')?.remove();
        }

        const submitForm = document.querySelector(
            '#submit_form'
        ) as HTMLFormElement | null;
        if (submitForm) {
            submitForm.classList.remove('webcoder-hidden-submit-form');
        }

        const problemMenu = document.querySelector(
            'ul.problem-menu'
        ) as HTMLElement | null;
        const contentContainer = document.querySelector(
            '.container.content'
        ) as HTMLElement | null;
        if (problemMenu) {
            problemMenu.style.marginBottom = '';
        }
        if (contentContainer) {
            contentContainer.style.width = '';
        }
    };

    const waitForSubmitForm = async (
        maxRetries = 40,
        intervalMs = 150
    ): Promise<void> => {
        return new Promise((resolve) => {
            let retries = 0;

            const check = () => {
                const submitForm = document.querySelector('#submit_form');
                if (submitForm) {
                    resolve();
                    return;
                }

                if (retries >= maxRetries) {
                    resolve();
                    return;
                }

                retries += 1;
                setTimeout(check, intervalMs);
            };

            check();
        });
    };

    const addSplitView = async () => {
        const rootElement = document.createElement('div');
        rootElement.id = 'webcoder-solve-root';
        const problemId = getProblemId();
        const submitForm = document.querySelector(
            '#submit_form'
        ) as HTMLFormElement | null;
        const problemMenu = document.querySelector(
            'ul.problem-menu'
        ) as HTMLElement | null;
        const contentContainer = document.querySelector(
            '.container.content'
        ) as HTMLElement | null;

        if (problemId) {
            document.title = `${problemId} - Solve`;
        }

        const csrfKey =
            (
                document.querySelector(
                    '#submit_form input[name=csrf_key]'
                ) as HTMLInputElement | null
            )?.value ?? null;
        const cfTurnstileResponse =
            (
                document.querySelector(
                    'input[name=cf-turnstile-response]'
                ) as HTMLInputElement | null
            )?.value ?? null;
        const { sourceSubmissionId, isEditMode } = getEditEntryContext();
        let initialSourceCode = getSubmitFormSourceCode();
        let initialLanguageId = getSubmitFormLanguageId();
        if (isEditMode) {
            const resolved = await resolveEditEntrySource({
                sourceSubmissionId,
                initialSourceCode,
                initialLanguageId,
            });
            initialSourceCode = resolved.sourceCode ?? initialSourceCode;
            initialLanguageId = resolved.languageId ?? initialLanguageId;
        }

        let codeOpen: CodeOpen = 'close';
        const codeOpenRadios = document.querySelectorAll(
            'input[name=code_open]'
        );
        for (const codeOpenRadio of codeOpenRadios) {
            const inputElement = codeOpenRadio as HTMLInputElement;
            if (inputElement.checked) {
                codeOpen = inputElement.value as CodeOpen;
                break;
            }
        }

        if (problemId) {
            solveRoot = createRoot(rootElement);
            solveRoot.render(
                <SolveView
                    problemId={problemId}
                    csrfKey={csrfKey}
                    cfTurnstileResponse={cfTurnstileResponse}
                    codeOpenDefaultValue={codeOpen}
                    isEditMode={isEditMode}
                    sourceSubmissionId={sourceSubmissionId}
                    initialSourceCode={initialSourceCode}
                    initialLanguageId={initialLanguageId}
                />
            );
        }

        if (problemMenu && contentContainer) {
            problemMenu.style.marginBottom = '0';
            contentContainer.style.width = '100%';

            const previousRoot = contentContainer.querySelector(
                '#webcoder-solve-root'
            );
            if (previousRoot) {
                previousRoot.replaceWith(rootElement);
            } else {
                problemMenu.insertAdjacentElement('afterend', rootElement);
            }
            solveRootElement = rootElement;

            // Keep original form in place and just hide it.
            if (submitForm) {
                submitForm.classList.add('webcoder-hidden-submit-form');
            }
        }
    };

    const renderSubmitSplitView = async () => {
        const submitForm = document.querySelector(
            '#submit_form'
        ) as HTMLFormElement | null;
        if (submitForm) {
            submitForm.classList.add('webcoder-hidden-submit-form');
        }

        await addSplitView();
    };

    let initialized = false;
    const init = async () => {
        if (initialized) {
            return;
        }
        initialized = true;

        await waitForSubmitForm();
        await renderSubmitSplitView();
    };

    window.addEventListener(RESTORE_NATIVE_SUBMIT_FORM_EVENT, () => {
        restoreNativeSubmitForm();
    });

    if (document.readyState === 'complete') {
        void init();
        return;
    }

    window.addEventListener('load', () => void init(), { once: true });
};

export default customSubmitPage;
