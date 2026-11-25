// 확장에 담긴 큰 파일은 설치 용량을 줄이려고 gzip으로 담습니다. (build.ts의 GZIP_ASSETS)
// 그런 파일을 원래 이름으로 요청하면 .gz를 받아 풀어서 돌려줍니다.
// (YoWASP가 직접 fetch하는 clang 리소스는 runner/gz-fetch.ts가 전역 fetch를 이 함수로 바꿔 둡니다)

declare const GZIP_ASSETS: string[] | undefined;

type Fetch = typeof fetch;

/**
 * paths: gzip으로 담긴 파일 (dist 기준 경로), base: 상대 경로의 기준이자 확장의 주소.
 * 목록에 없거나 다른 출처의 요청은 그대로 넘깁니다.
 */
export const createAssetFetch = (paths: readonly string[], base: () => string) => {
    const gzipped = new Set(paths);
    return async (
        input: RequestInfo | URL,
        init?: RequestInit,
        fetchImpl: Fetch = fetch
    ): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : input, base());
        if (url.origin !== new URL(base()).origin || !gzipped.has(url.pathname.slice(1)))
            return fetchImpl(input, init);
        const response = await fetchImpl(`${url.href}.gz`, init);
        if (!response.ok || !response.body) return response;
        return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
            headers: {
                // WebAssembly.compileStreaming은 이 타입이어야 받습니다.
                'content-type': url.pathname.endsWith('.wasm')
                    ? 'application/wasm'
                    : 'application/octet-stream',
            },
        });
    };
};

export const fetchAsset = createAssetFetch(
    // 테스트(Node)나 따로 번들하는 워커에서는 정의되지 않습니다.
    typeof GZIP_ASSETS === 'undefined' ? [] : GZIP_ASSETS,
    () => self.location.href
);
