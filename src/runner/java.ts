// 컴파일된 Java 프로그램(TeaVM wasm-gc) 실행
import { ExitError, load } from '../../vendor/teavm/wasm-runtime.js';
import { OutputCollector, OutputLimitError } from './output.ts';
import type { ProcessOutput } from './types.ts';

const STACK_OVERFLOW_NOTE =
    'Exception in thread "main" java.lang.StackOverflowError\n' +
    '(브라우저 Worker의 스택 한계로, 로컬 실행에서는 재귀 깊이가 약 4천~9천을 넘으면 이 에러가 납니다. ' +
    '백준 채점 환경과는 다를 수 있습니다.)\n';

/** putchar로 한 글자(UTF-16 코드 단위)씩 오는 출력을 모아 OutputCollector에 넘깁니다. */
const charSink = (out: OutputCollector, fd: 1 | 2) => {
    const buf = new Uint16Array(8192);
    let n = 0;
    const flush = () => {
        if (n > 0) {
            const text = String.fromCharCode(...buf.subarray(0, n));
            n = 0;
            out.write(fd, text);
        }
    };
    const put = (c: number) => {
        buf[n++] = c;
        if (n === buf.length) flush();
    };
    return { put, flush };
};

/**
 * 프로그램을 불러와 실행 준비를 합니다. (로딩 시간은 실행 시간에서 빼기 위해 단계를 나눕니다)
 */
export const loadJava = async (artifact: Uint8Array, stdin: string) => {
    const out = new OutputCollector();
    const stdout = charSink(out, 1);
    const stderr = charSink(out, 2);
    const input = new TextEncoder().encode(stdin);
    let pos = 0;
    let exitCode = 0;

    const program = await load<{ main(args: string[]): void }>(
        artifact as Uint8Array<ArrayBuffer>,
        {
            installImports(imports) {
                imports.teavmConsole.putcharStdout = stdout.put;
                imports.teavmConsole.putcharStderr = stderr.put;
                imports.webcoderStdin = {
                    read: () => (pos < input.length ? input[pos++] : -1),
                    available: () => input.length - pos,
                };
            },
            onExit: (code) => {
                exitCode = code;
            },
        }
    );

    const flushAll = () => {
        try {
            stdout.flush();
            stderr.flush();
        } catch {
            // 출력 제한 초과 (OutputCollector가 truncated로 표시)
        }
    };

    return (): ProcessOutput => {
        try {
            program.exports.main([]);
        } catch (error) {
            flushAll();
            if (error instanceof ExitError) {
                // System.exit: onExit에서 종료 코드를 받았습니다.
            } else if (error instanceof OutputLimitError || out.truncated) {
                exitCode = 0;
            } else if (error instanceof RangeError && /call stack/i.test(error.message)) {
                out.stderr += STACK_OVERFLOW_NOTE;
                exitCode = 1;
            } else {
                const message = error instanceof Error ? error.message : String(error);
                out.stderr += `[런타임 에러] ${message}\n`;
                exitCode = 1;
            }
        }
        flushAll();
        return { stdout: out.stdout, stderr: out.stderr, exitCode, truncated: out.truncated };
    };
};
