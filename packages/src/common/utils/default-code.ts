// 공통으로 재사용하는 실행 로직과 도우미 함수를 담은 유틸 파일입니다.
import { EditorLanguage } from '@/common/types/language';

const DEFAULT_CPP_CODE = `#include <bits/stdc++.h>

using namespace std;

int main()
{
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    
}
`;

const DEFAULT_PYTHON_CODE = ``;

const defaultCode: Record<EditorLanguage, string> = {
    cpp: DEFAULT_CPP_CODE,
    python: DEFAULT_PYTHON_CODE,
};

const getDefaultCode = (language: EditorLanguage): string => {
    return defaultCode[language];
};

export { getDefaultCode };
