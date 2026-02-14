import { EditorCode, TestCase } from '@/baekjoon/types/problem';
import { DEFAULT_LANGUAGE_ID } from '@/baekjoon/utils/language';
import {
    getObjectFromLocalStorage,
    saveObjectInLocalStorage,
} from '@/common/utils/storage';

const EDITOR_CODE_STORAGE_PREFIX = 'andongmin-web-coder-editor-save-';
const EDITOR_THEME_STORAGE_KEY = 'andongmin-web-coder-editor-theme-';
const EDITOR_DEFAULT_LANGUAGE_KEY = 'andongmin-web-coder-default-language-';
const TEST_CASE_STORAGE_PREFIX = 'andongmin-web-coder-test-case-';

const saveEditorCode = async (
    problemId: string | number,
    languageId: string | number,
    code: string
) => {
    const data: EditorCode = {
        languageId: languageId,
        code: code,
    };
    await saveObjectInLocalStorage({
        [EDITOR_CODE_STORAGE_PREFIX + problemId]: data,
    });
};

const loadEditorCode = async (
    problemId: string | number
): Promise<EditorCode> => {
    const key = EDITOR_CODE_STORAGE_PREFIX + problemId;
    const result = (await getObjectFromLocalStorage(key)) as EditorCode;
    return result;
};

const saveTestCases = async (
    problemId: string | number,
    testCases: TestCase[]
) => {
    await saveObjectInLocalStorage({
        [TEST_CASE_STORAGE_PREFIX + problemId]: testCases,
    });
};

const loadTestCases = async (
    problemId: string | number
): Promise<TestCase[]> => {
    const key = TEST_CASE_STORAGE_PREFIX + problemId;
    const result = (await getObjectFromLocalStorage(key)) as TestCase[];
    return result ? result : [];
};

const saveTheme = async (theme: string) => {
    await saveObjectInLocalStorage({ [EDITOR_THEME_STORAGE_KEY]: theme });
};

const loadTheme = async (): Promise<string> => {
    const result = await getObjectFromLocalStorage(EDITOR_THEME_STORAGE_KEY);
    return result ? result : 'vs-code-dark';
};

const saveDefaultLanguageId = async (languageId: string) => {
    await saveObjectInLocalStorage({
        [EDITOR_DEFAULT_LANGUAGE_KEY]: languageId,
    });
};

const loadDefaultLanguageId = async (): Promise<string> => {
    const result = await getObjectFromLocalStorage(EDITOR_DEFAULT_LANGUAGE_KEY);
    return result ? result : DEFAULT_LANGUAGE_ID;
};

export {
    saveEditorCode,
    loadEditorCode,
    saveTestCases,
    loadTestCases,
    saveTheme,
    loadTheme,
    saveDefaultLanguageId,
    loadDefaultLanguageId,
};
