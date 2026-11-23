// node.js 깊은 재귀 모드: QuickJS(WASI, tools/quickjs/README.md)로 다시 실행합니다.
//
// node.js 코드는 원래 sandbox의 V8 워커에서 돌지만, 브라우저 워커의 호출 스택은 크기를 바꿀 수 없어서
// 재귀 깊이가 수천에서 막힙니다. (백준은 node --stack-size=65536으로 실행해 훨씬 깊게 됩니다)
// 그때 C 스택을 크게 잡아 빌드한 QuickJS를 깊은 재귀 계측(deep-stack.ts)과 함께 실행합니다.
// 깊이 약 60만까지 됩니다. 대신 V8보다 수십 배 느립니다.
import boot from './node-deep-boot.js.txt';
import prelude from './node-prelude.js.txt';
import { WASI_DEEP_STACK, instrumentDeepStack } from './deep-stack.ts';
import { runWasi, textFile } from './wasi.ts';
import type { ProcessOutput } from './types.ts';

export const QUICKJS_PATH = 'wasm/quickjs-0.18.0.wasm';

const DEEP_OVERFLOW_NOTE =
    '\n(깊은 재귀 모드에서도 호출 스택이 넘쳤습니다. 깊이 약 60만이 한계입니다.)';

let deepModule: Promise<WebAssembly.Module | null> | null = null;

/** 깊은 재귀 계측을 한 QuickJS. 처음 필요할 때 한 번만 만듭니다. 고칠 수 없으면 null */
const loadModule = () => {
    deepModule ??= (async () => {
        const response = await fetch(new URL(`/${QUICKJS_PATH}`, self.location.origin));
        if (!response.ok) throw new Error(`QuickJS를 불러오지 못했습니다. (${response.status})`);
        const patched = instrumentDeepStack(
            new Uint8Array(await response.arrayBuffer()),
            WASI_DEEP_STACK
        );
        return patched ? WebAssembly.compile(patched as Uint8Array<ArrayBuffer>) : null;
    })();
    deepModule.catch(() => (deepModule = null));
    return deepModule;
};

/** 계측한 QuickJS 모듈로 사용자 코드를 실행합니다. (테스트에서 모듈을 직접 넘길 수 있게 분리) */
export const runNodeDeepWith = async (
    module: WebAssembly.Module,
    source: string,
    stdin: string
): Promise<ProcessOutput & { elapsedMs: number }> => {
    const files = {
        '/boot.js': textFile('/boot.js', boot),
        '/prelude.js': textFile('/prelude.js', prelude),
        '/source.js': textFile('/source.js', source),
    };
    const started = performance.now();
    const {
        fs: _fs,
        stackOverflow,
        ...output
    } = await runWasi(module, ['qjs', '/boot.js'], files, stdin, WASI_DEEP_STACK);
    const elapsedMs = performance.now() - started;
    if (stackOverflow) output.stderr += DEEP_OVERFLOW_NOTE;
    // 선형 메모리 대부분이 미리 잡은 C 스택이라 node.js의 메모리 사용량과 비교할 수 없습니다.
    return { ...output, memoryBytes: undefined, elapsedMs };
};

/** 실행 전에 불러 둡니다. (불러오는 시간이 시간 제한에 들어가지 않게, worker.ts의 prepare에서 부름) */
export const warmUpNodeDeep = () => loadModule();

export const runNodeDeep = async (source: string, stdin: string) => {
    const module = await loadModule();
    if (!module) throw new Error('깊은 재귀 모드를 준비하지 못했습니다.');
    return runNodeDeepWith(module, source, stdin);
};
