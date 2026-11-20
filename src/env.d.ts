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
