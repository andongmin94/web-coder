import React, { useState, useEffect, useRef } from 'react';
import { ProblemPanel } from '@/baekjoon/presentations/ProblemPanel';
import { EditorPanel } from '@/baekjoon/presentations/EditorPanel';
import { fetchProblemHtml } from '@/baekjoon/apis/problem';
import {
    parsingProblemDetail,
    parsingStyle,
    parsingTestCases,
} from '@/baekjoon/utils/parsing';
import { TestCase } from '@/baekjoon/types/problem';
import TestCasePanel from '@/baekjoon/presentations/TestCasePanel/TestCasePanel';
import EditorButtonBox from '@/baekjoon/presentations/EditorButtonBox/EditorButtonBox';
import { LanguageSelectBox } from '@/baekjoon/components/LanguageSelectBox';
import { CodeOpen, SubmitPostRequest } from '@/baekjoon/types/submit';
import { submit } from '@/baekjoon/apis/submit';
import {
    DEFAULT_LANGUAGE_ID,
    SUPPORTED_LANGUAGE_OPTIONS,
    convertLanguageIdForEditor,
    convertLanguageIdForReference,
    convertLanguageIdForSubmitApi,
    convertLanguageVersionForSubmitApi,
    filterSupportedLanguageOptions,
} from '@/baekjoon/utils/language';
import { CodeCompileRequest } from '@/common/types/compile';
import { CodeOpenSelector } from '@/baekjoon/components/CodeOpenSelector';
import { getDefaultCode } from '@/common/utils/default-code';
import { EditorLanguage, ReferenceLanguage } from '@/common/types/language';
import { Modal } from '@/baekjoon/presentations/Modal';
import { TestCaseModalButtonBox } from '@/baekjoon/presentations/TestCaseModalButtonBox';
import uuid from 'react-uuid';
import { TestCaseContainer } from '@/baekjoon/presentations/TestCaseContainer';
import {
    loadAndParseProblemDetail,
    loadAndParseProblemMathJaxStyle,
} from '@/baekjoon/utils/storage/problem';
import { addUrlSearchParam, refreshUrl } from '@/common/utils/url';
import {
    loadEditorCode,
    loadTestCases,
    saveEditorCode,
    saveTestCases,
    loadDefaultLanguageId,
    saveDefaultLanguageId,
} from '@/baekjoon/utils/storage/editor';
import {
    checkServerError,
    checkCompileError,
    preprocessSourceCode,
} from '@/common/utils/compile';
import { getReferenceUrl } from '@/common/utils/language-reference-url';
import './SolveView.css';
import SolveViewWrapper from '@/common/containers/SolveViewWrapper/SolveViewWrapper';

type SolveViewProps = {
    problemId: string;
    csrfKey: string | null;
    codeOpenDefaultValue: CodeOpen;
    cfTurnstileResponse: string | null;
    isEditMode?: boolean;
    sourceSubmissionId?: string | null;
    initialSourceCode?: string | null;
    initialLanguageId?: string | null;
};

const normalizeSourceCode = (value: string | null | undefined) =>
    (value ?? '').replace(/\r/g, '');

const firstNonEmpty = (values: Array<string | null | undefined>): string => {
    for (const value of values) {
        const normalized = normalizeSourceCode(value);
        if (normalized.trim().length > 0) {
            return normalized;
        }
    }

    return '';
};

const collectUniqueNonEmptyValues = (
    values: Array<string | null | undefined>
): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const normalized = (value ?? '').trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
};

const getSubmitFormAvailableLanguageIds = (): string[] | null => {
    const submitForm = document.querySelector<HTMLFormElement>('#submit_form');
    if (!submitForm) {
        return null;
    }

    const select = submitForm.querySelector<HTMLSelectElement>(
        'select[name=language]'
    );
    if (select) {
        const selectValues = collectUniqueNonEmptyValues(
            Array.from(select.options).map((option) => option.value)
        );
        if (selectValues.length > 0) {
            return selectValues;
        }
    }

    const radioValues = collectUniqueNonEmptyValues(
        Array.from(
            submitForm.querySelectorAll<HTMLInputElement>(
                'input[name=language][type=radio]'
            )
        ).map((input) => input.value)
    );
    if (radioValues.length > 0) {
        return radioValues;
    }

    const hiddenOrPlainValues = collectUniqueNonEmptyValues([
        ...Array.from(
            submitForm.querySelectorAll<HTMLInputElement>(
                'input[name=language][type=hidden]'
            )
        ).map((input) => input.value),
        submitForm.querySelector<HTMLInputElement>(
            'input[name=language]:not([type]), input[name=language][type=text]'
        )?.value,
    ]);

    if (hiddenOrPlainValues.length === 1) {
        return hiddenOrPlainValues;
    }

    return null;
};

const getSubmitFormLanguageId = (): string | null => {
    const submitForm = document.querySelector<HTMLFormElement>('#submit_form');
    if (!submitForm) {
        return null;
    }

    const values = [
        submitForm.querySelector<HTMLSelectElement>('select[name=language]')
            ?.value,
        submitForm.querySelector<HTMLInputElement>(
            'input[name=language]:checked'
        )?.value,
        submitForm.querySelector<HTMLInputElement>('input[name=language]')
            ?.value,
    ];

    for (const value of values) {
        if (value && value.trim().length > 0) {
            return value;
        }
    }

    return null;
};

const dispatchFormChangeEvents = (element: HTMLElement) => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
};

const syncSubmitFormLanguageId = (languageId: string): void => {
    const submitForm = document.querySelector<HTMLFormElement>('#submit_form');
    if (!submitForm) {
        return;
    }

    const select =
        submitForm.querySelector<HTMLSelectElement>('select[name=language]');
    if (select) {
        select.value = languageId;
        dispatchFormChangeEvents(select);
    }

    const radioInputs = Array.from(
        submitForm.querySelectorAll<HTMLInputElement>(
            'input[name=language][type=radio]'
        )
    );
    if (radioInputs.length > 0) {
        for (const input of radioInputs) {
            input.checked = input.value === languageId;
        }
        const checkedInput = radioInputs.find(
            (input) => input.value === languageId
        );
        if (checkedInput) {
            dispatchFormChangeEvents(checkedInput);
        }
    }

    const hiddenInputs = Array.from(
        submitForm.querySelectorAll<HTMLInputElement>(
            'input[name=language][type=hidden]'
        )
    );
    for (const hiddenInput of hiddenInputs) {
        hiddenInput.value = languageId;
        dispatchFormChangeEvents(hiddenInput);
    }

    const plainInput = submitForm.querySelector<HTMLInputElement>(
        'input[name=language]:not([type]), input[name=language][type=text]'
    );
    if (plainInput) {
        plainInput.value = languageId;
        dispatchFormChangeEvents(plainInput);
    }
};

const getSubmitFormSourceCode = (): string | null => {
    const textareas = [
        document.querySelector<HTMLTextAreaElement>(
            '#submit_form textarea[name=source]'
        )?.value,
        document.querySelector<HTMLTextAreaElement>('#submit_form #source')
            ?.value,
        document.querySelector<HTMLTextAreaElement>('textarea[name=source]')
            ?.value,
        document.querySelector<HTMLTextAreaElement>('textarea#source')?.value,
        (
            document.querySelector(
                '#submit_form input[name=source]'
            ) as HTMLInputElement | null
        )?.value,
        (
            document.querySelector(
                'input[name=source]'
            ) as HTMLInputElement | null
        )?.value,
    ];

    const best = firstNonEmpty(textareas);
    return best || null;
};

const fetchSourceCodeBySubmissionId = async (
    submissionId: string
): Promise<string | null> => {
    const parseHtml = (html: string): string => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const candidates = [
            doc.querySelector<HTMLTextAreaElement>('#source')?.value,
            doc.querySelector<HTMLTextAreaElement>('textarea[name="source"]')
                ?.value,
            doc.querySelector<HTMLElement>('#source')?.textContent,
            doc.querySelector<HTMLElement>('pre#source')?.textContent,
            doc.querySelector<HTMLElement>('pre.source')?.textContent,
            doc.querySelector<HTMLElement>('code#source')?.textContent,
            doc.querySelector<HTMLElement>('code.source')?.textContent,
        ];

        return firstNonEmpty(candidates);
    };

    const tryFetch = async (url: string): Promise<string> => {
        const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
        });
        if (!response.ok) {
            return '';
        }

        const text = normalizeSourceCode(await response.text());
        if (text.trim().length === 0) {
            return '';
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!/html/i.test(contentType)) {
            return text;
        }

        return parseHtml(text);
    };

    try {
        const urls = [
            `/source/download/${submissionId}`,
            `/source/${submissionId}`,
            `/source/${submissionId}/download`,
            `/source/${submissionId}?download=1`,
        ];

        for (const url of urls) {
            const source = await tryFetch(url);
            if (source.trim().length > 0) {
                return source;
            }
        }
    } catch {
        return null;
    }

    return null;
};

const SolveView: React.FC<SolveViewProps> = ({
    problemId,
    csrfKey,
    codeOpenDefaultValue,
    cfTurnstileResponse,
    isEditMode = false,
    sourceSubmissionId = null,
    initialSourceCode = null,
    initialLanguageId = null,
}) => {
    const [problemContent, setProblemContent] = useState<JSX.Element | null>(
        null
    );
    const [problemStyle, setProblemStyle] = useState<JSX.Element | null>(null);
    const [testCases, setTestCases] = useState<TestCase[]>([]);
    const [customTestCases, setCustomTestCases] = useState<TestCase[]>([]);
    const [availableLanguageOptions, setAvailableLanguageOptions] = useState(
        SUPPORTED_LANGUAGE_OPTIONS
    );
    const [isLanguageAvailabilityResolved, setIsLanguageAvailabilityResolved] =
        useState(false);
    const [languageId, setLanguageId] = useState<string>(DEFAULT_LANGUAGE_ID);
    const [focusLanguageId, setFocusLanguageId] =
        useState<string>(DEFAULT_LANGUAGE_ID);
    const [editorLanguage, setEditorLanguage] = useState<EditorLanguage>(
        convertLanguageIdForEditor(languageId)
    );
    const [referenceLanguage, setReferenceLanguage] =
        useState<ReferenceLanguage>(convertLanguageIdForReference(languageId));
    const [referenceUrl, setReferenceUrl] = useState<string>(
        getReferenceUrl(referenceLanguage)
    );
    const [codeOpen, setCodeOpen] = useState<CodeOpen>(codeOpenDefaultValue);
    const [code, setCode] = useState(getDefaultCode(editorLanguage));
    const [testCaseModalOpen, setTestCaseModalOpen] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string>('');

    const [testCaseState, setTestCaseState] = useState<
        'initial' | 'running' | 'result' | 'error'
    >('initial');
    const [targetTestCases, setTargetTestCases] = useState<TestCase[]>([]);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
    const [isEditorHydrated, setIsEditorHydrated] = useState<boolean>(false);
    const codeRef = useRef<string>(code);
    const languageIdRef = useRef<string>(languageId);
    const hasManualLanguageSwitchRef = useRef<boolean>(false);
    const saveDebounceTimerRef = useRef<number | null>(null);
    const isEditEntry = isEditMode || Boolean(sourceSubmissionId);
    const editEntryStorageSuffix =
        typeof window !== 'undefined'
            ? `${window.location.pathname}${window.location.search}`
            : '';
    const editorCodeStorageKey = sourceSubmissionId
        ? `submission:${problemId}:${sourceSubmissionId}`
        : isEditEntry
        ? `submission:${problemId}:unknown:${editEntryStorageSuffix}`
        : problemId;

    const complieWaitMs = 3_500;
    const [isCompile, setIsCompile] = useState<boolean>(false);
    const shouldPersistCode = (targetCode: string): boolean => {
        if (!isEditEntry) {
            return true;
        }

        return targetCode.trim().length > 0;
    };

    const resolveSubmittableLanguageIdWithOptions = (
        targetLanguageId: string,
        options: typeof availableLanguageOptions,
        isResolved: boolean
    ): string | null => {
        if (options.length === 0) {
            return isResolved ? null : targetLanguageId;
        }

        if (options.some((option) => option.id === targetLanguageId)) {
            return targetLanguageId;
        }

        return options[0].id;
    };

    const resolveSubmittableLanguageId = (
        targetLanguageId: string
    ): string | null => {
        return resolveSubmittableLanguageIdWithOptions(
            targetLanguageId,
            availableLanguageOptions,
            isLanguageAvailabilityResolved
        );
    };

    const applyLanguageState = (nextLanguageId: string): void => {
        const nextEditorLanguage = convertLanguageIdForEditor(nextLanguageId);
        const nextReferenceLanguage =
            convertLanguageIdForReference(nextLanguageId);

        syncSubmitFormLanguageId(nextLanguageId);
        setLanguageId(nextLanguageId);
        setFocusLanguageId(nextLanguageId);
        setEditorLanguage(nextEditorLanguage);
        setReferenceLanguage(nextReferenceLanguage);
        setReferenceUrl(getReferenceUrl(nextReferenceLanguage));
    };

    const showNoSupportedLanguageNotice =
        isLanguageAvailabilityResolved &&
        availableLanguageOptions.length === 0;

    const codeInitialize = () => {
        setCode(getDefaultCode(editorLanguage));
    };

    const toggleTestCaseModal = () => {
        setTestCaseModalOpen(!testCaseModalOpen);
    };

    const addTestCase = () => {
        if (customTestCases.length >= 10) {
            alert('테스트 케이스는 최대 10개까지 추가할 수 있습니다.');
            return;
        }
        setCustomTestCases([
            ...customTestCases,
            {
                uuid: uuid(),
                input: '',
                output: '',
            },
        ]);
    };

    const deleteTestCase = (uuid: string) => {
        setCustomTestCases([
            ...customTestCases.filter((tc) => tc.uuid !== uuid),
        ]);
    };

    const saveTestCase = () => {
        for (const testCase of customTestCases) {
            if (!testCase.input.trim()) {
                alert('입력은 빈칸일 수 없습니다.');
                return;
            } else if (!testCase.output.trim()) {
                alert('출력은 빈칸일 수 없습니다.');
                return;
            }
        }
        saveTestCases(problemId, customTestCases);
        toggleTestCaseModal();
    };

    useEffect(() => {
        setTargetTestCases([...testCases]);
    }, [testCases]);

    useEffect(() => {
        const updateAvailableLanguages = () => {
            const formLanguageIds = getSubmitFormAvailableLanguageIds();
            if (!formLanguageIds) {
                return;
            }

            const nextOptions = filterSupportedLanguageOptions(formLanguageIds);
            setIsLanguageAvailabilityResolved(true);
            setAvailableLanguageOptions((prevOptions) => {
                if (
                    prevOptions.length === nextOptions.length &&
                    prevOptions.every(
                        (option, index) => option.id === nextOptions[index]?.id
                    )
                ) {
                    return prevOptions;
                }

                return nextOptions;
            });
        };

        updateAvailableLanguages();

        const observerTarget =
            document.querySelector('#submit_form') ?? document.body;
        const observer = new MutationObserver(() => {
            updateAvailableLanguages();
        });
        observer.observe(observerTarget, {
            childList: true,
            subtree: true,
            attributes: true,
        });

        const intervalId = window.setInterval(updateAvailableLanguages, 800);
        const timeoutId = window.setTimeout(() => {
            observer.disconnect();
            window.clearInterval(intervalId);
        }, 60000);

        return () => {
            observer.disconnect();
            window.clearInterval(intervalId);
            window.clearTimeout(timeoutId);
        };
    }, []);

    useEffect(() => {
        const nextLanguageId = resolveSubmittableLanguageId(languageId);
        if (!nextLanguageId || nextLanguageId === languageId) {
            return;
        }

        applyLanguageState(nextLanguageId);
    }, [languageId, availableLanguageOptions, isLanguageAvailabilityResolved]);

    const saveEditorDefaultLanguage = () => {
        const nextLanguageId = resolveSubmittableLanguageId(languageId);
        if (!nextLanguageId) {
            alert(
                '이 문제에서는 확장 프로그램이 지원하는 언어를 사용할 수 없습니다.'
            );
            return;
        }

        saveDefaultLanguageId(nextLanguageId);
        alert('현재 언어를 기본값으로 설정했습니다.');
    };

    const requestRestoreDefaultSubmitForm = () => {
        window.dispatchEvent(
            new CustomEvent('webcoder:restore-native-submit-form')
        );
    };

    const requestCompile = (data: CodeCompileRequest): Promise<string> => {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(
                { action: 'compile', data },
                (output: string) => {
                    if (chrome.runtime.lastError) {
                        resolve(
                            chrome.runtime.lastError.message ??
                                '컴파일 요청에 실패했습니다.'
                        );
                        return;
                    }
                    resolve(typeof output === 'string' ? output : '');
                }
            );
        });
    };

    const codeRun = async () => {
        if (isCompile) return;
        if (!code) {
            alert('실행할 코드가 없습니다.');
            return;
        }

        if (shouldPersistCode(code)) {
            saveEditorCode(editorCodeStorageKey, languageId, code);
        }

        setIsCompile(true);
        setTestCaseState('running');
        setErrorMessage('');

        const language = convertLanguageIdForSubmitApi(languageId);
        const versionIndex = convertLanguageVersionForSubmitApi(languageId);
        const script = preprocessSourceCode(language, code);
        const currentTestCases = [...testCases, ...customTestCases].map(
            (testCase) => ({
                ...testCase,
                result: undefined,
            })
        );
        setTargetTestCases(currentTestCases);

        try {
            const outputs = await Promise.all(
                currentTestCases.map((testCase) => {
                    const data: CodeCompileRequest = {
                        language: language,
                        versionIndex: versionIndex,
                        script: script,
                        stdin: testCase.input,
                    };

                    return requestCompile(data);
                })
            );

            const newTestCases = currentTestCases.map((testCase, index) => ({
                ...testCase,
                result: outputs[index],
            }));
            setTargetTestCases(newTestCases);

            const firstErrorOutput = outputs.find(
                (output) =>
                    checkServerError(output) ||
                    checkCompileError(language, output)
            );
            if (firstErrorOutput) {
                setTestCaseState('error');
                setErrorMessage(firstErrorOutput);
                return;
            }

            setTestCaseState('result');
        } catch (error) {
            setTestCaseState('error');
            setErrorMessage('실행 중 오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            setIsCompile(false);
        }
    };
    const openReferenceUrl = () => {
        window.open(referenceUrl, '_blank');
    };

    const appendHiddenInput = (
        form: HTMLFormElement,
        name: string,
        value: string
    ) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
    };

    const submitWithDetachedForm = (data: SubmitPostRequest): boolean => {
        const originalForm = document.querySelector<HTMLFormElement>(
            '#submit_form'
        );
        if (!originalForm) {
            return false;
        }

        const form = document.createElement('form');
        form.method = 'POST';
        form.acceptCharset = 'UTF-8';
        form.style.display = 'none';
        form.action =
            originalForm.getAttribute('action') || `/submit/${data.problem_id}`;

        const overrideNames = new Set([
            'problem_id',
            'language',
            'code_open',
            'source',
            'csrf_key',
            'cf-turnstile-response',
        ]);

        originalForm
            .querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')
            .forEach((field) => {
                if (!overrideNames.has(field.name)) {
                    appendHiddenInput(form, field.name, field.value);
                }
            });

        appendHiddenInput(form, 'problem_id', data.problem_id);
        appendHiddenInput(form, 'language', String(data.language));
        appendHiddenInput(form, 'code_open', data.code_open);
        appendHiddenInput(form, 'csrf_key', data.csrf_key);
        appendHiddenInput(
            form,
            'cf-turnstile-response',
            data['cf-turnstile-response']
        );

        const sourceField = document.createElement('textarea');
        sourceField.name = 'source';
        sourceField.value = data.source;
        sourceField.style.display = 'none';
        form.appendChild(sourceField);

        document.body.appendChild(form);
        form.submit();
        return true;
    };

    const codeSubmit = async () => {
        if (isSubmitting) return;

        const formLanguageIds = getSubmitFormAvailableLanguageIds();
        const liveAvailableLanguageOptions = formLanguageIds
            ? filterSupportedLanguageOptions(formLanguageIds)
            : availableLanguageOptions;

        if (formLanguageIds) {
            setIsLanguageAvailabilityResolved(true);
            setAvailableLanguageOptions((prevOptions) => {
                if (
                    prevOptions.length === liveAvailableLanguageOptions.length &&
                    prevOptions.every(
                        (option, index) =>
                            option.id === liveAvailableLanguageOptions[index]?.id
                    )
                ) {
                    return prevOptions;
                }

                return liveAvailableLanguageOptions;
            });
        }

        const guardedLanguageId = resolveSubmittableLanguageIdWithOptions(
            languageId,
            liveAvailableLanguageOptions,
            formLanguageIds ? true : isLanguageAvailabilityResolved
        );

        if (!guardedLanguageId) {
            alert(
                '이 문제에서는 확장 프로그램이 지원하는 제출 언어가 없습니다. BOJ 기본 제출 폼을 사용해주세요.'
            );
            return;
        }

        if (guardedLanguageId !== languageId) {
            applyLanguageState(guardedLanguageId);
            alert(
                '현재 선택한 언어로는 제출할 수 없어 제출 가능한 언어로 자동 전환했습니다.'
            );
        }

        setIsSubmitting(true);
        if (shouldPersistCode(code)) {
            await saveEditorCode(editorCodeStorageKey, guardedLanguageId, code);
        }

        const latestCfTurnstileResponse =
            (
                document.querySelector(
                    'input[name=cf-turnstile-response]'
                ) as HTMLInputElement | null
            )?.value ??
            cfTurnstileResponse ??
            '';

        const data: SubmitPostRequest = {
            'cf-turnstile-response': latestCfTurnstileResponse,
            problem_id: problemId,
            language: Number(guardedLanguageId),
            code_open: codeOpen,
            source: code,
            csrf_key: csrfKey ?? '',
        };

        if (submitWithDetachedForm(data)) {
            return;
        }

        submit(
            data,
            (response) => {
                const responseURL = response.request.responseURL;
                if (responseURL) {
                    const redirectURL = addUrlSearchParam(
                        responseURL,
                        'after_andongmin_web_coder_submit',
                        'true'
                    );
                    refreshUrl(redirectURL);
                }
                setIsSubmitting(false);
            },
            (error) => {
                console.error(error);
                const status = error?.response?.status;
                alert(
                    status
                        ? `제출에 실패했습니다. (HTTP ${status})`
                        : '제출에 실패했습니다. 잠시 후 다시 시도해주세요.'
                );
                setIsSubmitting(false);
            }
        );
    };

    const changeLanguage = (nextLanguageId: string) => {
        hasManualLanguageSwitchRef.current = true;

        const guardedLanguageId = resolveSubmittableLanguageId(nextLanguageId);
        if (!guardedLanguageId) {
            alert(
                '이 문제에서는 확장 프로그램이 지원하는 언어를 선택할 수 없습니다.'
            );
            return;
        }

        const nextEditorLanguage = convertLanguageIdForEditor(guardedLanguageId);
        const nextCode = getDefaultCode(nextEditorLanguage);

        applyLanguageState(guardedLanguageId);
        setCode(nextCode);
        if (shouldPersistCode(nextCode)) {
            saveEditorCode(editorCodeStorageKey, guardedLanguageId, nextCode);
        }
    };

    useEffect(() => {
        const loadProblemData = async () => {
            fetchProblemHtml(
                problemId,
                async (html) => {
                    const parsedContent = parsingProblemDetail(html);
                    setProblemContent(parsedContent);
                    const parsedStyle = parsingStyle(html);
                    setProblemStyle(parsedStyle);
                    const parsedTestCases = parsingTestCases(html);
                    setTestCases(parsedTestCases);
                },
                async (error) => {
                    console.error('문제를 불러오는데 실패했습니다.', error);
                    const loadedProblemContent = await loadAndParseProblemDetail(
                        problemId
                    );
                    const loadedProblemStyle =
                        await loadAndParseProblemMathJaxStyle(problemId);
                    if (loadedProblemContent) {
                        setProblemContent(loadedProblemContent);
                        setProblemStyle(loadedProblemStyle);
                        const parsedTestCases = parsingTestCases(
                            loadedProblemContent.props.dangerouslySetInnerHTML
                                .__html
                        );
                        setTestCases(parsedTestCases);
                        return;
                    }

                    setProblemContent(<h1>문제를 불러오는데 실패했습니다.</h1>);
                }
            );
        };

        loadProblemData();
    }, [problemId]);

    const languageChangeHandle = (
        event: React.ChangeEvent<HTMLSelectElement>
    ) => {
        if (!problemId) return;
        if (
            confirm(
                '언어를 변경하면 작성 중인 코드가 초기화됩니다.\n변경하시겠습니까?'
            )
        ) {
            changeLanguage(event.target.value);
        } else {
            setLanguageId(focusLanguageId);
            const editorLanguage = convertLanguageIdForEditor(focusLanguageId);
            setEditorLanguage(editorLanguage);
        }
    };

    useEffect(() => {
        const editorLanguage = convertLanguageIdForEditor(languageId);
        setEditorLanguage(editorLanguage);
    }, [languageId]);

    useEffect(() => {
        let cancelled = false;
        setIsEditorHydrated(false);

        const hydrateEditorState = async () => {
            try {
                const savedCustomTestCases = await loadTestCases(problemId);
                if (cancelled) return;

                if (isEditEntry) {
                    const savedEditorCode = await loadEditorCode(
                        editorCodeStorageKey
                    );
                    if (cancelled) return;

                    const sourceCodeCandidate = normalizeSourceCode(
                        initialSourceCode
                    );
                    const sourceCodeFromStorage =
                        typeof savedEditorCode?.code === 'string'
                            ? savedEditorCode.code
                            : '';
                    const sourceLanguageId =
                        (initialLanguageId
                            ? String(initialLanguageId).trim()
                            : '') ||
                        (sourceCodeFromStorage.trim().length > 0 &&
                        savedEditorCode?.languageId
                            ? String(savedEditorCode.languageId).trim()
                            : '') ||
                        DEFAULT_LANGUAGE_ID;
                    const sourceEditorLanguage =
                        convertLanguageIdForEditor(sourceLanguageId);
                    const sourceReferenceLanguage =
                        convertLanguageIdForReference(sourceLanguageId);
                    const hydratedSourceCode =
                        sourceCodeCandidate.trim().length > 0
                            ? sourceCodeCandidate
                            : sourceCodeFromStorage.trim().length > 0
                            ? sourceCodeFromStorage
                            : '';

                    setLanguageId(sourceLanguageId);
                    setEditorLanguage(sourceEditorLanguage);
                    setReferenceLanguage(sourceReferenceLanguage);
                    setReferenceUrl(getReferenceUrl(sourceReferenceLanguage));
                    setCode(hydratedSourceCode);
                    syncSubmitFormLanguageId(sourceLanguageId);
                    if (hydratedSourceCode.trim().length > 0) {
                        await saveEditorCode(
                            editorCodeStorageKey,
                            sourceLanguageId,
                            hydratedSourceCode
                        );
                    }
                } else {
                    const defaultLanguageId = await loadDefaultLanguageId();
                    if (cancelled) return;
                    const defaultEditorLanguage =
                        convertLanguageIdForEditor(defaultLanguageId);
                    const defaultReferenceLanguage =
                        convertLanguageIdForReference(defaultLanguageId);
                    const defaultCode = getDefaultCode(defaultEditorLanguage);

                    setLanguageId(defaultLanguageId);
                    setEditorLanguage(defaultEditorLanguage);
                    setReferenceLanguage(defaultReferenceLanguage);
                    setReferenceUrl(getReferenceUrl(defaultReferenceLanguage));
                    setCode(defaultCode);
                    syncSubmitFormLanguageId(defaultLanguageId);
                }

                setCustomTestCases(savedCustomTestCases ?? []);
            } finally {
                if (!cancelled) {
                    setIsEditorHydrated(true);
                }
            }
        };

        void hydrateEditorState();

        return () => {
            cancelled = true;
            if (saveDebounceTimerRef.current !== null) {
                window.clearTimeout(saveDebounceTimerRef.current);
                saveDebounceTimerRef.current = null;
            }
        };
    }, [
        problemId,
        sourceSubmissionId,
        initialSourceCode,
        initialLanguageId,
        isEditEntry,
        editorCodeStorageKey,
        isEditMode,
    ]);

    useEffect(() => {
        if (!isEditEntry || !isEditorHydrated) {
            return;
        }

        let cancelled = false;
        let isApplying = false;

        const applyLateSubmitFormSource = async (): Promise<boolean> => {
            if (cancelled || isApplying) {
                return false;
            }
            if (hasManualLanguageSwitchRef.current) {
                return false;
            }

            const currentCode = codeRef.current;
            const currentDefaultCode = getDefaultCode(
                convertLanguageIdForEditor(languageIdRef.current)
            );
            const isCurrentFallbackCode = currentCode === currentDefaultCode;
            if (currentCode.trim().length > 0 && !isCurrentFallbackCode) {
                return false;
            }

            const formSourceCode = normalizeSourceCode(getSubmitFormSourceCode());
            if (formSourceCode.trim().length === 0) {
                return false;
            }

            isApplying = true;
            try {
                const formLanguageId =
                    getSubmitFormLanguageId() ?? languageIdRef.current;
                const nextEditorLanguage =
                    convertLanguageIdForEditor(formLanguageId);
                const nextReferenceLanguage =
                    convertLanguageIdForReference(formLanguageId);

                languageIdRef.current = formLanguageId;
                codeRef.current = formSourceCode;
                setLanguageId(formLanguageId);
                setEditorLanguage(nextEditorLanguage);
                setReferenceLanguage(nextReferenceLanguage);
                setReferenceUrl(getReferenceUrl(nextReferenceLanguage));
                setCode(formSourceCode);
                await saveEditorCode(
                    editorCodeStorageKey,
                    formLanguageId,
                    formSourceCode
                );
                return true;
            } finally {
                isApplying = false;
            }
        };

        void applyLateSubmitFormSource();

        const observerTarget =
            document.querySelector('#submit_form') ?? document.body;
        const observer = new MutationObserver(() => {
            void applyLateSubmitFormSource();
        });
        observer.observe(observerTarget, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
        });

        const intervalId = window.setInterval(() => {
            void applyLateSubmitFormSource();
        }, 800);
        const timeoutId = window.setTimeout(() => {
            observer.disconnect();
            window.clearInterval(intervalId);
        }, 60000);

        return () => {
            cancelled = true;
            observer.disconnect();
            window.clearInterval(intervalId);
            window.clearTimeout(timeoutId);
        };
    }, [isEditEntry, isEditorHydrated, editorCodeStorageKey]);

    useEffect(() => {
        if (!isEditEntry || !isEditorHydrated || !sourceSubmissionId) {
            return;
        }

        let cancelled = false;

        const applyFetchedSubmissionSource = async (
            sourceCode: string
        ): Promise<boolean> => {
            if (cancelled) {
                return false;
            }
            if (hasManualLanguageSwitchRef.current) {
                return false;
            }

            const normalizedSourceCode = normalizeSourceCode(sourceCode);
            if (normalizedSourceCode.trim().length === 0) {
                return false;
            }

            const currentCode = codeRef.current;
            const currentDefaultCode = getDefaultCode(
                convertLanguageIdForEditor(languageIdRef.current)
            );
            const isCurrentFallbackCode = currentCode === currentDefaultCode;
            if (currentCode.trim().length > 0 && !isCurrentFallbackCode) {
                return false;
            }

            const nextLanguageId =
                getSubmitFormLanguageId() ?? languageIdRef.current;
            const nextEditorLanguage =
                convertLanguageIdForEditor(nextLanguageId);
            const nextReferenceLanguage =
                convertLanguageIdForReference(nextLanguageId);

            languageIdRef.current = nextLanguageId;
            codeRef.current = normalizedSourceCode;
            setLanguageId(nextLanguageId);
            setEditorLanguage(nextEditorLanguage);
            setReferenceLanguage(nextReferenceLanguage);
            setReferenceUrl(getReferenceUrl(nextReferenceLanguage));
            setCode(normalizedSourceCode);
            await saveEditorCode(
                editorCodeStorageKey,
                nextLanguageId,
                normalizedSourceCode
            );

            return true;
        };

        const runFetchRetry = async () => {
            const startedAt = Date.now();
            let delayMs = 500;
            const timeoutMs = 120000;

            while (!cancelled && Date.now() - startedAt < timeoutMs) {
                const sourceCode = await fetchSourceCodeBySubmissionId(
                    sourceSubmissionId
                );
                if (sourceCode) {
                    const applied =
                        await applyFetchedSubmissionSource(sourceCode);
                    if (applied) {
                        return;
                    }
                }

                await new Promise((resolve) => {
                    window.setTimeout(resolve, delayMs);
                });
                delayMs = Math.min(delayMs * 2, 5000);
            }
        };

        void runFetchRetry();

        return () => {
            cancelled = true;
        };
    }, [isEditEntry, isEditorHydrated, sourceSubmissionId, editorCodeStorageKey]);

    const languageFocusHandle = () => {
        setFocusLanguageId(languageId);
    };

    useEffect(() => {
        codeRef.current = code;
    }, [code]);

    useEffect(() => {
        languageIdRef.current = languageId;
    }, [languageId]);

    useEffect(() => {
        if (!isEditorHydrated) return;

        if (saveDebounceTimerRef.current !== null) {
            window.clearTimeout(saveDebounceTimerRef.current);
        }

        saveDebounceTimerRef.current = window.setTimeout(() => {
            if (shouldPersistCode(code)) {
                saveEditorCode(editorCodeStorageKey, languageId, code);
            }
            saveDebounceTimerRef.current = null;
        }, 500);

        return () => {
            if (saveDebounceTimerRef.current !== null) {
                window.clearTimeout(saveDebounceTimerRef.current);
                saveDebounceTimerRef.current = null;
            }
        };
    }, [editorCodeStorageKey, languageId, code, isEditorHydrated]);

    useEffect(() => {
        const tick = () => {
            if (shouldPersistCode(codeRef.current)) {
                saveEditorCode(
                    editorCodeStorageKey,
                    languageIdRef.current,
                    codeRef.current
                );
            }
        };

        const timerId = setInterval(tick, 60000);
        return () => clearInterval(timerId);
    }, [editorCodeStorageKey]);

    useEffect(() => {
        const handleData = () => {
            if (shouldPersistCode(codeRef.current)) {
                saveEditorCode(
                    editorCodeStorageKey,
                    languageIdRef.current,
                    codeRef.current
                );
            }
        };

        window.addEventListener('beforeunload', handleData);

        return () => {
            window.removeEventListener('beforeunload', handleData);
        };
    }, [editorCodeStorageKey]);

    return (
        <div id='andongmin-web-coder-wrapper' className='boj'>
            <SolveViewWrapper
                height={'95vh'}
                problemDescriptionPanel={
                    <ProblemPanel
                        content={problemContent}
                        mathJaxStyle={problemStyle}
                    />
                }
                solveEditorPanelTop={
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            justifyContent: 'space-between',
                        }}
                    >
                        <CodeOpenSelector
                            defaultValue={codeOpen}
                            onChange={setCodeOpen}
                        />
                        {showNoSupportedLanguageNotice ? (
                            <div
                                onClick={requestRestoreDefaultSubmitForm}
                                onKeyDown={(event) => {
                                    if (
                                        event.key === 'Enter' ||
                                        event.key === ' '
                                    ) {
                                        event.preventDefault();
                                        requestRestoreDefaultSubmitForm();
                                    }
                                }}
                                role='button'
                                tabIndex={0}
                                style={{
                                    marginRight: '10px',
                                    padding: '6px 10px',
                                    border: '1px solid #f0d3a8',
                                    borderRadius: '8px',
                                    background: '#fff8ec',
                                    color: '#8a5a00',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }}
                            >
                                이 문제에서는 지원되는 제출 언어가 없습니다. 기본
                                BOJ 제출 폼을 사용해주세요. (클릭해서 전환)
                            </div>
                        ) : (
                            <LanguageSelectBox
                                value={languageId}
                                options={availableLanguageOptions}
                                onChange={languageChangeHandle}
                                onFocus={languageFocusHandle}
                                onChangeDefaultLanguage={
                                    saveEditorDefaultLanguage
                                }
                            />
                        )}
                    </div>
                }
                solveEditorPanel={
                    <EditorPanel
                        language={editorLanguage}
                        code={code}
                        onCodeUpdate={setCode}
                    />
                }
                testCasePanel={
                    <TestCasePanel
                        testCases={targetTestCases}
                        state={
                            testCaseState == 'initial'
                                ? 'initial'
                                : testCaseState == 'error'
                                ? 'error'
                                : 'run'
                        }
                        errorMessage={errorMessage}
                    />
                }
                testCasePanelStyle={{
                    border: '1px solid #ccc',
                    background: '#efefef',
                }}
                footer={
                    <EditorButtonBox
                        codeInitializeHandle={() => {
                            if (confirm('정말로 초기화하시겠습니까?')) {
                                codeInitialize();
                            }
                        }}
                        addTestCaseHandle={toggleTestCaseModal}
                        runHandle={codeRun}
                        submitHandle={codeSubmit}
                        openReferenceUrl={openReferenceUrl}
                        isRunning={isCompile}
                        isSubmitting={isSubmitting}
                        complieWaitMs={complieWaitMs}
                    />
                }
            />

            {/* 테스트 케이스 추가 모달 */}
            <Modal
                width={'80vw'}
                height={600}
                title={<h1>테스트 케이스 추가</h1>}
                content={
                    <TestCaseContainer
                        testCases={testCases}
                        customTestCases={customTestCases}
                        onDeleteCustomTestCase={deleteTestCase}
                    />
                }
                footer={
                    <TestCaseModalButtonBox
                        addTestCaseHandle={addTestCase}
                        saveTestCaseHandle={saveTestCase}
                    />
                }
                modalOpen={testCaseModalOpen}
                onClose={toggleTestCaseModal}
            />
        </div>
    );
};

export default SolveView;
