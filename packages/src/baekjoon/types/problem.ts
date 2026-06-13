// 백준 기능에서 공통으로 사용하는 타입을 모아 둔 파일입니다.
type TestCase = {
    uuid: string;
    input: string;
    output: string;
    result?: string;
    isMultiAnswer?: boolean;
};

type EditorCode = {
    languageId: string | number;
    code: string;
};

export { TestCase, EditorCode };
