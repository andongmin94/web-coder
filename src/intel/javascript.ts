// node.js 인텔리센스: TypeScript 언어 서비스 워커(intel/ts-worker.js)에 묻습니다.
import {
    wordStart,
    type IntelCompletion,
    type IntelDiagnostic,
    type IntelSignature,
    type LanguageIntel,
} from './types.ts';
import { createRequests } from './rpc.ts';

export const createJavaScriptIntel = (): LanguageIntel => {
    const worker = new Worker('intel/ts-worker.js');
    const requests = createRequests();
    worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) =>
        requests.resolve(e.data.id, e.data.result);
    // 워커를 못 띄우거나 죽으면 요청마다 시간 제한까지 기다리지 않게
    worker.onerror = (e) => {
        e.preventDefault();
        requests.fail();
    };
    const ask = <T>(message: Record<string, unknown>, timeoutMs = 15_000) =>
        requests.request<T>((id) => worker.postMessage({ ...message, id }), timeoutMs);

    return {
        triggerCharacters: ['.'],
        async complete(code, pos, explicit) {
            const from = wordStart(code, pos);
            const member = code.slice(0, from).trimEnd().endsWith('.');
            if (!explicit && !member && pos - from < 1) return null;
            const items = await ask<IntelCompletion[]>({ type: 'complete', code, pos });
            return items ? { from, items } : null;
        },
        async diagnose(code) {
            return (await ask<IntelDiagnostic[]>({ type: 'diagnose', code })) ?? [];
        },
        async hover(code, pos) {
            return ask<string>({ type: 'hover', code, pos });
        },
        async signature(code, pos) {
            return ask<IntelSignature[]>({ type: 'signature', code, pos });
        },
        dispose: () => worker.terminate(),
    };
};
