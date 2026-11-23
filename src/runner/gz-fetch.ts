// 큰 컴파일러 리소스는 설치 용량을 줄이려고 gzip으로 담습니다. (build.ts의 GZIP_ASSETS)
// YoWASP 번들은 불러올 때 globalThis.fetch를 붙잡아 두므로, 이 모듈을 YoWASP보다 먼저 import해야 합니다.
// 원래 이름으로 요청하면 .gz를 받아 풀어서 돌려줍니다. (첫 실행에 약 80ms 더 걸림)

declare const GZIP_ASSETS: string[];

const gzipped = new Set(GZIP_ASSETS.map((path) => new URL(`/${path}`, self.location.origin).href));
const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : new URL(input, self.location.href).href;
    if (!gzipped.has(url)) return originalFetch(input, init);
    const response = await originalFetch(`${url}.gz`, init);
    if (!response.ok || !response.body) return response;
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
        headers: {
            'content-type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
        },
    });
};
