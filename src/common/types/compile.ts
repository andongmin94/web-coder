// 공통으로 사용하는 타입 선언을 모아 둔 파일입니다.
type CodeCompileRequest = {
    language: CompilerLanguage;
    script: string;
    versionIndex: string;
    stdin?: string | null;
    compileOnly?: boolean;
};

type CompilerLanguage = 'cpp17' | 'python3';

export type { CodeCompileRequest, CompilerLanguage };
