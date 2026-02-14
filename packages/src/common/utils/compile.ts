import { CompilerLanguage } from '@/common/types/compile';
import { MISSING_JDOODLE_CREDENTIALS_ERROR } from '@/common/config/jdoodle';

const CompileErrorFormatConvertMap: Record<CompilerLanguage, string> = {
    cpp17: 'jdoodle.cpp',
    java: 'Main.java',
    python3: 'jdoodle.py',
    rust: 'jdoodle.rs',
};

const cppCompileErrorPatterns: RegExp[] = [
    /jdoodle\.cpp:/m,
    /\/program(?::\d+:\d+)?:\s*(fatal\s+)?error:/m,
    /wasm-ld:\s*error:/m,
    /clang:\s*error:/m,
];

const pythonErrorPatterns: RegExp[] = [
    /Traceback \(most recent call last\):/m,
    /SyntaxError:/m,
    /IndentationError:/m,
    /TabError:/m,
    /File \"\/program\.py\", line \d+/m,
];

const errorMessages: Record<string, string> = {
    limit_exceeded: `웹 코더 - 서비스 이용 한도 초과 안내\n
    현재 이용량 증가로 인해 일일 코드 실행 호출 한도가 초과되었습니다.
    한도는 매일 오전 9시에 자동으로 초기화됩니다.\n
    더 나은 서비스와 안정적인 환경을 제공하기 위해 최선을 다하겠습니다.
    너른 양해 부탁드립니다.`,
    server_error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    invalid_request:
        '올바르지 않은 요청입니다. 확장 팝업에서 JDoodle API 설정(Client ID/Secret)을 확인한 뒤 다시 시도해주세요.',
    compile_failed:
        '컴파일에 실패하였습니다. 코드에 오류가 없는지 확인해주세요.',
    missing_credentials: MISSING_JDOODLE_CREDENTIALS_ERROR,
};

/* JDoodle compile API 동작을 위한 별도의 처리가 필요한 경우 코드를 전처리 */
const preprocessSourceCode = (
    language: CompilerLanguage,
    code: string
): string => {
    return code;
};

/* JDoodle compile API 동작 후 처리가 필요한 경우 출력 결과를 후처리 */
const postprecessOutput = (
    language: CompilerLanguage,
    output: string
): string => {
    if (
        language === 'cpp17' &&
        output.includes('jdoodle.cpp:') &&
        output.includes('warning: ')
    ) {
        output = output.split('jdoodle.cpp:')[0].trim();
    }
    if (language === 'java' && output.includes('Note: Main.java')) {
        output = output.split('Note: Main.java')[0].trim();
    }
    if (language === 'rust' && output.includes(': warning: ')) {
        output = output.split('\njdoodle.rs')[0].trim();
    }
    if (output.includes('JDoodle - output Limit reached.')) {
        output = '출력 초과';
    }
    if (
        output.includes('JDOODLE_TIMEOUT_LIMIT_EXCEEDED') ||
        output.includes('JDoodle - Timeout')
    ) {
        output = '시간 초과';
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

    return output.includes(CompileErrorFormatConvertMap[lang]);
};

const checkServerError = (output: string): boolean => {
    return Object.entries(errorMessages).some(([key, message]) =>
        output.includes(message)
    );
};

const processErrorCode = (status: number): string => {
    if (status == 429) {
        return errorMessages.limit_exceeded;
    } else if (status < 410) {
        return errorMessages.invalid_request;
    } else if (status == 417) {
        return errorMessages.compile_failed;
    }
    return errorMessages.server_error;
};

export {
    preprocessSourceCode,
    postprecessOutput,
    checkCompileError,
    checkServerError,
    processErrorCode,
};
