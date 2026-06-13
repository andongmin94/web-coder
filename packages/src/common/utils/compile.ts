// 공통으로 재사용하는 실행 로직과 도우미 함수를 담은 유틸 파일입니다.
import { CompilerLanguage } from '@/common/types/compile';

const cppCompileErrorPatterns: RegExp[] = [
    /\/program(?::\d+:\d+)?:\s*(fatal\s+)?error:/m,
    /wasm-ld:\s*error:/m,
    /clang:\s*error:/m,
];

const pythonErrorPatterns: RegExp[] = [
    /Traceback \(most recent call last\):/m,
    /SyntaxError:/m,
    /IndentationError:/m,
    /TabError:/m,
    /File "\/program\.py", line \d+/m,
];

const serverErrorPatterns: RegExp[] = [
    /WASM local execution failed\./i,
    /execution failed\./i,
    /Failed to fetch/i,
    /NetworkError/i,
    /Unsupported language:/i,
];

const preprocessSourceCode = (
    language: CompilerLanguage,
    code: string
): string => {
    return code;
};

const postprecessOutput = (
    language: CompilerLanguage,
    output: string
): string => {
    if (/output limit reached/i.test(output)) {
        return 'Output limit exceeded';
    }

    if (/timed out|timeout/i.test(output)) {
        return 'Time limit exceeded';
    }

    return output;
};

const checkCompileError = (lang: CompilerLanguage, output: string): boolean => {
    if (lang === 'cpp17') {
        return cppCompileErrorPatterns.some((pattern) => pattern.test(output));
    }

    if (lang === 'python3') {
        return pythonErrorPatterns.some((pattern) => pattern.test(output));
    }

    return false;
};

const checkServerError = (output: string): boolean => {
    return serverErrorPatterns.some((pattern) => pattern.test(output));
};

export {
    preprocessSourceCode,
    postprecessOutput,
    checkCompileError,
    checkServerError,
};
