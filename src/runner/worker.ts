// 실행 워커 (C++ 결과물, Python, node.js 깊은 재귀 모드). Java·JS는 eval이 필요해 sandbox 페이지에서 실행합니다. 시간 초과 시 메인 쪽 RunnerPool이 terminate 합니다.
import { prepareCpp } from './cpp.ts';
import { runNodeDeep } from './node-deep.ts';
import { setProgressSink } from './output.ts';
import { runPython, warmUpPython } from './python.ts';
import type { ProcessOutput, RunRequest, WorkerRequest, WorkerResponse } from './types.ts';

const reply = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message);

const describeError = (error: unknown): string => {
    if (error instanceof Error) return error.message || error.name || String(error);
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

/** 로딩(런타임/모듈 준비)과 실행을 나눠, 로딩 시간은 실행 시간에서 뺍니다. */
type Execute = () => Promise<ProcessOutput & { elapsedMs?: number }>;

const prepare = async (req: RunRequest): Promise<Execute> => {
    switch (req.runtime) {
        case 'cpp': {
            if (!req.artifact) throw new Error('컴파일 결과가 없습니다.');
            const run = await prepareCpp(req.artifact);
            return () => run(req.stdin);
        }
        case 'python':
            await warmUpPython();
            return () => runPython(req.source ?? '', req.stdin);
        case 'javascript':
            return () => runNodeDeep(req.source ?? '', req.stdin);
    }
};

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
    const req = event.data;
    if (req.type === 'warmup') {
        if (req.runtime === 'python') void warmUpPython().catch(() => {});
        return;
    }
    try {
        const execute = await prepare(req);
        reply({ type: 'started', id: req.id });
        // 시간 초과로 강제 종료돼도 그때까지의 출력을 보여 줄 수 있게 실행 중에 흘려보냅니다.
        setProgressSink((stdout, stderr, reset) =>
            reply({ type: 'output', id: req.id, stdout, stderr, reset })
        );
        const started = performance.now();
        const { elapsedMs, ...output } = await execute();
        setProgressSink(null);
        reply({
            type: 'run',
            id: req.id,
            output,
            timeMs: elapsedMs ?? performance.now() - started,
        });
    } catch (error) {
        setProgressSink(null);
        reply({ type: 'error', id: req.id, message: describeError(error) });
    }
});
