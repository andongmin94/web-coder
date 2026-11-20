// 컴파일된 C++ 프로그램(wasm32-wasip1) 실행
import { runWasi } from './wasi.ts';
import type { ProcessOutput } from './types.ts';

export const runCpp = async (artifact: Uint8Array, stdin: string): Promise<ProcessOutput> => {
    const module = await WebAssembly.compile(artifact as Uint8Array<ArrayBuffer>);
    const { fs: _fs, ...output } = await runWasi(module, ['program'], {}, stdin);
    return output;
};
