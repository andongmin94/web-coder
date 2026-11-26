// WASI 바이너리 실행 공통 로직 (clang, wasm-ld, python, 사용자 프로그램).
import { WASI, type WASIFS } from '@runno/wasi';
import { fetchAsset } from '../shared/assets.ts';
import { parseTar } from './tar.ts';
import { createDeepRunner, type DeepStackOptions } from './deep-stack.ts';
import { isStackOverflow, jspi } from './jspi.ts';
import { OutputCollector, OutputLimitError } from './output.ts';
import type { ProcessOutput } from './types.ts';

type WasiCall = (...args: number[]) => number;

const assetURL = (path: string) => new URL(`/${path}`, self.location.origin).href;

const moduleCache = new Map<string, Promise<WebAssembly.Module>>();

/** wasm 모듈은 워커 안에서 한 번만 컴파일해 재사용합니다. */
export const loadModule = (path: string): Promise<WebAssembly.Module> => {
    let cached = moduleCache.get(path);
    if (!cached) {
        cached = WebAssembly.compileStreaming(fetchAsset(assetURL(path)));
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

export type WasiRun = ProcessOutput & {
    fs: WASIFS;
    /** 브라우저의 호출 스택 한계(재귀 깊이)로 죽었는지 */
    stackOverflow: boolean;
};

/** iovec 배열(각 8바이트: 주소 u32, 길이 u32)을 [주소, 길이] 목록으로 */
const iovecs = (view: DataView, iovs: number, count: number) =>
    Array.from({ length: count }, (_, i) => [
        view.getUint32(iovs + i * 8, true),
        view.getUint32(iovs + i * 8 + 4, true),
    ]);

/**
 * 표준 입력 (fd_read의 fd 0). 입력을 UTF-8 바이트로 바꿔 두고 바이트 단위로 읽어 줍니다.
 *
 * runno의 fd_read를 쓰지 않는 까닭: runno는 iovec마다 따로 채우는데, 앞 iovec을 다 못 채워도
 * 다음 iovec으로 넘어갑니다. musl의 stdio는 readv([사용자 버퍼, FILE 버퍼])를 부르고 앞 버퍼가
 * 꽉 찬 뒤에만 뒤 버퍼에 데이터가 있다고 가정하므로, 한글 등으로 64KB가 넘는 입력을 fread로 읽으면
 * 중간 바이트가 빠지거나 쓰레기 값이 섞였습니다. 여기서는 POSIX readv처럼 앞에서부터 빈틈없이 채웁니다.
 */
export const createStdin = (input: string) => {
    const bytes = new TextEncoder().encode(input);
    let pos = 0;
    return {
        /** iovec들을 앞에서부터 채우고 읽은 바이트 수를 돌려줍니다. (0이면 EOF) */
        read(memory: ArrayBuffer, iovs: number, count: number): number {
            const view = new DataView(memory);
            let total = 0;
            for (const [ptr, len] of iovecs(view, iovs, count)) {
                const n = Math.min(len, bytes.length - pos);
                new Uint8Array(memory, ptr, n).set(bytes.subarray(pos, pos + n));
                pos += n;
                total += n;
                if (n < len) break;
            }
            return total;
        },
    };
};

/**
 * 표준 출력·에러 (fd_write의 fd 1, 2). runno는 쓰기마다 새 TextDecoder로 풀어서, 버퍼 경계에 걸친
 * 한글 한 글자가 U+FFFD(�)로 깨졌습니다. fd마다 이어지는(stream) 디코더를 씁니다.
 */
export const createTextSink = (write: (fd: 1 | 2, text: string) => void) => {
    const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
    return {
        write(memory: ArrayBuffer, fd: 1 | 2, iovs: number, count: number): number {
            const view = new DataView(memory);
            let total = 0;
            for (const [ptr, len] of iovecs(view, iovs, count)) {
                if (len === 0) continue;
                // 메모리는 실행 중에 커질 수 있으므로 복사해서 넘깁니다.
                const text = decoders[fd].decode(new Uint8Array(memory, ptr, len).slice(), {
                    stream: true,
                });
                total += len;
                if (text) write(fd, text);
            }
            return total;
        },
        /** 끝에 남은 반쪽 글자를 내보냅니다. */
        flush() {
            for (const fd of [1, 2] as const) {
                const rest = decoders[fd].decode();
                if (rest) write(fd, rest);
            }
        },
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
    const input = createStdin(stdin);
    const sink = createTextSink((fd, text) => out.write(fd, text));
    // 표준 입출력은 아래 fd_read·fd_write가 직접 처리하므로 runno의 콜백은 쓰이지 않습니다.
    const wasi = new WASI({
        args,
        env: {},
        fs,
        isTTY: false,
        stdin: () => null,
        stdout: () => {},
        stderr: () => {},
    });

    const api = deep ? jspi() : null;
    const deepRunner = api && deep ? createDeepRunner(api, deep) : null;
    const wasiImports = wasi.getImportObject() as Record<string, Record<string, unknown>>;
    const base = wasiImports.wasi_snapshot_preview1;
    let memoryOf: () => ArrayBuffer = () => new ArrayBuffer(0);
    const imports: Record<string, Record<string, unknown>> = {
        ...wasiImports,
        wasi_snapshot_preview1: {
            ...wasiImports.wasi_snapshot_preview1,
            poll_oneoff: (subs: number, events: number, count: number, written: number) =>
                pollOneoff(memoryOf(), subs, events, count, written),
            fd_read: (fd: number, iovs: number, count: number, nread: number) => {
                if (fd !== 0) return (base.fd_read as WasiCall)(fd, iovs, count, nread);
                const n = input.read(memoryOf(), iovs, count);
                new DataView(memoryOf()).setUint32(nread, n, true);
                return 0;
            },
            fd_write: (fd: number, iovs: number, count: number, nwritten: number) => {
                if (fd !== 1 && fd !== 2)
                    return (base.fd_write as WasiCall)(fd, iovs, count, nwritten);
                const n = sink.write(memoryOf(), fd, iovs, count);
                new DataView(memoryOf()).setUint32(nwritten, n, true);
                return 0;
            },
            // runno는 표준 입출력(0~2번)을 닫으면 EBADF를 돌려줘서, Python의 open(0).read()가
            // 끝날 때 "Exception ignored ... Bad file descriptor"를 남깁니다. 실제 OS처럼 성공으로 답합니다.
            fd_close: (fd: number) => (fd <= 2 ? 0 : (base.fd_close as WasiCall)(fd)),
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

    try {
        sink.flush();
    } catch (error) {
        if (!(error instanceof OutputLimitError)) throw error;
    }

    return {
        stdout: out.stdout,
        stderr: out.stderr,
        exitCode,
        truncated: out.truncated,
        memoryBytes: memoryOf().byteLength,
        fs: resultFS,
        stackOverflow,
    };
};
