// 확장에 담긴 큰 파일은 설치 용량을 줄이려고 gzip으로 담습니다. (build.ts의 GZIP_ASSETS)
// 그런 파일을 원래 이름으로 요청하면 .gz를 받아 풀어서 돌려줍니다.
// (YoWASP가 직접 fetch하는 clang 리소스는 runner/gz-fetch.ts가 같은 일을 합니다)

declare const GZIP_ASSETS: string[] | undefined;

// 테스트(Node)나 따로 번들하는 워커에서는 정의되지 않습니다.
const gzipped = new Set(typeof GZIP_ASSETS === 'undefined' ? [] : GZIP_ASSETS);

/** dist 기준 경로가 gzip으로 담긴 파일인지 */
export const isGzipAsset = (path: string) => gzipped.has(path);

export const fetchAsset = async (input: string | URL): Promise<Response> => {
    const url = new URL(input, self.location.href);
    if (url.origin !== self.location.origin || !isGzipAsset(url.pathname.slice(1)))
        return fetch(url);
    const response = await fetch(`${url.href}.gz`);
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
