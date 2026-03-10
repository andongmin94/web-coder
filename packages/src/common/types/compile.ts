type CodeCompileRequest = {
    language: CompilerLanguage;
    script: string;
    versionIndex: string;
    clientId?: string;
    clientSecret?: string;
    stdin?: string | null;
    compileOnly?: boolean;
    key?: string;
};

type CompilerLanguage = 'cpp17' | 'java' | 'python3' | 'rust';

export type { CodeCompileRequest, CompilerLanguage };
