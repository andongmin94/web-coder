import { CompilerLanguage } from '@/common/types/compile';
import { EditorLanguage, ReferenceLanguage } from '@/common/types/language';

export const DEFAULT_LANGUAGE_ID = '95';

const submitApiLanguageConvertMap: Record<string, CompilerLanguage> = {
    // Internal compiler routing keys used by the extension runtime.
    '84': 'cpp17',
    '95': 'cpp20',
    '93': 'java',
    '28': 'python3',
    '116': 'rust',
};

const submitApiVersionConvertMap: Record<string, string> = {
    // Reserved for compiler backends that require explicit version fields.
    '84': '2',
    '95': '2',
    '93': '3',
    '28': '5',
    '116': '5',
};

const editorLanguageConvertMap: Record<string, EditorLanguage> = {
    '84': 'cpp',
    '95': 'cpp',
    '93': 'java',
    '28': 'python',
    '116': 'rust',
};

const ReferenceLanguageConvertMap: Record<string, ReferenceLanguage> = {
    '84': 'cpp17',
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
