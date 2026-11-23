// manifest의 sandbox 페이지. eval(new Function)이 허용되는 대신 extension API에 접근할 수 없습니다.
// - JavaScript(node.js): 사용자 코드를 V8로 직접 실행
// - Java: TeaVM 런타임이 new Function을 쓰므로 컴파일과 실행 모두 여기서 합니다.
// 모든 작업은 blob 워커에서 하고, 시간 초과·중단 시 워커를 terminate 합니다.
import prelude from '../runner/node-prelude.js.txt';
import javaCompilerSource from 'worker-source:src/sandbox/java-compiler-worker.ts';
import javaRunSource from 'worker-source:src/sandbox/java-run-worker.ts';
import { jsWorkerMain } from './js-worker.ts';
import type {
    SandboxCompileResponse,
    SandboxRequest,
    SandboxResponse,
    SandboxRunResponse,
} from './protocol.ts';
import type { CompilerResponse, ProcessOutput } from '../runner/types.ts';
import type { JavaCheckDiagnostic } from './java-compiler-worker.ts';

const LOAD_TIMEOUT_MS = 30_000;
const COMPILE_TIMEOUT_MS = 120_000;
const ownerOrigin = new URL(location.href).origin;

const blobURL = (source: string) =>
    URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));

const jsWorkerURL = blobURL(`(${jsWorkerMain.toString()})(${JSON.stringify(prelude)});`);
const javaCompilerURL = blobURL(javaCompilerSource);
const javaRunURL = blobURL(javaRunSource);

const reply = (message: SandboxResponse, transfer: Transferable[] = []) =>
    window.parent.postMessage(message, ownerOrigin, transfer);

// ── 실행 (JS, Java 공통) ────────────────────────────────────────────

type Finish = (r: Omit<SandboxRunResponse, 'kind' | 'id'>) => void;
const running = new Map<number, Finish>();

const run = (req: Extract<SandboxRequest, { type: 'run' }>) => {
    const worker = new Worker(req.language === 'java' ? javaRunURL : jsWorkerURL);
    let timer = window.setTimeout(
        () => finish({ status: 'internal-error', message: '실행기를 시작하지 못했습니다.' }),
        LOAD_TIMEOUT_MS
    );
    let done = false;
    // 실행 중 받은 출력. 시간 초과·중단으로 워커를 종료해도 여기까지는 보여 줍니다.
    const partial = { stdout: '', stderr: '' };
    const partialOutput = (): ProcessOutput => ({ ...partial, exitCode: -1, truncated: false });

    const finish: Finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        worker.terminate();
        running.delete(req.id);
        reply({ kind: 'run', id: req.id, ...result });
    };

    worker.onmessage = (event) => {
        const data = event.data as
            | { type: 'started' }
            | { type: 'output'; stdout: string; stderr: string; reset: boolean }
            | { type: 'error'; message: string }
            | ({ type: 'done'; timeMs: number } & ProcessOutput);
        if (data.type === 'started') {
            clearTimeout(timer);
            timer = window.setTimeout(
                () => finish({ status: 'timeout', timeMs: req.timeoutMs, output: partialOutput() }),
                req.timeoutMs + 100
            );
            return;
        }
        if (data.type === 'output') {
            if (data.reset) partial.stdout = partial.stderr = '';
            partial.stdout += data.stdout;
            partial.stderr += data.stderr;
            return;
        }
        if (data.type === 'error') {
            finish({ status: 'internal-error', message: data.message });
            return;
        }
        const { stdout, stderr, exitCode, truncated, stackOverflow, timeMs } = data;
        finish({
            status: timeMs > req.timeoutMs ? 'timeout' : exitCode === 0 ? 'ok' : 'runtime-error',
            output: { stdout, stderr, exitCode, truncated, stackOverflow },
            timeMs,
        });
    };
    worker.onerror = (event) => {
        event.preventDefault();
        finish({ status: 'internal-error', message: event.message || '워커 오류' });
    };

    running.set(req.id, finish);
    if (req.language === 'java') worker.postMessage({ artifact: req.artifact, stdin: req.stdin });
    else worker.postMessage({ source: req.source, stdin: req.stdin });
};

// ── Java 컴파일 ─────────────────────────────────────────────────────

let javaAssets: { wasm: ArrayBuffer; sdk: ArrayBuffer; classlib: ArrayBuffer } | null = null;
let compiler: Worker | null = null;
let nextCompileId = 1;
const compiles = new Map<number, (r: CompilerResponse | null) => void>();
/** 진행 중인 컴파일 수 (중단할 때 컴파일러를 끊을지 판단) */
let compilingNow = 0;

const getCompiler = () => {
    if (compiler) return compiler;
    if (!javaAssets) throw new Error('Java 컴파일러 파일을 받지 못했습니다.');
    const worker = new Worker(javaCompilerURL);
    worker.onmessage = (event: MessageEvent<CompilerResponse>) => {
        const resolve = compiles.get(event.data.id);
        if (!resolve) return;
        compiles.delete(event.data.id);
        resolve(event.data);
    };
    worker.onerror = (event) => {
        event.preventDefault();
        for (const [id, resolve] of compiles)
            resolve({ type: 'error', id, message: event.message || '컴파일러 워커 오류' });
        compiles.clear();
    };
    // 복사해서 넘깁니다. (워커를 다시 만들 때 또 써야 함)
    worker.postMessage({ type: 'assets', ...javaAssets });
    compiler = worker;
    return worker;
};

const compileJava = async (req: Extract<SandboxRequest, { type: 'java-compile' }>) => {
    const done = (r: Omit<SandboxCompileResponse, 'kind' | 'id'>) =>
        reply(
            { kind: 'compile', id: req.id, ...r },
            r.artifact ? [r.artifact.buffer as ArrayBuffer] : []
        );
    let worker: Worker;
    try {
        worker = getCompiler();
    } catch (error) {
        done({ ok: false, diagnostics: error instanceof Error ? error.message : String(error) });
        return;
    }
    const id = nextCompileId++;
    compilingNow++;
    const res = await new Promise<CompilerResponse | null>((resolve) => {
        const timer = setTimeout(() => {
            compiles.delete(id);
            resolve(null);
        }, COMPILE_TIMEOUT_MS);
        compiles.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
        });
        worker.postMessage({ type: 'compile', id, source: req.source, std: '' });
    });
    compilingNow--;
    if (!res) {
        worker.terminate();
        if (compiler === worker) compiler = null;
        done({ ok: false, diagnostics: '컴파일이 중단되었거나 시간이 초과되었습니다.' });
    } else if (res.type === 'compile') {
        done({ ok: res.ok, artifact: res.artifact, diagnostics: res.diagnostics });
    } else if (res.type === 'error') {
        done({ ok: false, diagnostics: res.message });
    }
};

/** 실시간 진단: javac만 실행 (컴파일 워커를 같이 씀) */
const checkJava = async (req: Extract<SandboxRequest, { type: 'java-check' }>) => {
    let worker: Worker;
    try {
        worker = getCompiler();
    } catch {
        reply({ kind: 'check', id: req.id, diagnostics: [] });
        return;
    }
    const id = nextCompileId++;
    const res = await new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => {
            compiles.delete(id);
            resolve(null);
        }, 30_000);
        compiles.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
        });
        worker.postMessage({ type: 'check', id, source: req.source });
    });
    const diagnostics = (res as { diagnostics?: JavaCheckDiagnostic[] } | null)?.diagnostics ?? [];
    reply({ kind: 'check', id: req.id, diagnostics });
};

// ── 메시지 ──────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent<SandboxRequest>) => {
    if (event.source !== window.parent || event.origin !== ownerOrigin) return;
    const req = event.data;
    switch (req.type) {
        case 'run':
            run(req);
            break;
        case 'java-assets':
            javaAssets = { wasm: req.wasm, sdk: req.sdk, classlib: req.classlib };
            getCompiler(); // 미리 로딩
            break;
        case 'java-compile':
            void compileJava(req);
            break;
        case 'java-check':
            void checkJava(req);
            break;
        case 'cancel':
            for (const finish of [...running.values()]) finish({ status: 'cancelled' });
            // 컴파일 중이면 컴파일러를 끊습니다. (javac는 중간에 멈출 방법이 없어 워커째 끝냄)
            // 다음 컴파일 때 새로 만들며, 실시간 진단도 같은 워커라 함께 끝납니다.
            if (compilingNow > 0 && compiler) {
                compiler.terminate();
                compiler = null;
                for (const resolve of [...compiles.values()]) resolve(null);
                compiles.clear();
            }
            break;
    }
});

reply({ kind: 'ready' });
