declare module '*.txt' {
    const content: string;
    export default content;
}
declare module 'katex/contrib/auto-render' {
    const renderMathInElement: (el: HTMLElement, options?: Record<string, unknown>) => void;
    export default renderMathInElement;
}
declare module '*.css';
declare module 'worker-source:*' {
    const source: string;
    export default source;
}

// WebAssembly 예외 처리(wasm-eh) 타입: TS 기본 lib에 아직 없습니다.
declare namespace WebAssembly {
    class Tag {
        constructor(type: { parameters: string[] });
    }
    class Exception {
        constructor(tag: Tag, payload: unknown[], options?: { traceStack?: boolean });
        is(tag: Tag): boolean;
        getArg(tag: Tag, index: number): unknown;
        readonly stack?: string;
    }
}
