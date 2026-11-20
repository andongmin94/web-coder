// stdout/stderr를 따로 모으고 출력 제한을 겁니다.

export const OUTPUT_LIMIT = 1 << 20; // 1MB

export class OutputLimitError extends Error {
    constructor() {
        super('output limit');
    }
}

export class OutputCollector {
    stdout = '';
    stderr = '';
    truncated = false;

    write = (fd: 1 | 2, chunk: string) => {
        const room = OUTPUT_LIMIT - this.stdout.length - this.stderr.length;
        if (room <= 0) {
            this.truncated = true;
            throw new OutputLimitError();
        }
        const piece = chunk.length > room ? chunk.slice(0, room) : chunk;
        if (fd === 1) this.stdout += piece;
        else this.stderr += piece;
        if (piece.length < chunk.length) {
            this.truncated = true;
            throw new OutputLimitError();
        }
    };
}
