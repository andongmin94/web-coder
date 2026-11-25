// 큰 컴파일러 리소스는 설치 용량을 줄이려고 gzip으로 담습니다. (build.ts의 GZIP_ASSETS)
// YoWASP 번들은 불러올 때 globalThis.fetch를 붙잡아 두므로, 이 모듈을 YoWASP보다 먼저 import해야 합니다.
// 원래 이름으로 요청하면 .gz를 받아 풀어서 돌려줍니다. (첫 실행에 약 80ms 더 걸림)
import { fetchAsset } from '../shared/assets.ts';

const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetchAsset(input, init, originalFetch);
