// 확장 빌드 스크립트. `node build.ts` (Node 내장 TS 실행)로 돌립니다.
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const clangPkg = JSON.parse(await readFile('node_modules/@yowasp/clang/package.json', 'utf8')) as {
    version: string;
};
const YOWASP_GEN = 'node_modules/@yowasp/clang/gen';

const manifest = {
    manifest_version: 3,
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
    permissions: ['storage'],
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
};

const entries: esbuild.BuildOptions[] = [
    { entryPoints: { content: 'src/content/boj.ts' } },
    { entryPoints: { 'content-main': 'src/content/boj-main.ts' } },
    { entryPoints: { 'content-problem': 'src/content/problem-page.ts' } },
    { entryPoints: { solver: 'src/solver/solver.ts' } },
    { entryPoints: { 'runner-worker': 'src/runner/worker.ts' } },
    { entryPoints: { sandbox: 'src/sandbox/sandbox.ts' }, plugins: [workerSourcePlugin] },
    {
        // YoWASP 번들은 import.meta.url 기준으로 리소스를 찾으므로 ESM 모듈 워커로 dist/clang/에 둡니다.
        entryPoints: { 'clang/compiler-worker': 'src/runner/compiler-worker.ts' },
        format: 'esm',
        define: { COMPILER_VERSION: JSON.stringify(clangPkg.version) },
    },
];

const copyStatic = async () => {
    await mkdir(`${outdir}/wasm`, { recursive: true });
    await cp('public', outdir, { recursive: true });
    await cp('src/solver/solver.html', `${outdir}/solver.html`);
    await cp('src/sandbox/sandbox.html', `${outdir}/sandbox.html`);
    await mkdir(`${outdir}/clang`, { recursive: true });
    for (const file of await readdir(YOWASP_GEN)) {
        if (file.endsWith('.wasm') || file.endsWith('.tar'))
            await cp(`${YOWASP_GEN}/${file}`, `${outdir}/clang/${file}`);
    }
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
