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

const rustErrorPatterns: RegExp[] = [
    /error(\[[E0-9]+\])?:/m,
    /--> .*\.rs:\d+:\d+/m,
];

const javaErrorPatterns: RegExp[] = [
    /(?:^|\n).*\.java:\d+:\s*error:/m,
    /Could not find or load main class/m,
    /Exception in thread "main" java\.lang\./m,
];

const serverErrorPatterns: RegExp[] = [
    /WASM local execution failed\./i,
    /execution API error \(\d+\)/i,
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

    if (lang === 'java') {
        return javaErrorPatterns.some((pattern) => pattern.test(output));
    }

    return rustErrorPatterns.some((pattern) => pattern.test(output));
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
