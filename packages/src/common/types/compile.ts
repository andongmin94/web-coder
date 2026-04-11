type CodeCompileRequest = {
    language: CompilerLanguage;
    script: string;
    versionIndex: string;
    stdin?: string | null;
    compileOnly?: boolean;
};

type CompilerLanguage = 'cpp17' | 'java' | 'python3' | 'rust';

export type { CodeCompileRequest, CompilerLanguage };
