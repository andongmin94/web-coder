// 메인(솔버 페이지) 쪽 실행 관리자.
// - C++: 컴파일 워커(YoWASP clang)에서 한 번만 컴파일, 결과 wasm을 모든 테스트에 재사용
//        bits/stdc++.h PCH가 없으면 별도 워커에서 만들어 IndexedDB에 저장
// - C++ 결과물/Python: 실행 워커 풀에서 병렬 실행, 시간 초과 시 terminate 후 교체
// - JavaScript, Java: sandbox 페이지(eval 허용, sandbox-client.ts)에서 실행
//               node.js가 재귀가 깊어 스택이 넘치면 실행 워커의 QuickJS 깊은 재귀 모드로 다시 실행 (node-deep.ts)
// 워커 연결은 clients.ts, sandbox 연결은 sandbox-client.ts에 있습니다.
import type { ResolvedLanguage } from '../shared/languages.ts';
import type { CppAnalyze } from '../intel/types.ts';
import { usesBitsStdcxx, usesExceptions } from './cpp-header.ts';
import { jspi } from './jspi.ts';
import {
    COMPILE_TIMEOUT_MS,
    CompilerWorker,
    EMPTY_OUTPUT,
    LOAD_TIMEOUT_MS,
    RunnerWorker,
    partialOutput,
} from './clients.ts';
import { Sandbox } from './sandbox-client.ts';
import type { CompileOutcome, RunRequest, RunResult } from './types.ts';

const CPP_COMPILER_URL = 'clang/compiler-worker.js';
/** 컴파일 전에 PCH 생성을 기다려 주는 최대 시간 (넘으면 PCH 없이 컴파일) */
const PCH_WAIT_MS = 60_000;

/** V8의 호출 스택 한계로 끝난 node.js 실행인지 (사용자가 잡지 않은 RangeError, js-worker가 표시) */
const isJsStackOverflow = (result: RunResult) =>
    result.status === 'runtime-error' && result.output.stackOverflow === true;

const NODE_DEEP_NOTICE =
    '재귀가 깊어 브라우저의 호출 스택이 넘쳤기 때문에 깊은 재귀 모드(QuickJS)로 다시 실행했습니다. ' +
    '백준(node --stack-size=65536)에서는 통과하는 깊이입니다. 이 모드는 실제 node.js보다 느려서 실행 시간은 참고용입니다.';
const NODE_DEEP_TIMEOUT_NOTICE =
    ' 이번 시간 초과도 이 모드가 느려서일 수 있으니, 깊은 재귀를 반복문(스택)으로 바꾸면 여기서도 확인할 수 있습니다.';

// ── 풀 ───────────────────────────────────────────────────────────────

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

    /** 실행 워커를 만드는 방법 (테스트에서는 가짜 워커) */
    private readonly createRunner: () => RunnerWorker;

    constructor(
        size = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))),
        createRunner = () => new RunnerWorker()
    ) {
        this.size = size;
        this.createRunner = createRunner;
    }

    private static createCppCompiler() {
        return new CompilerWorker(new Worker(CPP_COMPILER_URL, { type: 'module' }));
    }

    private getCompiler() {
        if (this.compiler?.crashed) {
            this.compiler.terminate();
            this.compiler = null;
        }
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
        while (this.workers.length < this.size) this.workers.push(this.createRunner());
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
    cppAnalyze: CppAnalyze = async (message, timeoutMs = 20_000) => {
        const res = await this.getCompiler().request(message, timeoutMs);
        if (!res || res.type !== 'intel') return null;
        if (res.needsPch) void this.buildPch(message.std, usesExceptions(message.source));
        return res.output;
    };

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
                worker = this.createRunner();
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
            // 같은 코드와 같은 입력으로 다시 돌릴 때만 넘칠 첫 시도를 건너뜁니다. QuickJS는 수십 배 느려서,
            // 소스만 보고 건너뛰면 V8에서는 통과하던 다른 큰 입력까지 시간 초과가 날 수 있습니다.
            const key = `${payload.source}\u0000${stdin}`;
            if (!jspi() || !this.deepJsRuns.has(key)) {
                const first = await this.sandbox.run(lang.runtime, payload, stdin, timeoutMs);
                if (!jspi() || !isJsStackOverflow(first)) return first;
                this.deepJsRuns.add(key);
                while (this.deepJsRuns.size > 64)
                    this.deepJsRuns.delete(this.deepJsRuns.values().next().value!);
            }
            const deep = await this.runInWorker('javascript', payload, stdin, timeoutMs);
            if (deep.status === 'cancelled') return deep;
            const slow = deep.status === 'timeout' ? NODE_DEEP_TIMEOUT_NOTICE : '';
            return { ...deep, notice: NODE_DEEP_NOTICE + slow };
        }
        return this.runInWorker(lang.runtime, payload, stdin, timeoutMs);
    }

    /** node.js 깊은 재귀 모드가 필요했던 (소스, 입력) */
    private readonly deepJsRuns = new Set<string>();

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
