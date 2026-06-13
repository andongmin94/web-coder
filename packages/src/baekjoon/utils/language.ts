// 백준 기능에서 재사용하는 계산과 변환 로직을 담은 유틸 파일입니다.
import { CompilerLanguage } from '@/common/types/compile';
import { EditorLanguage, ReferenceLanguage } from '@/common/types/language';

export type SupportedLanguageOption = {
    id: string;
    label: string;
    mime: string;
};

export const SUPPORTED_LANGUAGE_OPTIONS: SupportedLanguageOption[] = [
    { id: '84', label: 'C++17', mime: 'text/x-c++src' },
    { id: '28', label: 'Python 3', mime: 'text/x-python' },
];

export const DEFAULT_LANGUAGE_ID = '84';

const submitApiLanguageConvertMap: Record<string, CompilerLanguage> = {
    // Internal compiler routing keys used by the extension runtime.
    '84': 'cpp17',
    '28': 'python3',
};

const submitApiVersionConvertMap: Record<string, string> = {
    // Reserved for compiler backends that require explicit version fields.
    '84': '2',
    '28': '5',
};

const editorLanguageConvertMap: Record<string, EditorLanguage> = {
    '84': 'cpp',
    '28': 'python',
};

const ReferenceLanguageConvertMap: Record<string, ReferenceLanguage> = {
    '84': 'cpp17',
    '28': 'python',
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

export const filterSupportedLanguageOptions = (
    languageIds: string[]
): SupportedLanguageOption[] => {
    const allowed = new Set(languageIds);
    return SUPPORTED_LANGUAGE_OPTIONS.filter((option) =>
        allowed.has(option.id)
    );
};
