import { CodeCompileRequest } from '@/common/types/compile';

const PISTON_EXECUTE_API_URL = 'https://emkc.org/api/v2/piston/execute';
const PISTON_RUST_VERSION = '*';
const PISTON_JAVA_VERSION = '*';
const PISTON_MAX_ATTEMPTS = 3;
const PISTON_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const PISTON_BASE_BACKOFF_MS = 1000;
const PISTON_MAX_BACKOFF_MS = 2000;
const PISTON_JITTER_MS = 250;

type PistonFile = {
    name?: string;
    content: string;
};

type PistonExecuteRequest = {
    language: 'rust' | 'java';
    version: string;
    files: PistonFile[];
    stdin?: string;
};

type PistonResult = {
    stdout?: string;
    stderr?: string;
    output?: string;
    code?: number;
    message?: string | null;
};

type PistonExecuteResponse = {
    compile?: PistonResult;
    run?: PistonResult;
    message?: string;
};

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterDelayMs = (retryAfterHeader: string | null): number | null => {
    if (!retryAfterHeader) {
        return null;
    }

    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.round(seconds * 1000);
    }

    const targetTimeMs = Date.parse(retryAfterHeader);
    if (!Number.isNaN(targetTimeMs)) {
        const remainingMs = targetTimeMs - Date.now();
        return remainingMs > 0 ? remainingMs : 0;
    }

    return null;
};

const getBackoffDelayMs = (attempt: number): number => {
    const retryIndex = attempt - 1;
    const baseDelayMs = Math.min(
        PISTON_BASE_BACKOFF_MS * 2 ** retryIndex,
        PISTON_MAX_BACKOFF_MS
    );
    const jitterMs = Math.floor(Math.random() * PISTON_JITTER_MS);
    return baseDelayMs + jitterMs;
};

const executePistonWithRetry = async (
    payload: PistonExecuteRequest
): Promise<Response> => {
    for (let attempt = 1; attempt <= PISTON_MAX_ATTEMPTS; attempt += 1) {
        const response = await fetch(PISTON_EXECUTE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const isRetryable = PISTON_RETRYABLE_STATUS.has(response.status);
        const isLastAttempt = attempt === PISTON_MAX_ATTEMPTS;

        if (response.ok || !isRetryable || isLastAttempt) {
            return response;
        }

        const retryAfterDelayMs = parseRetryAfterDelayMs(
            response.headers.get('Retry-After')
        );
        const delayMs = retryAfterDelayMs ?? getBackoffDelayMs(attempt);
        await wait(delayMs);
    }

    throw new Error('Piston execution failed unexpectedly.');
};

const executePiston = async (
    payload: PistonExecuteRequest,
    languageLabel: 'Rust' | 'Java'
): Promise<PistonExecuteResponse> => {
    const response = await executePistonWithRetry(payload);

    if (!response.ok) {
        throw new Error(`${languageLabel} execution API error (${response.status})`);
    }

    return (await response.json()) as PistonExecuteResponse;
};

const resultOutput = (result?: PistonResult): string => {
    if (!result) {
        return '';
    }

    if (typeof result.output === 'string' && result.output.length > 0) {
        return result.output;
    }

    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
};

const resultCode = (result?: PistonResult): number => {
    if (!result || typeof result.code !== 'number') {
        return 0;
    }
    return result.code;
};

const compileRustWithPiston = async (
    data: CodeCompileRequest
): Promise<string> => {
    const payload: PistonExecuteRequest = {
        language: 'rust',
        version: PISTON_RUST_VERSION,
        files: [{ name: 'main.rs', content: data.script }],
        stdin: data.stdin ?? undefined,
    };

    const json = await executePiston(payload, 'Rust');

    const compileCode = resultCode(json.compile);
    const compileOutput = resultOutput(json.compile).trim();
    if (compileCode !== 0) {
        return (
            compileOutput ||
            json.compile?.message ||
            `Rust compile failed (exit code: ${compileCode})`
        );
    }

    const runCode = resultCode(json.run);
    const runOutput = resultOutput(json.run);
    if (runCode !== 0) {
        return (
            runOutput.trim() ||
            json.run?.message ||
            `Rust program exited with code ${runCode}`
        );
    }

    return runOutput;
};

const compileJavaWithPiston = async (
    data: CodeCompileRequest
): Promise<string> => {
    const payload: PistonExecuteRequest = {
        language: 'java',
        version: PISTON_JAVA_VERSION,
        files: [{ name: 'Main.java', content: data.script }],
        stdin: data.stdin ?? undefined,
    };

    const json = await executePiston(payload, 'Java');

    const compileCode = resultCode(json.compile);
    const compileOutput = resultOutput(json.compile).trim();
    if (compileCode !== 0) {
        return (
            compileOutput ||
            json.compile?.message ||
            `Java compile failed (exit code: ${compileCode})`
        );
    }

    const runCode = resultCode(json.run);
    const runOutput = resultOutput(json.run);
    if (runCode !== 0) {
        return (
            runOutput.trim() ||
            json.run?.message ||
            `Java program exited with code ${runCode}`
        );
    }

    return runOutput;
};

export { compileRustWithPiston, compileJavaWithPiston };
