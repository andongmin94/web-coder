// C++ 컴파일 워커 (모듈 워커). YoWASP clang(LLVM 22)으로 wasm32-wasip1 프로그램을 만듭니다.
// 이 파일은 dist/clang/에 번들되고, YoWASP 리소스(llvm.core.wasm 등)도 같은 폴더에 둡니다.
import { commands } from '@yowasp/clang';
import { BITS_STDCXX, FAST_IO_HEADER, usesBitsStdcxx, usesUnsyncedStdio } from './cpp-header.ts';
import { getPch, pchKey, putPch } from './pch-cache.ts';
import type { CompilerRequest, CompilerResponse } from './types.ts';

declare const COMPILER_VERSION: string;

type Tree = { [name: string]: Tree | string | Uint8Array };

const decoder = new TextDecoder();
const reply = (message: CompilerResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(message, transfer);

const commonFlags = (std: string) => [
    `-std=${std}`,
    '-O2',
    '-fno-exceptions',
    '-fno-color-diagnostics',
    '-ferror-limit=10',
    '-I.',
];

const headerTree = (): Tree => ({
    bits: { 'stdc++.h': BITS_STDCXX },
    webcoder: { 'fastio.h': FAST_IO_HEADER },
});

const pchMemory = new Map<string, Uint8Array>();

const loadPch = async (std: string) => {
    const key = pchKey(COMPILER_VERSION, std, BITS_STDCXX);
    const cached = pchMemory.get(key) ?? (await getPch(key));
    if (cached) pchMemory.set(key, cached);
    return cached;
};

/** clang 실행. 실패 시 Exit 예외 대신 { ok: false }로 돌려줍니다. */
const clang = async (args: string[], files: Tree) => {
    let diagnostics = '';
    const collect = (bytes: Uint8Array | null) => {
        if (bytes) diagnostics += decoder.decode(bytes, { stream: true });
    };
    try {
        const out = (await commands['clang++'](args, files, {
            stdout: collect,
            stderr: collect,
        })) as Tree;
        return { ok: true as const, out, diagnostics };
    } catch (error) {
        const code = (error as { code?: number }).code;
        if (typeof code === 'number') return { ok: false as const, diagnostics };
        throw error;
    }
};

/**
 * 이 sysroot의 libc++는 wasi-libc의 link, access 같은 함수를 참조합니다.
 * 그래서 같은 이름의 전역 변수(예: int link[N])를 두면, BOJ(GCC)에서는 되는 코드가
 * "wasm-ld: error: symbol type mismatch: link"로 실패합니다.
 * 이때 해당 이름을 매크로로 바꿔 한 번 다시 컴파일합니다.
 */
const clashingSymbols = (diagnostics: string) =>
    [...diagnostics.matchAll(/symbol type mismatch: ([A-Za-z_]\w*)/g)].map((m) => m[1]);

const build = async (
    source: string,
    std: string,
    pch: Uint8Array | undefined,
    renames: string[]
) => {
    const files: Tree = { 'main.cpp': source, ...headerTree() };
    const args = [...commonFlags(std)];
    // 매크로로 이름을 바꿀 때는 PCH와 매크로 상태가 어긋나므로 PCH를 쓰지 않습니다.
    if (pch && renames.length === 0) {
        files['stdcxx.pch'] = pch;
        args.push('-Xclang', '-fno-validate-pch', '-include-pch', 'stdcxx.pch');
    }
    for (const name of renames) args.push(`-D${name}=__webcoder_user_${name}`);
    args.push('-include', 'webcoder/fastio.h');
    if (usesUnsyncedStdio(source)) args.push('-DWEBCODER_UNSYNCED_STDIO');
    args.push('-Wl,-z,stack-size=8388608', 'main.cpp', '-o', 'program.wasm');
    return clang(args, files);
};

const compile = async (source: string, std: string): Promise<CompilerResponse> => {
    const usePch = usesBitsStdcxx(source);
    const pch = usePch ? await loadPch(std) : undefined;

    let result = await build(source, std, pch, []);
    if (!result.ok) {
        const renames = clashingSymbols(result.diagnostics);
        if (renames.length > 0) result = await build(source, std, pch, renames);
    }
    const program = result.ok ? result.out['program.wasm'] : undefined;
    if (!result.ok || !(program instanceof Uint8Array)) {
        return {
            type: 'compile',
            id: 0,
            ok: false,
            diagnostics: result.diagnostics.trim() || '컴파일에 실패했습니다.',
        };
    }
    return {
        type: 'compile',
        id: 0,
        ok: true,
        artifact: program,
        diagnostics: result.diagnostics.trim(),
        needsPch: usePch && !pch,
    };
};

const buildPch = async (std: string) => {
    const key = pchKey(COMPILER_VERSION, std, BITS_STDCXX);
    if (await getPch(key)) return;
    const result = await clang(
        [...commonFlags(std), '-x', 'c++-header', 'bits/stdc++.h', '-o', 'stdcxx.pch'],
        headerTree()
    );
    const pch = result.ok ? result.out['stdcxx.pch'] : undefined;
    if (!(pch instanceof Uint8Array)) {
        throw new Error(`PCH 생성 실패: ${result.diagnostics.trim() || '출력 없음'}`);
    }
    await putPch(key, pch);
};

self.addEventListener('message', async (event: MessageEvent<CompilerRequest>) => {
    const req = event.data;
    try {
        if (req.type === 'warmup') {
            // 첫 호출에서 llvm.core.wasm(약 74MB)과 sysroot를 받아 컴파일해 둡니다.
            await clang(['--version'], {});
            return;
        }
        if (req.type === 'build-pch') {
            await buildPch(req.std);
            reply({ type: 'pch-ready', id: req.id, std: req.std });
            return;
        }
        const res = await compile(req.source, req.std);
        reply(
            { ...res, id: req.id },
            res.type === 'compile' && res.artifact ? [res.artifact.buffer] : []
        );
    } catch (error) {
        reply({
            type: 'error',
            id: 'id' in req ? req.id : 0,
            message: error instanceof Error ? error.message : String(error),
        });
    }
});
