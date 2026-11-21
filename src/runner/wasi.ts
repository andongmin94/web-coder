// WASI 바이너리 실행 공통 로직 (clang, wasm-ld, python, 사용자 프로그램).
import { WASI, type WASIFS } from '@runno/wasi';
import { parseTar } from './tar.ts';
import { createDeepRunner, isStackOverflow, jspi, type DeepStackOptions } from './deep-stack.ts';
import { OutputCollector, OutputLimitError } from './output.ts';
import type { ProcessOutput } from './types.ts';

const assetURL = (path: string) => new URL(`/${path}`, self.location.origin).href;

const moduleCache = new Map<string, Promise<WebAssembly.Module>>();

/** wasm 모듈은 워커 안에서 한 번만 컴파일해 재사용합니다. */
export const loadModule = (path: string): Promise<WebAssembly.Module> => {
    let cached = moduleCache.get(path);
    if (!cached) {
        cached = WebAssembly.compileStreaming(fetch(assetURL(path)));
        cached.catch(() => moduleCache.delete(path));
        moduleCache.set(path, cached);
    }
    return cached;
};

const fsCache = new Map<string, Promise<WASIFS>>();

const loadTarGzFS = async (path: string): Promise<WASIFS> => {
    const response = await fetch(assetURL(path));
    if (!response.ok || !response.body) {
        throw new Error(`파일 시스템을 불러오지 못했습니다: ${path} (${response.status})`);
    }
    const tar = new Uint8Array(
        await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    );
    const fs: WASIFS = {};
    for (const file of parseTar(tar)) {
        const name = file.path.replace(/\\/g, '/').replace(/^\.?\/?/, '/');
        const date = new Date(file.mtime * 1000 || Date.now());
        fs[name] = {
            path: name,
            mode: 'binary',
            content: file.content,
            timestamps: { access: date, modification: date, change: date },
        };
    }
    return fs;
};

/**
 * 기본 파일 시스템(읽기 전용으로 취급)을 캐시합니다.
 * 파일 객체는 얕게 복사해 실행마다 새 맵을 쓰고, 내용 버퍼는 공유합니다.
 */
export const loadBaseFS = async (path: string): Promise<WASIFS> => {
    let cached = fsCache.get(path);
    if (!cached) {
        cached = loadTarGzFS(path);
        cached.catch(() => fsCache.delete(path));
        fsCache.set(path, cached);
    }
    return { ...(await cached) };
};

export const textFile = (path: string, content: string): WASIFS[string] => {
    const now = new Date();
    return {
        path,
        mode: 'string',
        content,
        timestamps: { access: now, modification: now, change: now },
    };
};

export const binaryFile = (path: string, content: Uint8Array): WASIFS[string] => {
    const now = new Date();
    return {
        path,
        mode: 'binary',
        content,
        timestamps: { access: now, modification: now, change: now },
    };
};

export type WasiRun = ProcessOutput & {
    fs: WASIFS;
    /** 브라우저의 호출 스택 한계(재귀 깊이)로 죽었는지 */
    stackOverflow: boolean;
};

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * runno는 stdin 콜백 결과 중 요청한 바이트 수(maxBytes)만 쓰고 나머지는 버립니다.
 * 그래서 입력을 요청 크기에 맞춰 조각내 돌려줍니다. (UTF-8 바이트 기준, 문자 중간에서 자르지 않음)
 */
export const createStdinReader = (input: string) => {
    let pos = 0;
    return (maxBytes: number): string | null => {
        if (pos >= input.length) return null;
        let end = Math.min(input.length, pos + Math.max(1, maxBytes));
        // ASCII가 아니면 바이트 수가 글자 수보다 크므로 맞을 때까지 줄입니다.
        while (end > pos + 1 && utf8Length(input.slice(pos, end)) > maxBytes) {
            end = pos + Math.max(1, Math.floor((end - pos) * 0.75));
        }
        // 서로게이트 쌍을 가르지 않습니다.
        const last = input.charCodeAt(end - 1);
        if (end < input.length && end - pos > 1 && last >= 0xd800 && last <= 0xdbff) end--;
        const chunk = input.slice(pos, end);
        pos = end;
        return chunk;
    };
};

/**
 * poll_oneoff (sleep, select). runno의 구현은 구독 구조체를 잘못된 위치에서 읽어서
 * time.sleep()이나 std::this_thread::sleep_for()가 끝나지 않으므로 대신 씁니다.
 * 입출력 구독이 있으면 바로 준비된 것으로 답하고, 시계 구독만 있으면 그때까지 기다립니다.
 */
export const pollOneoff = (
    buffer: ArrayBuffer,
    subs: number,
    events: number,
    count: number,
    written: number
): number => {
    const SUB_SIZE = 48;
    const EVENT_SIZE = 32;
    const CLOCK = 0;
    const ABSTIME = 1;
    const view = new DataView(buffer);
    let deadline = Infinity; // ms (Date 기준. runno는 모든 시계를 Date로 답합니다)
    let hasIo = false;
    for (let i = 0; i < count; i++) {
        const sub = subs + i * SUB_SIZE;
        if (view.getUint8(sub + 8) !== CLOCK) {
            hasIo = true;
            continue;
        }
        const timeoutMs = Number(view.getBigUint64(sub + 24, true)) / 1e6;
        const absolute = (view.getUint16(sub + 40, true) & ABSTIME) !== 0;
        deadline = Math.min(deadline, absolute ? timeoutMs : Date.now() + timeoutMs);
    }
    // 실행 워커는 동기로 돌기 때문에 바쁜 대기밖에 할 수 없습니다.
    if (!hasIo) while (Date.now() < deadline);

    let n = 0;
    for (let i = 0; i < count; i++) {
        const sub = subs + i * SUB_SIZE;
        const type = view.getUint8(sub + 8);
        if (hasIo && type === CLOCK) continue;
        const event = events + n++ * EVENT_SIZE;
        new Uint8Array(buffer, event, EVENT_SIZE).fill(0);
        view.setBigUint64(event, view.getBigUint64(sub, true), true); // userdata
        view.setUint8(event + 10, type);
        if (type !== CLOCK) view.setBigUint64(event + 16, 1024n, true); // 읽고 쓸 수 있는 바이트 수
    }
    view.setUint32(written, n, true);
    return 0;
};

/**
 * deep을 주면 module은 그 옵션으로 고친 깊은 재귀용 모듈(deep-stack.ts)이어야 하고, JSPI로 실행합니다.
 */
export const runWasi = async (
    module: WebAssembly.Module,
    args: string[],
    fs: WASIFS,
    stdin: string,
    deep: DeepStackOptions | null = null
): Promise<WasiRun> => {
    const out = new OutputCollector();
    const readStdin = createStdinReader(stdin);
    const wasi = new WASI({
        args,
        env: {},
        fs,
        isTTY: false,
        stdin: readStdin,
        stdout: (chunk) => out.write(1, chunk),
        stderr: (chunk) => out.write(2, chunk),
    });

    const api = deep ? jspi() : null;
    const deepRunner = api && deep ? createDeepRunner(api, deep) : null;
    const wasiImports = wasi.getImportObject() as Record<string, Record<string, unknown>>;
    let memoryOf: () => ArrayBuffer = () => new ArrayBuffer(0);
    const imports: Record<string, Record<string, unknown>> = {
        ...wasiImports,
        wasi_snapshot_preview1: {
            ...wasiImports.wasi_snapshot_preview1,
            poll_oneoff: (subs: number, events: number, count: number, written: number) =>
                pollOneoff(memoryOf(), subs, events, count, written),
        },
        // 일반 실행에서는 불리지 않습니다. (cpp-header.ts의 __webcoder_grow)
        webcoder: { grow() {} },
    };
    deepRunner?.install(imports);
    const instance = await WebAssembly.instantiate(module, imports as WebAssembly.Imports);
    memoryOf = () => (instance.exports.memory as WebAssembly.Memory).buffer;
    let exitCode: number;
    let resultFS: WASIFS = fs;
    let stackOverflow = false;
    try {
        if (deepRunner) {
            // wasi.start()는 _start를 동기로 부르므로, 같은 준비만 하고 직접 실행합니다.
            Object.assign(wasi, {
                instance,
                module,
                memory: instance.exports.memory,
                hasBeenInitialized: true,
            });
            try {
                await deepRunner.start(instance);
                exitCode = 0;
            } catch (error) {
                // proc_exit: runno가 종료 코드를 담은 예외를 던집니다.
                const code = (error as { code?: unknown }).code;
                if (typeof code !== 'number' || error instanceof WebAssembly.RuntimeError)
                    throw error;
                exitCode = code;
            }
        } else {
            const result = wasi.start({ module, instance });
            exitCode = result.exitCode;
            resultFS = result.fs;
            if (exitCode === 134) {
                // runno는 WebAssembly.RuntimeError를 134로 바꿔 돌려줍니다.
                out.stderr +=
                    '\n[런타임 에러] 비정상 종료 (잘못된 메모리 접근, abort, 0으로 나누기 등)';
            }
        }
    } catch (error) {
        if (error instanceof OutputLimitError) {
            exitCode = 0;
        } else {
            // wasm trap (스택 오버플로, 잘못된 메모리 접근, abort 등)
            stackOverflow = isStackOverflow(error);
            const message =
                error instanceof WebAssembly.Exception
                    ? '잡히지 않은 C++ 예외로 종료했습니다.'
                    : error instanceof Error
                      ? error.message
                      : String(error);
            out.stderr += `\n[런타임 에러] ${message}`;
            exitCode = 134;
        }
    }

    return {
        stdout: out.stdout,
        stderr: out.stderr,
        exitCode,
        truncated: out.truncated,
        fs: resultFS,
        stackOverflow,
    };
};
