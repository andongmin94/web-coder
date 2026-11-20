// 실행 워커 (C++ 결과물, Python). Java·JS는 eval이 필요해 sandbox 페이지에서 실행합니다. 시간 초과 시 메인 쪽 RunnerPool이 terminate 합니다.
import { runCpp } from './cpp.ts';
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
const prepare = async (req: RunRequest): Promise<() => ProcessOutput | Promise<ProcessOutput>> => {
    switch (req.runtime) {
        case 'cpp':
            if (!req.artifact) throw new Error('컴파일 결과가 없습니다.');
            return () => runCpp(req.artifact!, req.stdin);
        case 'python':
            await warmUpPython();
            return () => runPython(req.source ?? '', req.stdin);
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
        const started = performance.now();
        const output = await execute();
        reply({ type: 'run', id: req.id, output, timeMs: performance.now() - started });
    } catch (error) {
        reply({ type: 'error', id: req.id, message: describeError(error) });
    }
});
