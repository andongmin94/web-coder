// 솔버 페이지에서 워커를 부르는 쪽 (pool.ts가 씀)
// - RunnerWorker: C++ 결과물·Python·QuickJS를 실행하는 워커 하나. 시간 제한은 watchdog.ts로 잼
// - CompilerWorker: 컴파일러 워커 (C++: YoWASP clang)
// 워커는 밖에서 넘길 수 있어 테스트에서 가짜 워커로 확인합니다. (clients.test.ts)
import type { CompilerRequest, CompilerResponse, WorkerResponse } from './types.ts';
import { createWatchdog } from './watchdog.ts';

export const RUNNER_URL = 'runner-worker.js';
/** 런타임 로딩(수십 MB wasm 컴파일)에 허용하는 시간 */
export const LOAD_TIMEOUT_MS = 90_000;
export const COMPILE_TIMEOUT_MS = 120_000;

export const EMPTY_OUTPUT = { stdout: '', stderr: '', exitCode: -1, truncated: false };

/** Worker 중 쓰는 부분 (테스트의 가짜 워커도 이 모양) */
export type WorkerLike = {
    postMessage(message: unknown): void;
    // message와 error 이벤트를 함께 받으므로 이벤트 타입은 열어 둡니다.
    addEventListener(type: 'message' | 'error', listener: (event: any) => void): void;
    terminate(): void;
};

type Final<T> = Exclude<T, { type: 'started' } | { type: 'output' }>;
/** 실행 중 받은 출력 (시간 초과 시 보여 줄 부분 출력) */
export type Partial = { stdout: string; stderr: string };
type TimedOut = { type: 'timeout'; partial: Partial };

export const partialOutput = (partial: Partial) => ({
    stdout: partial.stdout,
    stderr: partial.stderr,
    exitCode: -1,
    truncated: false,
});
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

// ── 실행 워커 ────────────────────────────────────────────────────────

export class RunnerWorker {
    readonly worker: WorkerLike;
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

    /** worker: 테스트에서는 가짜 워커를 넘깁니다. */
    constructor(worker: WorkerLike = new Worker(RUNNER_URL)) {
        this.worker = worker;
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
        this.worker.addEventListener('error', (e: ErrorEvent) => {
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
            const watchdog = createWatchdog(loadTimeoutMs, runTimeoutMs, () => {
                this.pending.delete(id);
                resolve({ type: 'timeout', partial });
            });
            this.pending.set(id, {
                resolve: (r) => {
                    watchdog.stop();
                    resolve(r);
                },
                // 깊은 재귀 모드로 다시 실행할 때도 옵니다. (그때부터 다시 잼)
                onStarted: () => watchdog.started(),
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

// ── 컴파일 워커 (C++: YoWASP clang) ─────────────────────────────────

export class CompilerWorker {
    readonly worker: WorkerLike;
    private nextId = 1;
    private pending = new Map<number, (r: CompilerResponse | null) => void>();

    constructor(worker: WorkerLike) {
        this.worker = worker;
        this.worker.addEventListener('message', (e: MessageEvent<CompilerResponse>) => {
            const resolve = this.pending.get(e.data.id);
            if (!resolve) return;
            this.pending.delete(e.data.id);
            resolve(e.data);
        });
        this.worker.addEventListener('error', (e: ErrorEvent) => {
            e.preventDefault();
            for (const [id, resolve] of this.pending)
                resolve({ type: 'error', id, message: e.message || '컴파일러 워커 오류' });
            this.pending.clear();
            this.crashed = true;
        });
    }

    /** 워커 오류가 난 적이 있는지. 그런 워커는 버리고 새로 만듭니다. (다음 컴파일이 시간 제한까지 멈추지 않게) */
    crashed = false;

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
