// sandbox 페이지(eval 허용) 연결: JavaScript 실행, Java 컴파일·실행·실시간 진단 (pool.ts가 씀)
// sandbox 페이지는 확장 리소스를 직접 못 읽어서 Java 컴파일러 파일을 여기서 읽어 넘깁니다.
import { fetchAsset } from '../shared/assets.ts';
import { JAVA_RELEASES } from '../shared/languages.ts';
import type {
    SandboxCheckResponse,
    SandboxCompileResponse,
    SandboxRequest,
    SandboxResponse,
    SandboxRunResponse,
} from '../sandbox/protocol.ts';
import { COMPILE_TIMEOUT_MS, EMPTY_OUTPUT, LOAD_TIMEOUT_MS } from './clients.ts';
import type { CompileOutcome, RunResult } from './types.ts';

const SANDBOX_URL = 'sandbox.html';
const SANDBOX_READY_TIMEOUT_MS = 10_000;

const JAVA_ASSETS = {
    wasm: 'java/compiler.wasm',
    /** javac SDK: 버전별로 거른 것과 제한 없는 것('') */
    sdks: {
        '': 'java/compile-classlib.bin',
        ...Object.fromEntries(JAVA_RELEASES.map((r) => [r, `java/compile-classlib-${r}.bin`])),
    } as Record<string, string>,
    classlib: 'java/runtime-classlib.bin',
};

export class Sandbox {
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
                const response = await fetchAsset(path);
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
        // 한 번 스택이 넘친 Java 프로그램의 다음 테스트는 넘칠 첫 시도를 건너뜁니다.
        const deep = language === 'java' && payload.artifact === this.deepJavaArtifact;
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
                    ? {
                          type: 'run',
                          id,
                          language,
                          artifact: payload.artifact!,
                          stdin,
                          timeoutMs,
                          deep,
                      }
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
        if (res.deep && payload.artifact) this.deepJavaArtifact = payload.artifact;
        return {
            status: res.status,
            output: res.output ?? EMPTY_OUTPUT,
            timeMs: res.timeMs ?? 0,
            message: res.message,
        };
    }

    /** 깊은 재귀 모드가 필요했던 Java 프로그램 (컴파일 결과) */
    private deepJavaArtifact: Uint8Array | null = null;

    cancelAll() {
        this.cancelSeq++;
        this.post({ type: 'cancel' });
    }
}
