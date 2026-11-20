// Python 3: CPython 3.11 WASI 빌드
import { loadBaseFS, loadModule, runWasi, textFile } from './wasi.ts';
import type { ProcessOutput } from './types.ts';

const PYTHON = 'wasm/python-3.11.3.wasm';
const PYTHON_FS = 'wasm/python-3.11.3.tar.gz';
const SOURCE = '/main.py';

export const warmUpPython = () => Promise.all([loadModule(PYTHON), loadBaseFS(PYTHON_FS)]);

export const runPython = async (source: string, stdin: string): Promise<ProcessOutput> => {
    const [module, baseFS] = await warmUpPython();
    const fs = { ...baseFS, [SOURCE]: textFile(SOURCE, source) };
    const { fs: _fs, ...output } = await runWasi(module, ['python', '-u', SOURCE], fs, stdin);
    return output;
};
