import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createAssetFetch } from './assets.ts';

const BASE = 'chrome-extension://abc/solver.html';

/** 요청한 주소를 기록하고, 정해 둔 응답을 돌려주는 가짜 fetch */
const fakeFetch = (files: Record<string, Uint8Array>) => {
    const requested: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        requested.push(url);
        const body = files[url];
        return body
            ? new Response(body as Uint8Array<ArrayBuffer>)
            : new Response(null, { status: 404 });
    }) as typeof fetch;
    return { impl, requested };
};

const text = async (response: Response) => new TextDecoder().decode(await response.arrayBuffer());

test('gzip으로 담긴 파일은 .gz를 받아 풀어서 돌려준다', async () => {
    const fetchAsset = createAssetFetch(['wasm/python.wasm', 'clang/res.tar'], () => BASE);
    const { impl, requested } = fakeFetch({
        'chrome-extension://abc/wasm/python.wasm.gz': gzipSync('wasm-bytes'),
        'chrome-extension://abc/clang/res.tar.gz': gzipSync('tar-bytes'),
    });

    const wasm = await fetchAsset('wasm/python.wasm', undefined, impl);
    assert.equal(await text(wasm), 'wasm-bytes');
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');

    const tar = await fetchAsset(new URL('/clang/res.tar', BASE), undefined, impl);
    assert.equal(await text(tar), 'tar-bytes');
    assert.equal(tar.headers.get('content-type'), 'application/octet-stream');

    assert.deepEqual(requested, [
        'chrome-extension://abc/wasm/python.wasm.gz',
        'chrome-extension://abc/clang/res.tar.gz',
    ]);
});

test('목록에 없는 파일과 다른 출처의 요청은 그대로 넘긴다', async () => {
    const fetchAsset = createAssetFetch(['wasm/python.wasm'], () => BASE);
    const { impl, requested } = fakeFetch({
        'intel/ts-libs.json': new TextEncoder().encode('{}'),
    });

    assert.equal(await text(await fetchAsset('intel/ts-libs.json', undefined, impl)), '{}');
    await fetchAsset('https://example.com/wasm/python.wasm', undefined, impl);
    // 이미 .gz로 요청한 것은 다시 바꾸지 않습니다.
    await fetchAsset('wasm/python.wasm.gz', undefined, impl);

    assert.deepEqual(requested, [
        'intel/ts-libs.json',
        'https://example.com/wasm/python.wasm',
        'wasm/python.wasm.gz',
    ]);
});

test('.gz가 없으면 실패한 응답을 그대로 돌려준다', async () => {
    const fetchAsset = createAssetFetch(['wasm/python.wasm'], () => BASE);
    const { impl } = fakeFetch({});
    const response = await fetchAsset('wasm/python.wasm', undefined, impl);
    assert.equal(response.ok, false);
    assert.equal(response.status, 404);
});
