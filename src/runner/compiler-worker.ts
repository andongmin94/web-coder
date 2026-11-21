// C++ 컴파일 워커 (모듈 워커). YoWASP clang(LLVM 22)으로 wasm32-wasip1 프로그램을 만듭니다.
// 이 파일은 dist/clang/에 번들되고, YoWASP 리소스(llvm.core.wasm 등)도 같은 폴더에 둡니다.
import { commands } from '@yowasp/clang';
import {
    BITS_STDCXX,
    FAST_IO_HEADER,
    usesBitsStdcxx,
    usesExceptions,
    usesUnsyncedStdio,
} from './cpp-header.ts';
import { BITS_EXTCXX, PBDS_TREE } from './cpp-pbds.ts';
import { getPch, pchKey, putPch } from './pch-cache.ts';
import type { CompilerRequest, CompilerResponse } from './types.ts';

declare const COMPILER_VERSION: string;

type Tree = { [name: string]: Tree | string | Uint8Array };

const decoder = new TextDecoder();
const reply = (message: CompilerResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(message, transfer);

/**
 * 예외(try/catch/throw) 지원. YoWASP sysroot의 libc++는 예외 없이 빌드된 것이라
 * wasi-sdk의 예외 지원 libc++/libc++abi/libunwind(public/clang-eh/)를 대신 링크합니다.
 * 이 라이브러리가 새 방식의 wasm 예외 명령(exnref)을 쓰므로 사용자 코드도 같은 방식으로 만듭니다.
 */
const EH_COMPILE_FLAGS = ['-fwasm-exceptions', '-mllvm', '-wasm-use-legacy-eh=false'];
const EH_LINK_FLAGS = [
    // LTO로 링크 때 만드는 코드에도 같은 옵션이 들어가야 합니다.
    '-Wl,-mllvm,-wasm-enable-eh',
    '-Wl,-mllvm,-exception-model=wasm',
    '-Wl,-mllvm,-wasm-use-legacy-eh=false',
    '-L./eh',
    '-lunwind',
    // 잡히지 않은 예외를 알려 주는 래퍼 (cpp-header.ts의 __wrap___main_void)
    '-Wl,--wrap=__main_void',
];
const EH_LIBS = ['libc++.a', 'libc++abi.a', 'libunwind.a'];

let ehLibs: Promise<Tree> | null = null;
/** 예외 지원 라이브러리는 처음 필요할 때 한 번만 읽습니다. (약 10MB) */
const loadEhLibs = () => {
    ehLibs ??= (async () => {
        const tree: Tree = {};
        await Promise.all(
            EH_LIBS.map(async (name) => {
                const response = await fetch(new URL(`../clang-eh/${name}`, import.meta.url));
                if (!response.ok)
                    throw new Error(`예외 지원 라이브러리를 불러오지 못했습니다: ${name}`);
                tree[name] = new Uint8Array(await response.arrayBuffer());
            })
        );
        return tree;
    })();
    ehLibs.catch(() => (ehLibs = null));
    return ehLibs;
};

const commonFlags = (std: string, exceptions: boolean) => [
    `-std=${std}`,
    '-O2',
    // 오브젝트 파일 대신 비트코드로 넘겨 링크 때 코드를 만듭니다. wasm 오브젝트 파일은 0으로 채운
    // 전역 배열을 그대로 담아서, int a[4000000] 같은 선언만으로 컴파일이 5초 넘게 걸립니다.
    // (배열 크기의 제곱으로 느려짐. LTO에서는 200MB 배열도 1초 안팎)
    '-flto',
    ...(exceptions ? EH_COMPILE_FLAGS : ['-fno-exceptions']),
    // clock()은 WASI에 없어서 벽시계 기반 에뮬레이션을 씁니다.
    '-D_WASI_EMULATED_PROCESS_CLOCKS',
    '-fno-color-diagnostics',
    '-ferror-limit=10',
    '-I.',
];

const headerTree = (): Tree => ({
    bits: { 'stdc++.h': BITS_STDCXX, 'extc++.h': BITS_EXTCXX },
    ext: PBDS_TREE,
    webcoder: { 'fastio.h': FAST_IO_HEADER },
});

/** PCH는 헤더 내용과 컴파일 옵션이 같을 때만 다시 쓸 수 있습니다. */
const PCH_SEED = `${BITS_STDCXX}
${commonFlags('', false).join(' ')}
${commonFlags('', true).join(' ')}`;
/** 예외 지원 여부에 따라 PCH가 다릅니다. */
const pchKeyFor = (std: string, exceptions: boolean) =>
    pchKey(COMPILER_VERSION, exceptions ? `${std}+eh` : std, PCH_SEED);

/** 사용자 프로그램의 선형 메모리 스택 크기 (재귀 깊이 한계). BOJ는 스택이 메모리 제한까지 허용됩니다. */
const STACK_SIZE = 64 << 20;

const pchMemory = new Map<string, Uint8Array>();

const loadPch = async (std: string, exceptions: boolean) => {
    const key = pchKeyFor(std, exceptions);
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
    const exceptions = usesExceptions(source);
    const files: Tree = { 'main.cpp': source, ...headerTree() };
    const args = [...commonFlags(std, exceptions)];
    if (exceptions) {
        files.eh = await loadEhLibs();
        args.push(...EH_LINK_FLAGS);
    }
    // 매크로로 이름을 바꿀 때는 PCH와 매크로 상태가 어긋나므로 PCH를 쓰지 않습니다.
    if (pch && renames.length === 0) {
        files['stdcxx.pch'] = pch;
        args.push('-Xclang', '-fno-validate-pch', '-include-pch', 'stdcxx.pch');
    }
    for (const name of renames) args.push(`-D${name}=__webcoder_user_${name}`);
    args.push('-include', 'webcoder/fastio.h');
    if (usesUnsyncedStdio(source)) args.push('-DWEBCODER_UNSYNCED_STDIO');
    args.push(
        `-Wl,-z,stack-size=${STACK_SIZE}`,
        '-lwasi-emulated-process-clocks',
        'main.cpp',
        '-o',
        'program.wasm'
    );
    return clang(args, files);
};

const compile = async (source: string, std: string): Promise<CompilerResponse> => {
    const usePch = usesBitsStdcxx(source);
    const pch = usePch ? await loadPch(std, usesExceptions(source)) : undefined;

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

const buildPch = async (std: string, exceptions: boolean) => {
    const key = pchKeyFor(std, exceptions);
    if (await getPch(key)) return;
    const result = await clang(
        [...commonFlags(std, exceptions), '-x', 'c++-header', 'bits/stdc++.h', '-o', 'stdcxx.pch'],
        headerTree()
    );
    const pch = result.ok ? result.out['stdcxx.pch'] : undefined;
    if (!(pch instanceof Uint8Array)) {
        throw new Error(`PCH 생성 실패: ${result.diagnostics.trim() || '출력 없음'}`);
    }
    await putPch(key, pch);
};

/**
 * 인텔리센스용 분석: -fsyntax-only로 진단, -code-completion-at으로 자동완성/시그니처.
 * 링크 단계가 없어 PCH가 있으면 수십~수백 ms 안에 끝납니다.
 */
const analyze = async (source: string, std: string, extra: string[]) => {
    const exceptions = usesExceptions(source);
    const usePch = usesBitsStdcxx(source);
    const pch = usePch ? await loadPch(std, exceptions) : undefined;
    const files: Tree = { 'main.cpp': source, ...headerTree() };
    const args = [...commonFlags(std, exceptions)];
    if (pch) {
        files['stdcxx.pch'] = pch;
        args.push('-Xclang', '-fno-validate-pch', '-include-pch', 'stdcxx.pch');
    }
    args.push('-fsyntax-only', ...extra, 'main.cpp');
    const result = await clang(args, files);
    return { output: result.diagnostics, needsPch: usePch && !pch };
};

self.addEventListener('message', async (event: MessageEvent<CompilerRequest>) => {
    const req = event.data;
    try {
        if (req.type === 'complete') {
            const extra = ['-Xclang', `-code-completion-at=main.cpp:${req.line}:${req.col}`];
            // 멤버 접근(. ->)일 때는 전역 이름 목록이 필요 없어 훨씬 빠릅니다.
            if (req.memberOnly) extra.push('-Xclang', '-no-code-completion-ns-level-decls');
            // 전역 목록에는 매크로(INT_MAX, 사용자가 #define한 것)도 넣습니다.
            else extra.push('-Xclang', '-code-completion-macros');
            const res = await analyze(req.source, req.std, extra);
            reply({ type: 'intel', id: req.id, ...res });
            return;
        }
        if (req.type === 'diagnose') {
            const res = await analyze(req.source, req.std, []);
            reply({ type: 'intel', id: req.id, ...res });
            return;
        }
        if (req.type === 'warmup') {
            // 첫 호출에서 llvm.core.wasm(약 74MB)과 sysroot를 받아 컴파일해 둡니다.
            await clang(['--version'], {});
            return;
        }
        if (req.type === 'build-pch') {
            await buildPch(req.std, req.exceptions);
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
