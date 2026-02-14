import { CompilerLanguage } from '@/common/types/compile';
import { EditorLanguage, ReferenceLanguage } from '@/common/types/language';

export const DEFAULT_LANGUAGE_ID = '95';

const submitApiLanguageConvertMap: Record<string, CompilerLanguage> = {
    // JDoodle execute API currently exposes cpp17/rust codes (no explicit cpp20/rust2024 code).
    '95': 'cpp17',
    '93': 'java',
    '28': 'python3',
    '116': 'rust',
};

const submitApiVersionConvertMap: Record<string, string> = {
    // Use the latest available versions from JDoodle's official language table.
    '95': '2',
    '93': '3',
    '28': '5',
    '116': '5',
};

const editorLanguageConvertMap: Record<string, EditorLanguage> = {
    '95': 'cpp',
    '93': 'java',
    '28': 'python',
    '116': 'rust',
};

const ReferenceLanguageConvertMap: Record<string, ReferenceLanguage> = {
    '95': 'cpp20',
    '93': 'java11',
    '28': 'python',
    '116': 'rust',
};

export const convertLanguageIdForSubmitApi = (
    languageId: string
): CompilerLanguage => {
    return (
        submitApiLanguageConvertMap[languageId] ??
        submitApiLanguageConvertMap[DEFAULT_LANGUAGE_ID]
    );
};

export const convertLanguageVersionForSubmitApi = (
    languageId: string
): string => {
    return (
        submitApiVersionConvertMap[languageId] ??
        submitApiVersionConvertMap[DEFAULT_LANGUAGE_ID]
    );
};

export const convertLanguageIdForEditor = (
    languageId: string
): EditorLanguage => {
    return (
        editorLanguageConvertMap[languageId] ??
        editorLanguageConvertMap[DEFAULT_LANGUAGE_ID]
    );
};

export const convertLanguageIdForReference = (
    languageId: string
): ReferenceLanguage => {
    return (
        ReferenceLanguageConvertMap[languageId] ??
        ReferenceLanguageConvertMap[DEFAULT_LANGUAGE_ID]
    );
};
