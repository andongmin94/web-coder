// TeaVM wasm-gc JS 런타임(wasm-runtime.js)에서 웹 코더가 쓰는 부분의 타입
export type TeaVMImports = Record<string, Record<string, unknown>> & {
    teavmConsole: {
        putcharStdout: (c: number) => void;
        putcharStderr: (c: number) => void;
    };
};

export type TeaVMLoadOptions = {
    installImports?: (imports: TeaVMImports) => void;
    onExit?: (code: number) => void;
    noAutoImports?: boolean;
};

export type TeaVMModule<E = Record<string, unknown>> = {
    exports: E;
};

export class ExitError extends Error {
    code: number;
}

export function load<E = Record<string, unknown>>(
    source: string | BufferSource,
    options?: TeaVMLoadOptions
): Promise<TeaVMModule<E>>;
