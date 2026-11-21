// Python 3: CPython 3.13 WASI 빌드 (tools/python/README.md)
import { PYTHON_DEEP_STACK, instrumentDeepStack, jspi } from './deep-stack.ts';
import { loadBaseFS, loadModule, runWasi, textFile } from './wasi.ts';
import type { ProcessOutput } from './types.ts';

const PYTHON = 'wasm/python-3.13.17.wasm';
const PYTHON_FS = 'wasm/python-3.13.17.tar.gz';
const SOURCE = '/main.py';
// -B: 메모리 파일 시스템에 .pyc를 쓰지 않음, -u: 출력을 바로 내보냄
const ARGS = ['python', '-B', '-u', SOURCE];

export const warmUpPython = () => Promise.all([loadModule(PYTHON), loadBaseFS(PYTHON_FS)]);

const DEEP_OVERFLOW_NOTE =
    '\n(깊은 재귀 모드에서도 호출 스택이 넘쳤습니다. 백준 채점 환경과는 다를 수 있습니다.)';

/**
 * 순수 Python 함수의 재귀는 C 스택을 쓰지 않지만, lru_cache를 붙인 함수나 sorted의 key 안에서의
 * 재귀처럼 C 코드를 거치는 재귀는 브라우저의 호출 스택 한계(약 1MB)에 걸립니다.
 * 그때 쓰는 깊은 재귀용 인터프리터 (deep-stack.ts). 처음 필요할 때 한 번만 만듭니다.
 */
let deepModule: Promise<WebAssembly.Module | null> | null = null;
const loadDeepModule = () => {
    deepModule ??= (async () => {
        const response = await fetch(new URL(`/${PYTHON}`, self.location.origin));
        const patched = instrumentDeepStack(
            new Uint8Array(await response.arrayBuffer()),
            PYTHON_DEEP_STACK
        );
        return patched ? WebAssembly.compile(patched as Uint8Array<ArrayBuffer>) : null;
    })();
    deepModule.catch(() => (deepModule = null));
    return deepModule;
};

export const runPython = async (
    source: string,
    stdin: string
): Promise<ProcessOutput & { elapsedMs?: number }> => {
    const [module, baseFS] = await warmUpPython();
    const files = () => ({ ...baseFS, [SOURCE]: textFile(SOURCE, source) });
    const { fs: _fs, stackOverflow, ...output } = await runWasi(module, ARGS, files(), stdin);
    if (!stackOverflow || !jspi()) return output;

    const deep = await loadDeepModule().catch(() => null);
    if (!deep) return output;
    // 실패한 첫 시도와 인터프리터를 고치는 시간은 실행 시간에서 뺍니다.
    const started = performance.now();
    const {
        fs: _deepFs,
        stackOverflow: again,
        ...deepOutput
    } = await runWasi(deep, ARGS, files(), stdin, PYTHON_DEEP_STACK);
    const elapsedMs = performance.now() - started;
    if (again) deepOutput.stderr += DEEP_OVERFLOW_NOTE;
    return { ...deepOutput, elapsedMs };
};
