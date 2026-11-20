// sandbox 안의 blob 워커: 컴파일된 Java 프로그램(TeaVM wasm-gc) 한 번 실행
// TeaVM 런타임이 new Function을 쓰므로 eval이 허용된 sandbox에서만 동작합니다.
import { loadJava } from '../runner/java.ts';

const post = (message: unknown) => (self as unknown as Worker).postMessage(message);

self.onmessage = async (event: MessageEvent<{ artifact: Uint8Array; stdin: string }>) => {
    try {
        const execute = await loadJava(event.data.artifact, event.data.stdin);
        post({ type: 'started' });
        const started = performance.now();
        const output = execute();
        post({ type: 'done', ...output, timeMs: performance.now() - started });
    } catch (error) {
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
