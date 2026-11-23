// 컴파일된 C++ 프로그램(wasm32-wasip1) 실행
import { CPP_DEEP_STACK, instrumentDeepStack } from './deep-stack.ts';
import { jspi } from './jspi.ts';
import { runWasi } from './wasi.ts';
import { CPP_STACK_SIZE, type ProcessOutput } from './types.ts';

/** 미리 잡아 둔 스택은 메모리 사용량에서 뺍니다. (BOJ도 쓰지 않은 스택은 세지 않음) */
const withoutStack = <T extends ProcessOutput>(output: T): T =>
    output.memoryBytes === undefined
        ? output
        : { ...output, memoryBytes: Math.max(0, output.memoryBytes - CPP_STACK_SIZE) };

type Program = {
    module: WebAssembly.Module;
    /** 깊은 재귀용으로 고친 모듈 (처음 필요할 때 만듦). 고칠 수 없으면 null */
    deep?: Promise<WebAssembly.Module | null>;
    /** 한 번 스택이 넘친 프로그램은 다음 테스트부터 바로 깊은 재귀 모드로 실행합니다. */
    needsDeep: boolean;
};

/** 같은 결과물은 워커 안에서 한 번만 컴파일합니다. (테스트마다 같은 결과물이 옴) */
const programs = new Map<string, Promise<Program>>();
const MAX_PROGRAMS = 2;

const fingerprint = (bytes: Uint8Array) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
    return `${bytes.length}:${hash >>> 0}`;
};

const NO_JSPI_NOTE =
    '\n(브라우저의 호출 스택 한계로 재귀가 깊으면 이 에러가 납니다. ' +
    'Chrome 137 이상에서는 자동으로 깊은 재귀 모드로 다시 실행합니다.)';
const DEEP_OVERFLOW_NOTE =
    '\n(깊은 재귀 모드에서도 호출 스택이 넘쳤습니다. 지역 변수가 아주 많은 함수의 재귀일 수 있습니다.)';

const compileDeep = async (artifact: Uint8Array) => {
    const patched = instrumentDeepStack(artifact, CPP_DEEP_STACK);
    return patched ? WebAssembly.compile(patched as Uint8Array<ArrayBuffer>) : null;
};

/** 실행 준비(컴파일)를 하고, 입력을 받아 실행하는 함수를 돌려줍니다. */
export const prepareCpp = async (artifact: Uint8Array) => {
    const key = fingerprint(artifact);
    let cached = programs.get(key);
    if (!cached) {
        cached = WebAssembly.compile(artifact as Uint8Array<ArrayBuffer>).then((module) => ({
            module,
            needsDeep: false,
        }));
        cached.catch(() => programs.delete(key));
        programs.set(key, cached);
        while (programs.size > MAX_PROGRAMS) programs.delete(programs.keys().next().value!);
    }
    const program = await cached;

    return async (stdin: string): Promise<ProcessOutput & { elapsedMs?: number }> => {
        let first: ProcessOutput | null = null;
        if (!program.needsDeep) {
            const {
                fs: _fs,
                stackOverflow,
                ...output
            } = await runWasi(program.module, ['program'], {}, stdin);
            if (!stackOverflow) return withoutStack(output);
            if (!jspi()) return withoutStack({ ...output, stderr: output.stderr + NO_JSPI_NOTE });
            first = output;
        }
        const deepModule = await (program.deep ??= compileDeep(artifact));
        if (!deepModule)
            return first
                ? withoutStack(first)
                : { stdout: '', stderr: '', exitCode: 134, truncated: false };
        program.needsDeep = true;

        // 실패한 첫 시도는 실행 시간에서 뺍니다.
        const started = performance.now();
        const {
            fs: _fs,
            stackOverflow,
            ...output
        } = await runWasi(deepModule, ['program'], {}, stdin, CPP_DEEP_STACK);
        const elapsedMs = performance.now() - started;
        if (stackOverflow) output.stderr += DEEP_OVERFLOW_NOTE;
        return withoutStack({ ...output, elapsedMs });
    };
};
