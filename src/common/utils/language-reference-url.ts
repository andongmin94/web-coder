import { ReferenceLanguage } from '@/common/types/language';

const referenceUrl: Record<ReferenceLanguage, string> = {
    cpp17: 'https://en.cppreference.com/w/cpp/17',
    cpp20: 'https://en.cppreference.com/w/cpp/20',
    java11: 'https://docs.oracle.com/javase/11/docs/api/index.html',
    python: 'https://docs.python.org/3/index.html',
    rust: 'https://doc.rust-lang.org/std/',
};

export const getReferenceUrl = (language: ReferenceLanguage): string => {
    return referenceUrl[language];
};
