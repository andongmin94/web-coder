import { CodeCompileRequest } from '@/common/types/compile';

const PISTON_EXECUTE_API_URL = 'https://emkc.org/api/v2/piston/execute';
const PISTON_RUST_VERSION = '*';
const PISTON_JAVA_VERSION = '*';

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

    const response = await fetch(PISTON_EXECUTE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Rust execution API error (${response.status})`);
    }

    const json = (await response.json()) as PistonExecuteResponse;

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

    const response = await fetch(PISTON_EXECUTE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Java execution API error (${response.status})`);
    }

    const json = (await response.json()) as PistonExecuteResponse;

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
