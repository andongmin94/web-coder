// 컴파일된 Java 프로그램(TeaVM wasm-gc) 실행
import { ExitError, load } from '../../vendor/teavm/wasm-runtime.js';
import { JAVA_DEEP_STACK, RESUME_EXPORT, instrumentDeepStackWithMap } from './deep-stack.ts';
import { isStackOverflow, jspi, type Jspi } from './jspi.ts';
import { createJavaStackDecoder, type JavaFrame } from './java-debug.ts';
import {
    EAGER_OUTPUT_CHARS,
    FLUSH_INTERVAL_MS,
    OutputCollector,
    OutputLimitError,
} from './output.ts';
import type { ProcessOutput } from './types.ts';

const STACK_OVERFLOW_NOTE =
    'Exception in thread "main" java.lang.StackOverflowError\n' +
    '(브라우저의 호출 스택 한계로, 로컬 실행에서는 재귀 깊이가 약 4천~9천을 넘으면 이 에러가 납니다. ' +
    'Chrome 137 이상에서는 자동으로 깊은 재귀 모드로 다시 실행합니다.)\n';
const DEEP_OVERFLOW_NOTE =
    'Exception in thread "main" java.lang.StackOverflowError\n' +
    '(깊은 재귀 모드에서도 호출 스택이 넘쳤습니다. 백준 채점 환경과는 다를 수 있습니다.)\n';

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
    // 줄이 끝날 때도 내보내서, 시간 초과로 강제 종료돼도 그때까지의 출력이 남게 합니다.
    // 출력이 많을 때 느려지지 않게, 어느 정도 쌓인 뒤로는 시간 간격을 둡니다. (output.ts와 같은 규칙)
    let total = 0;
    let lastLineFlush = 0;
    const put = (c: number) => {
        buf[n++] = c;
        total++;
        if (n === buf.length) {
            flush();
        } else if (c === 10) {
            const now = performance.now();
            if (total <= EAGER_OUTPUT_CHARS || now - lastLineFlush >= FLUSH_INTERVAL_MS) {
                lastLineFlush = now;
                flush();
            }
        }
    };
    return { put, flush };
};

type JavaRun = ProcessOutput & {
    /** 브라우저의 호출 스택 한계(재귀 깊이)로 죽었는지 */
    stackOverflow: boolean;
};

/** JS 스택 한 줄에서 wasm 코드 주소를 꺼냅니다. (예: "at f (wasm://wasm/abc:wasm-function[12]:0x1a2b)") */
const WASM_FRAME = /wasm-function\[\d+\]:0x([0-9a-f]+)/;

/**
 * 예외가 만들어질 때 TeaVM이 부르는 teavm.takeStackTrace를 대신합니다.
 * 원래 구현은 디버그 정보를 읽는 별도 모듈이 없으면 가짜 프레임(Throwable$FakeClass)만 돌려주므로,
 * 결과물에 든 디버그 정보(java-debug.ts)로 실제 클래스·메서드·줄 번호를 채웁니다.
 * toOriginal: 깊은 재귀용으로 고친 모듈을 실행 중이면, 주소를 원래 모듈 기준으로 되돌리는 함수.
 */
const createStackTracer = (
    decode: (address: number) => JavaFrame[],
    toOriginal: ((address: number) => number | null) | null
) => {
    // 기본값 10으로는 예외 생성자 프레임을 빼고 나면 몇 줄 남지 않습니다. 너무 크게 잡으면 예외를
    // 아주 많이 던지는 코드가 느려집니다. (깊이 20에서 예외 10만 번: 10일 때 0.7초, 32일 때 1.3초)
    (Error as { stackTraceLimit?: number }).stackTraceLimit = 32;
    /** 실행기·런타임 내부 프레임은 사용자에게 의미가 없어서 뺍니다. */
    const internal = (frame: JavaFrame) =>
        frame.className === 'WebcoderLauncher' || frame.className.startsWith('org.teavm.');

    const scheduler = (frame: JavaFrame) =>
        /^java\.lang\.(Object|Thread)(\$|$)/.test(frame.className);

    return (exceptionClass: string | null) => {
        const addresses: number[] = [];
        for (const line of (new Error().stack ?? '').split('\n')) {
            const match = WASM_FRAME.exec(line);
            if (match) addresses.push(parseInt(match[1], 16));
        }
        return {
            getStack() {
                let frames: JavaFrame[] = [];
                for (const address of addresses) {
                    const original = toOriginal ? toOriginal(address) : address;
                    if (original !== null) frames.push(...decode(original));
                }
                // 예외 객체를 만드는 과정(fillInStackTrace, 생성자들)은 Java의 스택 트레이스에 나오지 않습니다.
                if (
                    frames[0]?.className === 'java.lang.Throwable' &&
                    frames[0].method === 'fillInStackTrace'
                )
                    frames.shift();
                let constructors = 0;
                while (frames[constructors]?.method === '<init>') {
                    constructors++;
                    if (frames[constructors - 1].className === exceptionClass) break;
                }
                if (constructors > 0 && frames[constructors - 1].className === exceptionClass)
                    frames = frames.slice(constructors);
                frames = frames.filter((frame) => !internal(frame));
                // join·sleep 뒤에 이어서 실행된 코드는 맨 아래에 TeaVM 스케줄러의 프레임
                // (Object.monitorEnterWait, Object$NotifyListener.run 등)이 붙습니다. JVM에는 없는 것이라 뺍니다.
                while (frames.length > 1 && scheduler(frames[frames.length - 1])) frames.pop();
                return frames;
            },
        };
    };
};

type ProgramOptions = {
    /** 깊은 재귀 모드로 실행 (artifact는 고친 모듈) */
    deep: Jspi | null;
    /** 스택 트레이스를 해석할 원래 모듈과, 고친 모듈의 주소를 원래 주소로 바꾸는 함수 */
    debugModule: Uint8Array;
    toOriginal: ((address: number) => number | null) | null;
};

/**
 * 프로그램을 불러와 실행 준비를 합니다. (로딩 시간은 실행 시간에서 빼기 위해 단계를 나눕니다)
 *
 * deep에 JSPI를 주면 artifact는 깊은 재귀용으로 고친 모듈(deep-stack.ts)이어야 하고,
 * wasm으로 들어가는 진입점(main, 스레드 실행)을 모두 새 스택에서 실행합니다.
 */
const loadProgram = async (
    artifact: Uint8Array,
    stdin: string,
    { deep, debugModule, toOriginal }: ProgramOptions
) => {
    const decode = createJavaStackDecoder(debugModule);
    const out = new OutputCollector();
    const stdout = charSink(out, 1);
    const stderr = charSink(out, 2);
    const input = new TextEncoder().encode(stdin);
    let pos = 0;
    let exitCode = 0;
    let exited = false;
    let stackOverflow = false;
    let failure: string | null = null;

    // TeaVM은 스레드(Thread, sleep, join)를 타이머로 이어 붙여 실행합니다.
    // main이 돌아온 뒤에도 남은 작업이 끝날 때까지 기다려야 스레드를 쓰는 프로그램이 끝까지 실행됩니다.
    let tasks = 0;
    let idle: (() => void) | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const taskDone = () => {
        if (--tasks === 0) idle?.();
    };
    const fail = (error: unknown) => {
        if (exited || failure !== null || stackOverflow) return;
        if (error instanceof ExitError) {
            exited = true; // System.exit: onExit에서 종료 코드를 받았습니다.
        } else if (error instanceof OutputLimitError || out.truncated) {
            exited = true;
        } else if (isStackOverflow(error)) {
            stackOverflow = true;
        } else {
            failure = error instanceof Error ? error.message : String(error);
        }
    };
    /** wasm 함수 실행 한 번을 작업으로 셉니다. 깊은 재귀 모드에서는 새 스택에서 실행합니다. */
    const enter = <A extends unknown[]>(fn: (...args: A) => unknown, ...args: A) => {
        tasks++;
        if (!deep) {
            try {
                fn(...args);
            } catch (error) {
                fail(error);
            }
            taskDone();
            return;
        }
        deep.promising(fn)(...args).then(taskDone, (error) => {
            fail(error);
            taskDone();
        });
    };

    let resume: ((id: number) => Promise<unknown>) | null = null;

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
                if (decode) {
                    (imports.teavm as Record<string, unknown>).takeStackTrace = createStackTracer(
                        decode,
                        toOriginal
                    );
                }
                imports.teavmAsync = {
                    offer(arg: unknown, fn: (arg: unknown) => void, time: number) {
                        tasks++;
                        const id = setTimeout(
                            () => {
                                timers.delete(id);
                                if (!exited && failure === null && !stackOverflow) enter(fn, arg);
                                taskDone();
                            },
                            Math.max(0, time - Date.now())
                        );
                        timers.add(id);
                        return id;
                    },
                    kill(id: ReturnType<typeof setTimeout>) {
                        if (timers.delete(id)) {
                            clearTimeout(id);
                            taskDone();
                        }
                    },
                };
                if (deep) {
                    // 고친 모듈은 putcharStderr에 0x10000 이상의 값을 넘겨 새 스택을 요청합니다.
                    imports.teavmConsole.putcharStderr = new deep.Suspending((c: number) =>
                        c >= JAVA_DEEP_STACK.idBase
                            ? resume!(c - JAVA_DEEP_STACK.idBase)
                            : stderr.put(c)
                    ) as unknown as (c: number) => void;
                    // main은 wasm이 defineFunction으로 만든 JS 함수를 거쳐 불립니다. 그 안에서 부르는
                    // wasm 함수를 새 스택에서 실행하게 바꿉니다. (JSPI는 JS 프레임을 건너 멈출 수 없음)
                    const jso = imports.teavmJso as Record<string, (...a: never[]) => unknown>;
                    const defineFunction = jso.defineFunction as (
                        fn: (...a: unknown[]) => unknown,
                        varargs: unknown
                    ) => unknown;
                    const define = (fn: (...a: unknown[]) => unknown, varargs: unknown) => {
                        const entry = (...args: unknown[]) => enter(fn, ...args);
                        Object.defineProperty(entry, 'length', { value: fn.length });
                        return defineFunction(entry, varargs);
                    };
                    jso.defineFunction = define as never;
                    jso.defineStaticMethod = ((
                        target: Record<string, unknown>,
                        name: string,
                        fn: (...a: unknown[]) => unknown,
                        varargs: unknown
                    ) => {
                        target[name] = define(fn, varargs);
                    }) as never;
                }
            },
            onExit: (code) => {
                exitCode = code;
                exited = true;
            },
        }
    );
    if (deep) {
        const instance = (program as unknown as { instance: WebAssembly.Instance }).instance;
        resume = deep.promising(instance.exports[RESUME_EXPORT] as (id: number) => void);
    }

    const flushAll = () => {
        try {
            stdout.flush();
            stderr.flush();
        } catch {
            // 출력 제한 초과 (OutputCollector가 truncated로 표시)
        }
    };

    return async (): Promise<JavaRun> => {
        try {
            // 깊은 재귀 모드에서는 defineFunction을 바꿔 둬서 main이 enter를 거칩니다.
            program.exports.main([]);
        } catch (error) {
            fail(error);
        }
        if (tasks > 0 && !exited && failure === null && !stackOverflow) {
            await new Promise<void>((resolve) => {
                idle = resolve;
                // System.exit, 에러로 끝난 경우에도 깨어나게 합니다.
                timers.add(
                    setInterval(() => {
                        if (exited || failure !== null || stackOverflow) resolve();
                    }, 20)
                );
            });
        }
        for (const id of timers) clearTimeout(id);
        timers.clear();

        flushAll();
        if (stackOverflow) {
            out.stderr += deep ? DEEP_OVERFLOW_NOTE : STACK_OVERFLOW_NOTE;
            exitCode = 1;
        } else if (failure !== null) {
            out.stderr += `[런타임 에러] ${failure}\n`;
            exitCode = 1;
        }
        return {
            stdout: out.stdout,
            stderr: out.stderr,
            exitCode,
            truncated: out.truncated,
            stackOverflow,
        };
    };
};

/**
 * 프로그램을 실행할 함수를 돌려줍니다. 호출 스택이 넘치면 깊은 재귀 모드로 한 번 다시 실행합니다.
 * (프로그램 상태가 이미 바뀌었으므로 고친 모듈을 새로 불러와 처음부터 실행)
 */
export type JavaOutput = ProcessOutput & {
    elapsedMs?: number;
    /** 깊은 재귀 모드로 실행했는지. 같은 프로그램의 다음 테스트는 넘칠 첫 시도를 건너뜁니다. */
    deep?: boolean;
};

/**
 * startDeep: 앞선 테스트에서 이미 스택이 넘친 프로그램이면 처음부터 깊은 재귀 모드로 실행합니다.
 */
export const loadJava = async (artifact: Uint8Array, stdin: string, startDeep = false) => {
    const loadDeep = async () => {
        const api = jspi();
        const patched = api && instrumentDeepStackWithMap(artifact, JAVA_DEEP_STACK);
        if (!api || !patched) return null;
        return loadProgram(patched.module, stdin, {
            deep: api,
            debugModule: artifact,
            toOriginal: patched.toOriginal,
        });
    };
    const runDeep = async (deepRun: Awaited<ReturnType<typeof loadProgram>>) => {
        const started = performance.now();
        const { stackOverflow: _again, ...output } = await deepRun();
        return { ...output, elapsedMs: performance.now() - started, deep: true };
    };

    // 불러오는 시간이 시간 제한에 들어가지 않게 실행 전에 준비합니다.
    const ready = startDeep ? await loadDeep() : null;
    if (ready) return (): Promise<JavaOutput> => runDeep(ready);

    const run = await loadProgram(artifact, stdin, {
        deep: null,
        debugModule: artifact,
        toOriginal: null,
    });
    return async (): Promise<JavaOutput> => {
        const { stackOverflow, ...first } = await run();
        if (!stackOverflow) return first;
        const deepRun = await loadDeep();
        // 실패한 첫 시도와 다시 불러오는 시간은 실행 시간에서 뺍니다.
        return deepRun ? runDeep(deepRun) : first;
    };
};
