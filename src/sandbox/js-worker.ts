// node.js 코드를 실행하는 워커 본문.
// sandbox 페이지가 이 함수를 문자열로 만들어 blob 워커로 띄웁니다. 바깥 변수를 참조하면 안 됩니다.
export function jsWorkerMain(prelude: string) {
    type Global = typeof globalThis & {
        __stdin: string;
        __write: (fd: number, text: string) => void;
        __ExitSignal: new (code: number) => { code: number };
        __drainInput: () => void;
        __exitCode: () => number;
        __emitExit: (code: number) => void;
        __formatError: (error: Error) => string;
        require: (name: string) => unknown;
        module: { exports: object };
    };
    const g = globalThis as Global;
    // 사용자 코드가 전역(self, postMessage, performance 등)을 덮어써도 실행기가 멈추지 않게 미리 잡아 둡니다.
    const scope = self;
    const post: (message: unknown) => void = scope.postMessage.bind(scope);
    const now = performance.now.bind(performance);
    const nativeSetTimeout = setTimeout;
    const nativeClearTimeout = clearTimeout;
    const nativeSetInterval = setInterval;
    const nativeClearInterval = clearInterval;
    const addListener = scope.addEventListener.bind(scope);

    /** Node의 모듈 래퍼와 같은 모양. 첫 줄에 붙여서 줄 번호가 사용자 코드와 같게 합니다. */
    const WRAPPER_HEAD = '(function (exports, require, module, __filename, __dirname) {';

    scope.onmessage = async (event: MessageEvent<{ source: string; stdin: string }>) => {
        const { source, stdin } = event.data;
        const LIMIT = 1 << 20;
        let stdout = '';
        let stderr = '';
        let truncated = false;
        class OutputLimit {}

        // 시간 초과로 강제 종료돼도 그때까지의 출력을 보여 줄 수 있게 실행 중에 흘려보냅니다.
        let sentOut = 0;
        let sentErr = 0;
        let flushes = 0;
        let lastFlush = 0;
        const progress = () => {
            const t = now();
            if (flushes >= 200 && t - lastFlush < 20) return;
            flushes++;
            lastFlush = t;
            post({
                type: 'output',
                stdout: stdout.slice(sentOut),
                stderr: stderr.slice(sentErr),
                reset: false,
            });
            sentOut = stdout.length;
            sentErr = stderr.length;
        };

        g.__stdin = stdin;
        g.__write = (fd, text) => {
            if (truncated) throw new OutputLimit();
            const room = LIMIT - stdout.length - stderr.length;
            const piece = text.length > room ? text.slice(0, room) : text;
            if (fd === 2) stderr += piece;
            else stdout += piece;
            progress();
            if (piece.length < text.length) {
                truncated = true;
                throw new OutputLimit();
            }
        };

        // 대기 중인 타이머를 추적해 Node처럼 이벤트 루프가 빌 때까지 기다립니다.
        const pending = new Set<number>();
        const intervals = new Set<number>();
        const sleep = (ms: number) => new Promise((r) => nativeSetTimeout(r, ms));
        const globals = g as unknown as Record<string, unknown>;
        globals.setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
            const id = nativeSetTimeout(() => {
                pending.delete(id);
                fn(...args);
            }, ms) as unknown as number;
            pending.add(id);
            return id;
        };
        globals.clearTimeout = (id: number) => {
            pending.delete(id);
            nativeClearTimeout(id);
        };
        globals.setInterval = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
            const id = nativeSetInterval(fn, ms, ...args) as unknown as number;
            intervals.add(id);
            return id;
        };
        globals.clearInterval = (id: number) => {
            intervals.delete(id);
            nativeClearInterval(id);
        };
        globals.setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
            (globals.setTimeout as (...a: unknown[]) => number)(fn, 0, ...args);
        globals.clearImmediate = globals.clearTimeout;

        // oxlint-disable-next-line no-eval -- sandbox 안에서 사용자 코드를 실행하는 것이 이 워커의 목적입니다.
        (0, eval)(prelude);
        const ExitSignal = g.__ExitSignal;
        const formatError = g.__formatError;
        const drainInput = g.__drainInput;
        const emitExit = g.__emitExit;
        const readExitCode = g.__exitCode;
        const require = g.require;
        const module = g.module;

        let exitCode: number | null = null;
        const handle = (error: unknown) => {
            if (exitCode !== null) return;
            if (error instanceof ExitSignal) {
                exitCode = error.code;
                return;
            }
            if (error instanceof OutputLimit) {
                exitCode = 0;
                return;
            }
            let text = `Uncaught ${String(error)}`;
            if (error instanceof Error) {
                // 실행기 내부 프레임(blob:, eval 래퍼)은 빼고 사용자 코드 줄만 남깁니다.
                // 첫 줄은 래퍼 머리말만큼 열 번호가 밀려 있어 되돌립니다.
                text = formatError(error).replace(/main\.js:1:(\d+)/g, (_m, col: string) => {
                    return `main.js:1:${Math.max(1, Number(col) - WRAPPER_HEAD.length)}`;
                });
            }
            stderr += text + '\n';
            exitCode = 1;
        };
        addListener('unhandledrejection', (e) => {
            e.preventDefault();
            handle((e as PromiseRejectionEvent).reason);
        });
        addListener('error', (e) => {
            e.preventDefault();
            handle((e as ErrorEvent).error ?? (e as ErrorEvent).message);
        });

        post({ type: 'started' });
        const started = now();
        try {
            // Node(CommonJS)처럼 함수로 감싸 실행합니다. 최상위 var/function이 전역을 덮어쓰지 않고,
            // 최상위 return과 this(= module.exports)도 Node와 같게 동작합니다.
            // oxlint-disable-next-line no-eval
            const main = (0, eval)(`${WRAPPER_HEAD}${source}\n})\n//# sourceURL=main.js`) as (
                ...args: unknown[]
            ) => void;
            main.call(module.exports, module.exports, require, module, '/main.js', '/');
        } catch (error) {
            handle(error);
        }

        await sleep(0);
        if (exitCode === null) {
            try {
                drainInput();
            } catch (error) {
                handle(error);
            }
        }
        await sleep(0);
        // setInterval만 남은 프로그램은 Node에서도 끝나지 않으므로 시간 초과가 될 때까지 둡니다.
        while (exitCode === null && (pending.size > 0 || intervals.size > 0)) await sleep(1);

        let code: number = exitCode ?? readExitCode();
        try {
            emitExit(code);
            code = exitCode ?? readExitCode();
        } catch (error) {
            if (error instanceof ExitSignal) code = error.code;
            else if (!(error instanceof OutputLimit)) {
                exitCode = null;
                handle(error);
                code = 1;
            }
        }

        post({
            type: 'done',
            stdout,
            stderr,
            exitCode: code,
            truncated,
            timeMs: now() - started,
        });
    };
}
