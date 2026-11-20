// node.js 인텔리센스: TypeScript 언어 서비스 워커(intel/ts-worker.js)에 묻습니다.
import {
    wordStart,
    type IntelCompletion,
    type IntelDiagnostic,
    type IntelSignature,
    type LanguageIntel,
} from './types.ts';

export const createJavaScriptIntel = (): LanguageIntel => {
    const worker = new Worker('intel/ts-worker.js');
    let nextId = 1;
    const pending = new Map<number, (r: unknown) => void>();
    worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) => {
        pending.get(e.data.id)?.(e.data.result);
        pending.delete(e.data.id);
    };
    const ask = <T>(message: Record<string, unknown>, timeoutMs = 15_000) =>
        new Promise<T | null>((resolve) => {
            const id = nextId++;
            const timer = setTimeout(() => {
                pending.delete(id);
                resolve(null);
            }, timeoutMs);
            pending.set(id, (r) => {
                clearTimeout(timer);
                resolve(r as T);
            });
            worker.postMessage({ ...message, id });
        });

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
