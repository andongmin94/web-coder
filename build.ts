// 확장 빌드 스크립트. `node build.ts` (Node 내장 TS 실행)로 돌립니다.
import * as esbuild from 'esbuild';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const clangPkg = JSON.parse(await readFile('node_modules/@yowasp/clang/package.json', 'utf8')) as {
    version: string;
};
const YOWASP_GEN = 'node_modules/@yowasp/clang/gen';

/** 설치 용량을 줄이려고 gzip으로 담는 큰 리소스 (dist 기준 경로). 불러올 때 풀어 씁니다. */
const GZIP_ASSETS = [
    'clang/llvm.core.wasm',
    'clang/llvm-resources.tar',
    'clang-eh/libc++.a',
    'clang-eh/libc++abi.a',
    // 아래는 shared/assets.ts의 fetchAsset이 풀어 씁니다.
    'wasm/python-3.13.17.wasm',
    'wasm/quickjs-0.18.0.wasm',
    'java/compiler.wasm',
    'format/clang-format.wasm',
    'format/ruff_fmt_bg.wasm',
];

const manifest = {
    manifest_version: 3,
    // WasmGC(Java 실행)와 esbuild 대상(chrome120). 더 낮으면 설치는 되지만 실행 중에 실패합니다.
    minimum_chrome_version: '120',
    name: '웹 코더',
    description: '백준 제출 페이지에서 바로 실행하고 제출하는 로컬 코드 에디터',
    version: pkg.version,
    icons: {
        16: 'asset/icon16.png',
        32: 'asset/icon32.png',
        48: 'asset/icon48.png',
        128: 'asset/icon128.png',
    },
    content_scripts: [
        {
            matches: ['https://acmicpc.net/submit/*', 'https://www.acmicpc.net/submit/*'],
            js: ['content.js'],
            run_at: 'document_idle',
        },
        {
            matches: ['https://acmicpc.net/submit/*', 'https://www.acmicpc.net/submit/*'],
            js: ['content-main.js'],
            run_at: 'document_idle',
            world: 'MAIN',
        },
        {
            // 채점 현황 등의 "수정"(다시 제출) 링크가 웹 코더로 열리게 합니다. (같은 사이트라 권한은 그대로)
            matches: ['https://acmicpc.net/*', 'https://www.acmicpc.net/*'],
            js: ['content-links.js'],
            run_at: 'document_idle',
        },
        {
            // 문제 페이지에서 본문/예제를 저장해 둡니다. (BOJ는 fetch/iframe 요청에 빈 응답을 줌)
            matches: ['https://acmicpc.net/problem/*', 'https://www.acmicpc.net/problem/*'],
            js: ['content-problem.js'],
            run_at: 'document_idle',
        },
    ],
    web_accessible_resources: [
        {
            // sandbox.html은 솔버(확장 페이지)가 띄우지만, 최상위가 BOJ 페이지라 웹 접근 허용이 필요합니다.
            // sandbox는 부모가 확장 페이지일 때만 메시지를 처리합니다.
            resources: ['solver.html', 'sandbox.html'],
            matches: ['https://acmicpc.net/*', 'https://www.acmicpc.net/*'],
        },
    ],
    // JS 실행, Java 컴파일·실행용: sandbox 페이지는 eval이 허용되는 대신 extension API에 접근할 수 없습니다.
    sandbox: {
        pages: ['sandbox.html'],
    },
    // unlimitedStorage: 문제·코드·큰 내 테스트를 저장하다 10MB 한도에 걸려 저장이 조용히 실패하지 않게
    permissions: ['storage', 'unlimitedStorage'],
    content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
        sandbox:
            "sandbox allow-scripts; script-src 'self' 'unsafe-eval' blob:; worker-src blob:; child-src blob:; object-src 'none'",
    },
};

/**
 * `import src from 'worker-source:<경로>'` → 해당 파일을 번들한 결과를 문자열로 가져옵니다.
 * sandbox 페이지는 확장 리소스를 직접 못 읽어서, 워커 코드를 blob으로 띄우기 위해 씁니다.
 */
const workerSourcePlugin: esbuild.Plugin = {
    name: 'worker-source',
    setup(build) {
        build.onResolve({ filter: /^worker-source:/ }, (args) => ({
            path: args.path.slice('worker-source:'.length),
            namespace: 'worker-source',
        }));
        build.onLoad({ filter: /.*/, namespace: 'worker-source' }, async (args) => {
            const result = await esbuild.build({
                entryPoints: [args.path],
                bundle: true,
                write: false,
                format: 'iife',
                target: 'chrome120',
                minify: !watch,
                loader: { '.txt': 'text' },
                external: ['node:*'],
            });
            return {
                contents: result.outputFiles[0].text,
                loader: 'text',
                watchFiles: [args.path],
            };
        });
    },
};

const common: esbuild.BuildOptions = {
    bundle: true,
    outdir,
    target: 'chrome120',
    format: 'iife',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    logLevel: 'info',
    loader: { '.txt': 'text', '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
    assetNames: 'assets/[name]-[hash]',
    // 번들된 런타임(TeaVM, YoWASP)의 Node 전용 분기는 브라우저에서 실행되지 않습니다.
    external: ['node:*'],
    define: { GZIP_ASSETS: JSON.stringify(GZIP_ASSETS) },
};

const entries: esbuild.BuildOptions[] = [
    { entryPoints: { content: 'src/content/boj.ts' } },
    { entryPoints: { 'content-main': 'src/content/boj-main.ts' } },
    { entryPoints: { 'content-problem': 'src/content/problem-page.ts' } },
    { entryPoints: { 'content-links': 'src/content/links.ts' } },
    { entryPoints: { solver: 'src/solver/solver.ts' } },
    { entryPoints: { 'runner-worker': 'src/runner/worker.ts' } },
    { entryPoints: { sandbox: 'src/sandbox/sandbox.ts' }, plugins: [workerSourcePlugin] },
    {
        // YoWASP 번들은 import.meta.url 기준으로 리소스를 찾으므로 ESM 모듈 워커로 dist/clang/에 둡니다.
        entryPoints: { 'clang/compiler-worker': 'src/runner/compiler-worker.ts' },
        format: 'esm',
        define: {
            COMPILER_VERSION: JSON.stringify(clangPkg.version),
            GZIP_ASSETS: JSON.stringify(GZIP_ASSETS),
        },
    },
    {
        // node.js 인텔리센스: TypeScript 언어 서비스. Node 전용 분기의 require는 브라우저에서 실행되지 않습니다.
        entryPoints: { 'intel/ts-worker': 'src/intel/ts-worker.ts' },
        external: [
            'node:*',
            'fs',
            'path',
            'os',
            'crypto',
            'inspector',
            'perf_hooks',
            'module',
            'source-map-support',
            'buffer',
            'util',
        ],
    },
];

/** TypeScript 표준 라이브러리 타입(lib.es2022 계열)을 하나의 JSON으로 */
const buildTsLibs = async () => {
    const dir = 'node_modules/typescript-js/lib';
    const libs: Record<string, string> = {};
    const visit = async (name: string) => {
        if (libs[name]) return;
        const text = await readFile(`${dir}/${name}`, 'utf8');
        libs[name] = text;
        for (const m of text.matchAll(/\/\/\/\s*<reference lib="([^"]+)"\s*\/>/g))
            await visit(`lib.${m[1].toLowerCase()}.d.ts`);
    };
    await visit('lib.es2022.d.ts');
    await writeFile(`${outdir}/intel/ts-libs.json`, JSON.stringify(libs));
};

/** Pyright용 typeshed 표준 라이브러리(엔진 버전과 같은 pyright@1.1.299의 typeshed) */
const buildTypeshed = async () => {
    const root = 'node_modules/pyright/dist/typeshed-fallback/stdlib';
    const files: Record<string, string> = {};
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const path = `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/');
        if (!path.endsWith('.pyi') && !path.endsWith('/VERSIONS')) continue;
        files[`/typeshed/stdlib/${path.slice(root.length + 1)}`] = await readFile(path, 'utf8');
    }
    await writeFile(`${outdir}/intel/typeshed-stdlib.json`, JSON.stringify(files));
};

/**
 * Java 자동완성 색인: javac SDK의 클래스 시그니처. 컴파일 검사(pool.ts)와 같은 SDK를 쓰도록
 * 버전마다 따로 만듭니다. (Java 8을 골랐는데 String.repeat 같은 11+ API를 제안하지 않게)
 * java-index.json은 버전을 고르지 않는 Java(최신), java-index-8.json 등은 그 버전.
 */
const buildJavaIndexFile = async () => {
    const { readArchive } = await import('./tools/java/classlib-archive.mjs');
    const { buildJavaIndex } = await import('./src/intel/classfile.ts');
    const { JAVA_RELEASES } = await import('./src/shared/languages.ts');
    await Promise.all(
        ['', ...JAVA_RELEASES].map(async (release) => {
            const suffix = release ? `-${release}` : '';
            const { entries } = readArchive(
                await readFile(`public/java/compile-classlib${suffix}.bin`)
            );
            await writeFile(
                `${outdir}/intel/java-index${suffix}.json`,
                JSON.stringify(buildJavaIndex(entries))
            );
        })
    );
};

const gzipAssets = () =>
    Promise.all(
        GZIP_ASSETS.map(async (path) => {
            const file = `${outdir}/${path}`;
            await pipeline(
                createReadStream(file),
                createGzip({ level: 9 }),
                createWriteStream(`${file}.gz`)
            );
            await rm(file);
        })
    );

const copyStatic = async () => {
    await mkdir(`${outdir}/wasm`, { recursive: true });
    await cp('public', outdir, { recursive: true });
    // 원본 아이콘(크기별 아이콘을 만드는 데 씀)과 README용 로고는 확장에 필요 없습니다.
    await rm(`${outdir}/asset/icon.png`);
    await rm(`${outdir}/logo.svg`);
    // Python의 C 재귀 한도를 늘립니다. (src/runner/python-patch.ts)
    const { patchPython } = await import('./src/runner/python-patch.ts');
    const pythonWasm = `${outdir}/wasm/python-3.13.17.wasm`;
    await writeFile(pythonWasm, patchPython(new Uint8Array(await readFile(pythonWasm))));
    // 라이선스: public/licenses/의 원문에 npm 패키지에 들어 있는 것을 더합니다. (README.txt에 목록)
    await cp('node_modules/typescript-js/LICENSE.txt', `${outdir}/licenses/Apache-2.0.txt`);
    await cp(
        'node_modules/pyright/dist/typeshed-fallback/LICENSE',
        `${outdir}/licenses/typeshed-LICENSE.txt`
    );
    await cp('src/solver/solver.html', `${outdir}/solver.html`);
    await cp('src/sandbox/sandbox.html', `${outdir}/sandbox.html`);
    await mkdir(`${outdir}/clang`, { recursive: true });
    for (const file of await readdir(YOWASP_GEN)) {
        if (file.endsWith('.wasm') || file.endsWith('.tar'))
            await cp(`${YOWASP_GEN}/${file}`, `${outdir}/clang/${file}`);
    }
    await mkdir(`${outdir}/intel`, { recursive: true });
    await cp(
        'node_modules/@typefox/pyright-browser/dist/pyright.worker.js',
        `${outdir}/intel/pyright.worker.js`
    );
    await cp(
        'node_modules/@typefox/pyright-browser/dist/pyright.worker.js.LICENSE.txt',
        `${outdir}/intel/pyright.worker.js.LICENSE.txt`
    );
    // 코드 정렬 (solver/format.ts): clang-format, Ruff 포매터 wasm
    await mkdir(`${outdir}/format`, { recursive: true });
    for (const [pkgDir, files] of [
        ['node_modules/@wasm-fmt/clang-format', ['clang-format.wasm', 'LICENSE']],
        ['node_modules/@wasm-fmt/ruff_fmt', ['ruff_fmt_bg.wasm', 'LICENSE']],
    ] as const) {
        for (const file of files) {
            const target = file === 'LICENSE' ? `${pkgDir.split('/').pop()}-LICENSE.txt` : file;
            await cp(`${pkgDir}/${file}`, `${outdir}/format/${target}`);
        }
    }
    await Promise.all([buildTsLibs(), buildTypeshed(), buildJavaIndexFile(), gzipAssets()]);
    await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
};

await rm(outdir, { recursive: true, force: true });
await copyStatic();

if (watch) {
    for (const entry of entries) {
        const ctx = await esbuild.context({ ...common, ...entry });
        await ctx.watch();
    }
    console.log('watching… (정적 파일은 재시작 시 복사됩니다)');
} else {
    await Promise.all(entries.map((entry) => esbuild.build({ ...common, ...entry })));
}
