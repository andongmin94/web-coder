// JSPI(WebAssembly.promising/Suspending) 지원 여부와 스택 한계 에러 판별.
// 깊은 재귀 모드(deep-stack.ts)와, 그 모드로 다시 실행할지 정하는 쪽(pool.ts)이 함께 씁니다.
// 화면 쪽 번들에 wasm 재조립 코드(deep-stack.ts)가 딸려 가지 않도록 따로 둡니다.

export type Jspi = {
    promising: <A extends unknown[]>(
        fn: (...args: A) => unknown
    ) => (...args: A) => Promise<unknown>;
    Suspending: new <A extends unknown[]>(fn: (...args: A) => unknown) => WebAssembly.ImportValue;
};

/** 이 브라우저가 JSPI를 지원하는지 (Chrome 137+) */
export const jspi = (): Jspi | null => {
    const api = WebAssembly as unknown as Partial<Jspi>;
    return typeof api.promising === 'function' && typeof api.Suspending === 'function'
        ? (api as Jspi)
        : null;
};

/** 브라우저의 호출 스택 한계로 난 에러인지 */
export const isStackOverflow = (error: unknown) =>
    error instanceof RangeError && /call stack/i.test(error.message);
