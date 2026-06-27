// 공통으로 재사용하는 실행 로직과 도우미 함수를 담은 유틸 파일입니다.
import { ReferenceLanguage } from '@/common/types/language';

const referenceUrl: Record<ReferenceLanguage, string> = {
    cpp17: 'https://en.cppreference.com/w/cpp/17',
    python: 'https://docs.python.org/3/index.html',
};

export const getReferenceUrl = (language: ReferenceLanguage): string => {
    return referenceUrl[language];
};
