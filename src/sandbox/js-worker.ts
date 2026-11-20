// node.js 코드를 실행하는 워커 본문.
// sandbox 페이지가 이 함수를 문자열로 만들어 blob 워커로 띄웁니다. 바깥 변수를 참조하면 안 됩니다.
export function jsWorkerMain(prelude: string) {
    type Global = typeof globalThis & {
        __stdin: string;
        __write: (fd: number, text: string) => void;
        __ExitSignal: new (code: number) => { code: number };
        __drainInput: () => void;
        __exitCode: () => number;
    };
    const g = globalThis as Global;
    const post = (message: unknown) => (self as unknown as Worker).postMessage(message);

    self.onmessage = async (event: MessageEvent<{ source: string; stdin: string }>) => {
        const { source, stdin } = event.data;
        const LIMIT = 1 << 20;
        let stdout = '';
        let stderr = '';
        let truncated = false;
        class OutputLimit {}

        g.__stdin = stdin;
        g.__write = (fd, text) => {
            if (truncated) throw new OutputLimit();
            const room = LIMIT - stdout.length - stderr.length;
            const piece = text.length > room ? text.slice(0, room) : text;
            if (fd === 2) stderr += piece;
            else stdout += piece;
            if (piece.length < text.length) {
                truncated = true;
                throw new OutputLimit();
            }
        };

        // 대기 중인 타이머를 추적해 Node처럼 이벤트 루프가 빌 때까지 기다립니다.
        const pending = new Set<number>();
        const nativeSetTimeout = setTimeout;
        const nativeClearTimeout = clearTimeout;
        const sleep = (ms: number) => new Promise((r) => nativeSetTimeout(r, ms));
        (g as { setTimeout: unknown }).setTimeout = (
            fn: (...a: unknown[]) => void,
            ms?: number,
            ...args: unknown[]
        ) => {
            const id = nativeSetTimeout(() => {
                pending.delete(id);
                fn(...args);
            }, ms) as unknown as number;
            pending.add(id);
            return id;
        };
        (g as { clearTimeout: unknown }).clearTimeout = (id: number) => {
            pending.delete(id);
            nativeClearTimeout(id);
        };
        (g as { setImmediate?: unknown }).setImmediate = (
            fn: (...a: unknown[]) => void,
            ...args: unknown[]
        ) => g.setTimeout(fn, 0, ...args);

        // oxlint-disable-next-line no-eval -- sandbox 안에서 사용자 코드를 실행하는 것이 이 워커의 목적입니다.
        (0, eval)(prelude);
        const ExitSignal = g.__ExitSignal;

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
                const frames = (error.stack ?? '')
                    .split('\n')
                    .slice(1)
                    .filter((line) => line.includes('main.js'));
                text = [`${error.name}: ${error.message}`, ...frames].join('\n');
            }
            stderr += text + '\n';
            exitCode = 1;
        };
        self.addEventListener('unhandledrejection', (e) => {
            e.preventDefault();
            handle(e.reason);
        });
        self.addEventListener('error', (e) => {
            e.preventDefault();
            handle(e.error ?? e.message);
        });

        post({ type: 'started' });
        const started = performance.now();
        try {
            // oxlint-disable-next-line no-eval
            (0, eval)(`${source}\n//# sourceURL=main.js`);
        } catch (error) {
            handle(error);
        }

        await sleep(0);
        if (exitCode === null) {
            try {
                g.__drainInput();
            } catch (error) {
                handle(error);
            }
        }
        await sleep(0);
        while (exitCode === null && pending.size > 0) await sleep(1);

        post({
            type: 'done',
            stdout,
            stderr,
            exitCode: exitCode ?? g.__exitCode(),
            truncated,
            timeMs: performance.now() - started,
        });
    };
}
