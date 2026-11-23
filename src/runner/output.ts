// stdout/stderr를 따로 모으고 출력 제한을 겁니다.

/**
 * 출력 제한. 백준은 정답보다 훨씬 많이 출력할 때만 출력 초과를 주므로, 정렬한 수 100만 개(약 7MB) 같은
 * 정상적인 큰 출력은 받아야 합니다. 화면에는 앞부분만 보여 줍니다. (tests-view.ts)
 */
export const OUTPUT_LIMIT = 32 << 20; // 32MB

/** 표준 에러는 채점과 상관없으니 이만큼만 모읍니다. (디버그 출력이 많아도 출력 초과가 되지 않게) */
const STDERR_LIMIT = 1 << 20; // 1MB
const STDERR_CUT = '\n[표준 에러가 너무 길어 뒷부분은 생략했습니다]\n';

export class OutputLimitError extends Error {
    constructor() {
        super('output limit');
    }
}

/**
 * 실행 중 출력을 밖으로 흘려보내는 통로. 시간 초과로 워커가 강제 종료돼도
 * 그때까지의 출력을 보여 주기 위해 씁니다. reset이면 지금까지 받은 것을 버립니다. (다시 실행)
 */
export type ProgressSink = (stdout: string, stderr: string, reset: boolean) => void;

let progressSink: ProgressSink | null = null;
export const setProgressSink = (sink: ProgressSink | null) => {
    progressSink = sink;
};

/**
 * 출력이 이만큼 쌓일 때까지는 쓰는 즉시 보내고, 그 뒤로는 간격을 두고 모아 보냅니다.
 * 모아 둔 출력은 다음 쓰기 때 나가므로, 그 전에 프로그램이 멈추면(무한 루프) 보여 주지 못합니다.
 * 그래서 디버깅에 흔한 작은 출력은 하나도 빠지지 않게 하고, 큰 출력에서만 속도를 위해 모읍니다.
 */
export const EAGER_OUTPUT_CHARS = 64 << 10;
export const FLUSH_INTERVAL_MS = 2;

export class OutputCollector {
    stdout = '';
    stderr = '';
    truncated = false;
    private sentOut = 0;
    private sentErr = 0;
    private lastFlush = 0;

    constructor() {
        progressSink?.('', '', true);
    }

    private progress() {
        if (!progressSink) return;
        const now = performance.now();
        if (
            this.stdout.length + this.stderr.length > EAGER_OUTPUT_CHARS &&
            now - this.lastFlush < FLUSH_INTERVAL_MS
        )
            return;
        this.lastFlush = now;
        progressSink(this.stdout.slice(this.sentOut), this.stderr.slice(this.sentErr), false);
        this.sentOut = this.stdout.length;
        this.sentErr = this.stderr.length;
    }

    write = (fd: 1 | 2, chunk: string) => {
        if (fd === 2) {
            // 백준은 표준 에러를 채점하지 않으므로 출력 초과로 치지 않고, 앞부분만 남깁니다.
            const room = STDERR_LIMIT - this.stderr.length;
            if (room >= 0) {
                this.stderr += chunk.length > room ? chunk.slice(0, room) + STDERR_CUT : chunk;
                this.progress();
            }
            return;
        }
        const room = OUTPUT_LIMIT - this.stdout.length;
        if (room <= 0) {
            this.truncated = true;
            throw new OutputLimitError();
        }
        const piece = chunk.length > room ? chunk.slice(0, room) : chunk;
        this.stdout += piece;
        this.progress();
        if (piece.length < chunk.length) {
            this.truncated = true;
            throw new OutputLimitError();
        }
    };
}
