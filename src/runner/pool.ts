// 메인(솔버 페이지) 쪽 실행 관리자.
// - C++: 컴파일 워커(YoWASP clang)에서 한 번만 컴파일, 결과 wasm을 모든 테스트에 재사용
//        bits/stdc++.h PCH가 없으면 별도 워커에서 만들어 IndexedDB에 저장
// - C++ 결과물/Python: 실행 워커 풀에서 병렬 실행, 시간 초과 시 terminate 후 교체
// - JavaScript: sandbox 페이지(eval 허용)의 워커에서 V8로 실행
//               재귀가 깊어 스택이 넘치면 실행 워커의 QuickJS 깊은 재귀 모드로 다시 실행 (node-deep.ts)
import { JAVA_RELEASES, type ResolvedLanguage } from '../shared/languages.ts';
import type {
    SandboxCheckResponse,
    SandboxCompileResponse,
    SandboxRequest,
    SandboxResponse,
    SandboxRunResponse,
} from '../sandbox/protocol.ts';
import { usesBitsStdcxx, usesExceptions } from './cpp-header.ts';
import { jspi } from './jspi.ts';
import type {
    CompilerRequest,
    CompilerResponse,
    RunRequest,
    RunResult,
    WorkerResponse,
} from './types.ts';

const RUNNER_URL = 'runner-worker.js';
const CPP_COMPILER_URL = 'clang/compiler-worker.js';
const SANDBOX_URL = 'sandbox.html';
/** 런타임 로딩(수십 MB wasm 컴파일)에 허용하는 시간 */
const LOAD_TIMEOUT_MS = 90_000;
const COMPILE_TIMEOUT_MS = 120_000;
/** 컴파일 전에 PCH 생성을 기다려 주는 최대 시간 (넘으면 PCH 없이 컴파일) */
const PCH_WAIT_MS = 60_000;
const SANDBOX_READY_TIMEOUT_MS = 10_000;

const EMPTY_OUTPUT = { stdout: '', stderr: '', exitCode: -1, truncated: false };

/** V8의 호출 스택 한계로 끝난 node.js 실행인지 (사용자가 잡지 않은 RangeError, js-worker가 표시) */
const isJsStackOverflow = (result: RunResult) =>
    result.status === 'runtime-error' && result.output.stackOverflow === true;

const NODE_DEEP_NOTICE =
    '재귀가 깊어 브라우저의 호출 스택이 넘쳤기 때문에 깊은 재귀 모드(QuickJS)로 다시 실행했습니다. ' +
    '백준(node --stack-size=65536)에서는 통과하는 깊이입니다. 이 모드는 실제 node.js보다 느려서 실행 시간은 참고용입니다.';

type Final<T> = Exclude<T, { type: 'started' } | { type: 'output' }>;
/** 실행 중 받은 출력 (시간 초과 시 보여 줄 부분 출력) */
type Partial = { stdout: string; stderr: string };
type TimedOut = { type: 'timeout'; partial: Partial };

const partialOutput = (partial: Partial) => ({
    stdout: partial.stdout,
    stderr: partial.stderr,
    exitCode: -1,
    truncated: false,
});
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

// ── 실행 워커 ────────────────────────────────────────────────────────

class RunnerWorker {
    readonly worker = new Worker(RUNNER_URL);
    busy = false;
    /** 워커에서 잡히지 않은 오류가 났음: 상태를 믿을 수 없으니 다시 쓰지 않습니다. */
    crashed = false;
    private nextId = 1;
    private pending = new Map<
        number,
        {
            resolve: (r: Final<WorkerResponse> | null) => void;
            onStarted: () => void;
            partial: Partial;
        }
    >();

    constructor() {
        this.worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
            const p = this.pending.get(e.data.id);
            if (!p) return;
            if (e.data.type === 'started') {
                p.onStarted();
                return;
            }
            if (e.data.type === 'output') {
                if (e.data.reset) p.partial.stdout = p.partial.stderr = '';
                p.partial.stdout += e.data.stdout;
                p.partial.stderr += e.data.stderr;
                return;
            }
            this.pending.delete(e.data.id);
            p.resolve(e.data);
        });
        this.worker.addEventListener('error', (e) => {
            e.preventDefault();
            this.crashed = true;
            for (const [id, p] of this.pending)
                p.resolve({ type: 'error', id, message: e.message || '워커 오류' });
            this.pending.clear();
        });
    }

    warmUp(runtime: string) {
        this.worker.postMessage({ type: 'warmup', runtime });
    }

    /**
     * 처음엔 loadTimeoutMs, 워커가 'started'를 알리면 그때부터 runTimeoutMs로 다시 잽니다.
     * 시간이 넘으면 그때까지 받은 출력과 함께 'timeout', 워커가 종료되면 null.
     */
    request(message: Record<string, unknown>, loadTimeoutMs: number, runTimeoutMs: number) {
        const id = this.nextId++;
        return new Promise<Final<WorkerResponse> | TimedOut | null>((resolve) => {
            const partial: Partial = { stdout: '', stderr: '' };
            const expire = () => {
                this.pending.delete(id);
                resolve({ type: 'timeout', partial });
            };
            let timer = setTimeout(expire, loadTimeoutMs);
            this.pending.set(id, {
                resolve: (r) => {
                    clearTimeout(timer);
                    resolve(r);
                },
                onStarted: () => {
                    clearTimeout(timer);
                    timer = setTimeout(expire, runTimeoutMs);
                },
                partial,
            });
            this.worker.postMessage({ ...message, id });
        });
    }

    terminate() {
        this.worker.terminate();
        for (const p of this.pending.values()) p.resolve(null);
        this.pending.clear();
    }
}

// ── 컴파일 워커 (C++: YoWASP clang, Java: teavm-javac) ───────────────

class CompilerWorker {
    readonly worker: Worker;
    private nextId = 1;
    private pending = new Map<number, (r: CompilerResponse | null) => void>();

    constructor(url: string, options?: WorkerOptions) {
        this.worker = new Worker(url, options);
        this.worker.addEventListener('message', (e: MessageEvent<CompilerResponse>) => {
            const resolve = this.pending.get(e.data.id);
            if (!resolve) return;
            this.pending.delete(e.data.id);
            resolve(e.data);
        });
        this.worker.addEventListener('error', (e) => {
            e.preventDefault();
            for (const [id, resolve] of this.pending)
                resolve({ type: 'error', id, message: e.message || '컴파일러 워커 오류' });
            this.pending.clear();
        });
    }

    send(message: CompilerRequest) {
        this.worker.postMessage(message);
    }

    request(message: WithoutId<Extract<CompilerRequest, { id: number }>>, timeoutMs: number) {
        const id = this.nextId++;
        return new Promise<CompilerResponse | null>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve(null);
            }, timeoutMs);
            this.pending.set(id, (r) => {
                clearTimeout(timer);
                resolve(r);
            });
            this.worker.postMessage({ ...message, id });
        });
    }

    terminate() {
        this.worker.terminate();
        for (const resolve of this.pending.values()) resolve(null);
        this.pending.clear();
    }
}

// ── sandbox (eval 허용: JavaScript 실행, Java 컴파일·실행) ─────────────

const JAVA_ASSETS = {
    wasm: 'java/compiler.wasm',
    /** javac SDK: 버전별로 거른 것과 제한 없는 것('') */
    sdks: {
        '': 'java/compile-classlib.bin',
        ...Object.fromEntries(JAVA_RELEASES.map((r) => [r, `java/compile-classlib-${r}.bin`])),
    } as Record<string, string>,
    classlib: 'java/runtime-classlib.bin',
};

class Sandbox {
    private frame: HTMLIFrameElement;
    /** sandbox 페이지가 준비됐다는 신호 (한 번 오면 계속 true) */
    private isReady = false;
    private readyPromise: Promise<true>;
    /** cancelAll 횟수. 준비를 기다리던 실행이 그사이 중단됐는지 알아보는 데 씁니다. */
    private cancelSeq = 0;
    private javaAssetsSent: Promise<void> | null = null;
    private nextId = 1;
    private pending = new Map<
        number,
        (r: SandboxRunResponse | SandboxCompileResponse | SandboxCheckResponse) => void
    >();

    constructor() {
        this.frame = document.createElement('iframe');
        this.frame.src = SANDBOX_URL;
        this.frame.hidden = true;
        this.frame.setAttribute('sandbox', 'allow-scripts');
        let markReady!: () => void;
        this.readyPromise = new Promise((r) => {
            markReady = () => {
                this.isReady = true;
                r(true);
            };
        });
        window.addEventListener('message', (e: MessageEvent<SandboxResponse>) => {
            if (e.source !== this.frame.contentWindow) return;
            if (e.data.kind === 'ready') {
                markReady();
                return;
            }
            const resolve = this.pending.get(e.data.id);
            if (!resolve) return;
            this.pending.delete(e.data.id);
            resolve(e.data);
        });
        document.body.appendChild(this.frame);
    }

    /**
     * 준비될 때까지 기다리되, 이번 요청은 SANDBOX_READY_TIMEOUT_MS까지만 기다립니다.
     * (느린 PC에서 늦게 준비돼도 다음 요청부터는 정상으로 돌도록 영구 실패로 만들지 않습니다)
     */
    private waitReady(): Promise<boolean> {
        if (this.isReady) return Promise.resolve(true);
        return Promise.race([
            this.readyPromise,
            new Promise<false>((r) => setTimeout(() => r(false), SANDBOX_READY_TIMEOUT_MS)),
        ]);
    }

    private post(message: SandboxRequest, transfer: Transferable[] = []) {
        // sandbox 페이지는 opaque origin이라 targetOrigin을 '*'로 보냅니다. (받는 쪽은 frame이 고정)
        this.frame.contentWindow?.postMessage(message, '*', transfer);
    }

    /** Java 컴파일러 파일을 읽어 sandbox로 넘깁니다. (sandbox는 확장 리소스를 직접 못 읽음) */
    prepareJava() {
        this.javaAssetsSent ??= (async () => {
            if (!(await this.waitReady())) throw new Error('sandbox 페이지를 불러오지 못했습니다.');
            const read = async (path: string) => {
                const response = await fetch(path);
                if (!response.ok) throw new Error(`${path}를 불러오지 못했습니다.`);
                return response.arrayBuffer();
            };
            const releases = Object.keys(JAVA_ASSETS.sdks);
            const [wasm, classlib, ...sdkList] = await Promise.all([
                read(JAVA_ASSETS.wasm),
                read(JAVA_ASSETS.classlib),
                ...releases.map((r) => read(JAVA_ASSETS.sdks[r])),
            ]);
            const sdks = Object.fromEntries(releases.map((r, i) => [r, sdkList[i]]));
            this.post({ type: 'java-assets', wasm, sdks, classlib }, [wasm, classlib, ...sdkList]);
        })();
        this.javaAssetsSent.catch(() => (this.javaAssetsSent = null));
        return this.javaAssetsSent;
    }

    private request<T extends SandboxRunResponse | SandboxCompileResponse | SandboxCheckResponse>(
        build: (id: number) => SandboxRequest,
        timeoutMs: number,
        onTimeout: (id: number) => T,
        transfer: Transferable[] = []
    ) {
        const id = this.nextId++;
        return new Promise<T>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve(onTimeout(id));
            }, timeoutMs);
            this.pending.set(id, (r) => {
                clearTimeout(timer);
                resolve(r as T);
            });
            this.post(build(id), transfer);
        });
    }

    async compileJava(source: string, release: string): Promise<CompileOutcome> {
        try {
            await this.prepareJava();
        } catch (error) {
            return {
                ok: false,
                diagnostics: error instanceof Error ? error.message : String(error),
            };
        }
        const res = await this.request<SandboxCompileResponse>(
            (id) => ({ type: 'java-compile', id, source, release }),
            COMPILE_TIMEOUT_MS + 15_000,
            (id) => ({
                kind: 'compile',
                id,
                ok: false,
                diagnostics: 'Java 컴파일러가 응답하지 않습니다.',
            })
        );
        return res.ok && res.artifact
            ? { ok: true, artifact: res.artifact, diagnostics: res.diagnostics }
            : { ok: false, diagnostics: res.diagnostics };
    }

    /** Java 실시간 진단 (javac만) */
    async checkJava(source: string, release: string) {
        try {
            await this.prepareJava();
        } catch {
            return [];
        }
        const res = await this.request<SandboxCheckResponse>(
            (id) => ({ type: 'java-check', id, source, release }),
            45_000,
            (id) => ({ kind: 'check', id, diagnostics: [] })
        );
        return res.diagnostics;
    }

    async run(
        language: 'javascript' | 'java',
        payload: { source: string; artifact?: Uint8Array },
        stdin: string,
        timeoutMs: number
    ): Promise<RunResult> {
        const cancelSeq = this.cancelSeq;
        const ready = await this.waitReady();
        // 준비를 기다리는 사이 중단했으면 실행하지 않습니다. (준비 전 보낸 중단 신호는 받을 곳이 없음)
        if (cancelSeq !== this.cancelSeq)
            return { status: 'cancelled', output: EMPTY_OUTPUT, timeMs: 0 };
        if (!ready) {
            return {
                status: 'internal-error',
                output: EMPTY_OUTPUT,
                timeMs: 0,
                message: '실행기(sandbox 페이지)를 불러오지 못했습니다.',
            };
        }
        const res = await this.request<SandboxRunResponse>(
            (id) =>
                language === 'java'
                    ? { type: 'run', id, language, artifact: payload.artifact!, stdin, timeoutMs }
                    : { type: 'run', id, language, source: payload.source, stdin, timeoutMs },
            // sandbox가 응답하지 않는 경우를 대비한 안전장치
            timeoutMs + LOAD_TIMEOUT_MS,
            (id) => ({
                kind: 'run',
                id,
                status: 'internal-error',
                message: '실행기가 응답하지 않습니다.',
            })
        );
        return {
            status: res.status,
            output: res.output ?? EMPTY_OUTPUT,
            timeMs: res.timeMs ?? 0,
            message: res.message,
        };
    }

    cancelAll() {
        this.cancelSeq++;
        this.post({ type: 'cancel' });
    }
}

// ── 풀 ───────────────────────────────────────────────────────────────

export type CompileOutcome =
    | { ok: true; artifact?: Uint8Array; diagnostics: string }
    | { ok: false; diagnostics: string };

export class RunnerPool {
    private workers: RunnerWorker[] = [];
    private compiler: CompilerWorker | null = null;
    /** 표준 버전별 PCH 만들기 작업 (이미 있으면 바로 끝남) */
    private pchBuilds = new Map<string, Promise<void>>();
    private compileCache: { key: string; outcome: Promise<CompileOutcome> } | null = null;
    private sandboxInstance: Sandbox | null = null;
    private waiters: Array<() => void> = [];
    private generation = 0;
    private readonly size: number;

    constructor(
        size = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)))
    ) {
        this.size = size;
    }

    private static createCppCompiler() {
        return new CompilerWorker(CPP_COMPILER_URL, { type: 'module' });
    }

    private getCompiler() {
        if (!this.compiler) {
            this.compiler = RunnerPool.createCppCompiler();
            this.compiler.send({ type: 'warmup' });
        }
        return this.compiler;
    }

    private get sandbox() {
        this.sandboxInstance ??= new Sandbox();
        return this.sandboxInstance;
    }

    /** 언어를 고르면 미리 런타임을 로드해 둡니다. */
    warmUp(lang: ResolvedLanguage) {
        if (lang.runtime === 'cpp') {
            this.getCompiler();
            // 코드를 쓰는 동안 미리 만들어 둡니다. (처음 한 번만 몇 초 걸림)
            if (lang.cppStd) void this.buildPch(lang.cppStd, false);
            return;
        }
        if (lang.runtime === 'java') {
            void this.sandbox.prepareJava().catch(() => {});
            return;
        }
        if (lang.runtime === 'javascript') {
            void this.sandbox;
            return;
        }
        while (this.workers.length < this.size) this.workers.push(new RunnerWorker());
        for (const w of this.workers) w.warmUp(lang.runtime);
    }

    /**
     * bits/stdc++.h PCH를 별도 워커에서 만들어 IndexedDB에 저장합니다. 이미 있으면 바로 끝납니다.
     * 실패해도 PCH 없이 컴파일하면 되므로 예외를 던지지 않습니다.
     */
    private buildPch(std: string, exceptions: boolean) {
        const key = `${std}:${exceptions}`;
        let build = this.pchBuilds.get(key);
        if (!build) {
            const builder = RunnerPool.createCppCompiler();
            build = builder
                .request({ type: 'build-pch', std, exceptions }, 5 * 60_000)
                .then((res) => {
                    // 실패했거나 응답이 없었으면 다음 컴파일 때 다시 시도합니다.
                    if (!res || res.type === 'error') this.pchBuilds.delete(key);
                })
                .finally(() => builder.terminate());
            this.pchBuilds.set(key, build);
        }
        return build;
    }

    /** C++/Java 컴파일 (같은 소스면 캐시). 다른 언어는 바로 ok. */
    compile(lang: ResolvedLanguage, source: string): Promise<CompileOutcome> {
        if (lang.runtime !== 'cpp' && lang.runtime !== 'java') {
            return Promise.resolve({ ok: true, diagnostics: '' });
        }
        const kind = lang.runtime;
        const std = lang.cppStd ?? lang.javaRelease ?? '';
        const key = `${kind}\u0000${std}\u0000${source}`;
        if (this.compileCache?.key === key) return this.compileCache.outcome;

        if (kind === 'java') {
            const outcome = this.sandbox.compileJava(source, std);
            this.cacheCompile(key, outcome);
            return outcome;
        }

        const outcome = (async (): Promise<CompileOutcome> => {
            const compiler = this.getCompiler();
            // PCH 없이 컴파일하면 헤더를 처음부터 읽느라 10초쯤 걸립니다. 만드는 중이면 기다렸다가 씁니다.
            // (PCH 워커가 멈춰도 컴파일까지 붙잡히지 않게 기다리는 시간에 상한을 둡니다)
            if (usesBitsStdcxx(source))
                await Promise.race([
                    this.buildPch(std, usesExceptions(source)),
                    new Promise((r) => setTimeout(r, PCH_WAIT_MS)),
                ]);
            const res = await compiler.request(
                { type: 'compile', source, std },
                COMPILE_TIMEOUT_MS
            );
            if (!res) {
                compiler.terminate();
                if (this.compiler === compiler) this.compiler = null;
                return { ok: false, diagnostics: '컴파일이 중단되었거나 시간이 초과되었습니다.' };
            }
            if (res.type === 'error') return { ok: false, diagnostics: res.message };
            if (res.type !== 'compile') return { ok: false, diagnostics: '알 수 없는 응답' };
            if (res.needsPch) void this.buildPch(std, usesExceptions(source));
            return res.ok && res.artifact
                ? { ok: true, artifact: res.artifact, diagnostics: res.diagnostics }
                : { ok: false, diagnostics: res.diagnostics };
        })();

        this.cacheCompile(key, outcome);
        return outcome;
    }

    /** C++ 인텔리센스 (자동완성/진단): clang 출력 원문. 실패하면 null */
    async cppAnalyze(
        message:
            | {
                  type: 'complete';
                  source: string;
                  std: string;
                  line: number;
                  col: number;
                  memberOnly: boolean;
              }
            | { type: 'diagnose'; source: string; std: string },
        timeoutMs = 20_000
    ): Promise<string | null> {
        const res = await this.getCompiler().request(message, timeoutMs);
        if (!res || res.type !== 'intel') return null;
        if (res.needsPch) void this.buildPch(message.std, usesExceptions(message.source));
        return res.output;
    }

    /** Java 실시간 진단 (javac만, WebAssembly 생성 없음) */
    javaCheck(source: string, release: string) {
        return this.sandbox.checkJava(source, release);
    }

    private cacheCompile(key: string, outcome: Promise<CompileOutcome>) {
        this.compileCache = { key, outcome };
        void outcome.then((o) => {
            if (!o.ok && this.compileCache?.outcome === outcome) this.compileCache = null;
        });
    }

    private async acquire(generation: number): Promise<RunnerWorker | null> {
        for (;;) {
            if (generation !== this.generation) return null;
            let worker = this.workers.find((w) => !w.busy);
            if (!worker && this.workers.length < this.size) {
                worker = new RunnerWorker();
                this.workers.push(worker);
            }
            if (worker) {
                worker.busy = true;
                return worker;
            }
            await new Promise<void>((r) => this.waiters.push(r));
        }
    }

    private release(worker: RunnerWorker, broken: boolean) {
        if (broken || worker.crashed) {
            worker.terminate();
            this.workers = this.workers.filter((w) => w !== worker);
        } else {
            worker.busy = false;
        }
        this.waiters.shift()?.();
    }

    async run(
        lang: ResolvedLanguage,
        payload: { source: string; artifact?: Uint8Array },
        stdin: string,
        timeoutMs: number
    ): Promise<RunResult> {
        if (lang.runtime === 'java') {
            return this.sandbox.run(lang.runtime, payload, stdin, timeoutMs);
        }
        if (lang.runtime === 'javascript') {
            // 깊은 재귀로 V8 스택이 넘친 코드는 QuickJS 깊은 재귀 모드로 다시 실행합니다. (node-deep.ts)
            // 한 번 넘친 소스의 다음 테스트는 넘칠 첫 시도를 건너뜁니다.
            if (!jspi() || this.deepJsSource !== payload.source) {
                const first = await this.sandbox.run(lang.runtime, payload, stdin, timeoutMs);
                if (!jspi() || !isJsStackOverflow(first)) return first;
                this.deepJsSource = payload.source;
            }
            const deep = await this.runInWorker('javascript', payload, stdin, timeoutMs);
            return deep.status === 'cancelled' ? deep : { ...deep, notice: NODE_DEEP_NOTICE };
        }
        return this.runInWorker(lang.runtime, payload, stdin, timeoutMs);
    }

    /** node.js 깊은 재귀 모드가 필요했던 소스 */
    private deepJsSource: string | null = null;

    private async runInWorker(
        runtime: RunRequest['runtime'],
        payload: { source: string; artifact?: Uint8Array },
        stdin: string,
        timeoutMs: number
    ): Promise<RunResult> {
        const generation = this.generation;
        const worker = await this.acquire(generation);
        if (!worker) return { status: 'cancelled', output: EMPTY_OUTPUT, timeMs: 0 };

        const res = await worker.request(
            {
                type: 'run',
                runtime,
                source: runtime === 'cpp' ? undefined : payload.source,
                artifact: payload.artifact,
                stdin,
            },
            LOAD_TIMEOUT_MS,
            timeoutMs + 250
        );

        if (generation !== this.generation) {
            return { status: 'cancelled', output: EMPTY_OUTPUT, timeMs: 0 };
        }
        if (!res || res.type === 'timeout') {
            this.release(worker, true);
            return {
                status: 'timeout',
                output: res ? partialOutput(res.partial) : EMPTY_OUTPUT,
                timeMs: timeoutMs,
            };
        }
        this.release(worker, false);
        if (res.type === 'error') {
            return {
                status: 'internal-error',
                output: EMPTY_OUTPUT,
                timeMs: 0,
                message: res.message,
            };
        }
        if (res.timeMs > timeoutMs)
            return { status: 'timeout', output: res.output, timeMs: res.timeMs };
        return {
            status: res.output.exitCode === 0 ? 'ok' : 'runtime-error',
            output: res.output,
            timeMs: res.timeMs,
        };
    }

    /** 실행 중인 모든 작업을 중단합니다. (컴파일러 워커는 유지) */
    cancelAll() {
        this.generation++;
        const workers = this.workers;
        this.workers = [];
        for (const w of workers) w.terminate();
        for (const wake of this.waiters.splice(0)) wake();
        this.sandboxInstance?.cancelAll();
    }
}
