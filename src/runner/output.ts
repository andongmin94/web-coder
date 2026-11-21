// stdout/stderr를 따로 모으고 출력 제한을 겁니다.

export const OUTPUT_LIMIT = 1 << 20; // 1MB

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
        const room = OUTPUT_LIMIT - this.stdout.length - this.stderr.length;
        if (room <= 0) {
            this.truncated = true;
            throw new OutputLimitError();
        }
        const piece = chunk.length > room ? chunk.slice(0, room) : chunk;
        if (fd === 1) this.stdout += piece;
        else this.stderr += piece;
        this.progress();
        if (piece.length < chunk.length) {
            this.truncated = true;
            throw new OutputLimitError();
        }
    };
}
