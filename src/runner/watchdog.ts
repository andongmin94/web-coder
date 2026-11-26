// 실행 시간 제한 감시 (pool.ts의 실행 워커, sandbox.ts의 JS·Java 실행에서 같이 씀)
// 처음에는 준비 시간(loadMs: 런타임 불러오기)을 재고, 실행을 시작했다고 알리면(started) 그때부터
// 실행 시간(runMs)을 잽니다. started를 다시 부르면 다시 잽니다. (스택이 넘쳐 깊은 재귀 모드로 처음부터
// 다시 실행할 때: 실패한 첫 시도와 모듈을 고치는 시간을 시간 제한에 넣지 않음)

export type Watchdog = {
    started(): void;
    stop(): void;
};

export const createWatchdog = (
    loadMs: number,
    runMs: number,
    onExpire: (phase: 'load' | 'run') => void
): Watchdog => {
    let timer = setTimeout(() => onExpire('load'), loadMs);
    return {
        started() {
            clearTimeout(timer);
            timer = setTimeout(() => onExpire('run'), runMs);
        },
        stop() {
            clearTimeout(timer);
        },
    };
};
