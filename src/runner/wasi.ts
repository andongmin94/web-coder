// WASI 바이너리 실행 공통 로직 (clang, wasm-ld, python, 사용자 프로그램).
import { WASI, type WASIFS } from '@runno/wasi';
import { parseTar } from './tar.ts';
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

export type WasiRun = ProcessOutput & { fs: WASIFS };

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

export const runWasi = async (
    module: WebAssembly.Module,
    args: string[],
    fs: WASIFS,
    stdin: string
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

    const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
    let exitCode: number;
    let resultFS: WASIFS = fs;
    try {
        const result = wasi.start({ module, instance });
        exitCode = result.exitCode;
        resultFS = result.fs;
        if (exitCode === 134) {
            // runno는 WebAssembly.RuntimeError를 134로 바꿔 돌려줍니다.
            out.stderr +=
                '\n[런타임 에러] 비정상 종료 (잘못된 메모리 접근, abort, 0으로 나누기 등)';
        }
    } catch (error) {
        if (error instanceof OutputLimitError) {
            exitCode = 0;
        } else {
            // wasm trap (스택 오버플로, 잘못된 메모리 접근, abort 등)
            const message = error instanceof Error ? error.message : String(error);
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
    };
};
