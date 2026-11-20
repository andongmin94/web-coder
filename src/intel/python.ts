// Python 인텔리센스: Pyright 언어 서버(@typefox/pyright-browser)를 워커로 띄우고 LSP로 대화합니다.
// 표준 라이브러리 타입(typeshed)은 빌드 때 만든 intel/typeshed-stdlib.json을 initializationOptions.files로 넘깁니다.
import {
    lineColOf,
    offsetOf,
    wordStart,
    type CompletionKind,
    type IntelCompletion,
    type IntelDiagnostic,
    type IntelSignature,
    type LanguageIntel,
} from './types.ts';

const URI = 'file:///workspace/main.py';

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };

/** LSP CompletionItemKind → 우리 종류 */
const KIND: Record<number, CompletionKind> = {
    2: 'method',
    3: 'function',
    4: 'function',
    5: 'field',
    6: 'variable',
    7: 'class',
    8: 'type',
    9: 'namespace',
    10: 'property',
    13: 'type',
    14: 'keyword',
    15: 'snippet',
    21: 'constant',
    22: 'type',
};

const toPosition = (code: string, pos: number): Position => {
    const { line, col } = lineColOf(code, pos);
    return { line: line - 1, character: col - 1 };
};
const fromPosition = (code: string, p: Position) => offsetOf(code, p.line + 1, p.character + 1);

export const createPythonIntel = (): LanguageIntel => {
    const worker = new Worker('intel/pyright.worker.js');
    worker.postMessage({ type: 'browser/boot', mode: 'foreground' });

    let nextId = 1;
    const pending = new Map<number, (r: unknown) => void>();
    let docVersion = 0;
    let docText = '';
    let opened = false;
    let lastDiagnostics: {
        version: number;
        items: { range: Range; severity?: number; message: string }[];
    } | null = null;
    const diagnosticWaiters: Array<() => void> = [];

    const send = (message: Record<string, unknown>) =>
        worker.postMessage({ jsonrpc: '2.0', ...message });
    const request = <T>(method: string, params: unknown, timeoutMs = 20_000) =>
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
            send({ id, method, params });
        });
    const notify = (method: string, params: unknown) => send({ method, params });

    worker.onmessage = (event: MessageEvent<Record<string, any>>) => {
        const msg = event.data;
        if (!msg || msg.jsonrpc !== '2.0') return;
        if ('id' in msg && !('method' in msg)) {
            pending.get(msg.id)?.(msg.result ?? null);
            pending.delete(msg.id);
            return;
        }
        // 서버 → 클라이언트 요청에는 답해 줘야 서버가 멈추지 않습니다.
        if ('id' in msg && msg.method) {
            let result: unknown = null;
            if (msg.method === 'workspace/configuration') {
                result = (msg.params?.items ?? []).map((item: { section?: string }) =>
                    item.section === 'python.analysis'
                        ? {
                              typeshedPaths: ['/typeshed'],
                              typeCheckingMode: 'basic',
                              diagnosticMode: 'openFilesOnly',
                              autoImportCompletions: false,
                          }
                        : item.section === 'python'
                          ? { pythonVersion: '3.11' }
                          : {}
                );
            }
            send({ id: msg.id, result });
            return;
        }
        if (msg.method === 'textDocument/publishDiagnostics' && msg.params?.uri === URI) {
            lastDiagnostics = {
                version: msg.params.version ?? docVersion,
                items: msg.params.diagnostics ?? [],
            };
            diagnosticWaiters.splice(0).forEach((wake) => wake());
        }
    };

    const initialized = (async () => {
        const files = (await (await fetch('intel/typeshed-stdlib.json')).json()) as Record<
            string,
            string
        >;
        await request(
            'initialize',
            {
                processId: null,
                rootUri: 'file:///workspace',
                workspaceFolders: [{ uri: 'file:///workspace', name: 'workspace' }],
                capabilities: {
                    workspace: { configuration: true },
                    textDocument: {
                        synchronization: { didSave: false },
                        completion: {
                            completionItem: {
                                snippetSupport: false,
                                documentationFormat: ['plaintext'],
                            },
                        },
                        hover: { contentFormat: ['plaintext'] },
                        signatureHelp: {
                            signatureInformation: {
                                parameterInformation: { labelOffsetSupport: true },
                            },
                        },
                        publishDiagnostics: { versionSupport: true },
                    },
                },
                // 작업 폴더가 처음부터 있어야 "does not exist" 경고가 나지 않습니다.
                initializationOptions: { files: { ...files, '/workspace/main.py': '' } },
            },
            60_000
        );
        notify('initialized', {});
    })();

    /** 문서 내용을 서버와 맞춥니다. */
    const sync = async (code: string) => {
        await initialized;
        if (!opened) {
            opened = true;
            docText = code;
            docVersion = 1;
            notify('textDocument/didOpen', {
                textDocument: { uri: URI, languageId: 'python', version: docVersion, text: code },
            });
        } else if (code !== docText) {
            docText = code;
            docVersion++;
            notify('textDocument/didChange', {
                textDocument: { uri: URI, version: docVersion },
                contentChanges: [{ text: code }],
            });
        }
    };

    const markup = (contents: unknown): string => {
        if (!contents) return '';
        if (typeof contents === 'string') return contents;
        if (Array.isArray(contents)) return contents.map(markup).join('\n');
        return (contents as { value?: string }).value ?? '';
    };

    return {
        triggerCharacters: ['.'],
        async complete(code, pos, explicit) {
            const from = wordStart(code, pos);
            const member = code.slice(0, from).trimEnd().endsWith('.');
            if (!explicit && !member && pos - from < 1) return null;
            await sync(code);
            const result = await request<{ items?: any[] } | any[]>('textDocument/completion', {
                textDocument: { uri: URI },
                position: toPosition(code, pos),
            });
            const list = Array.isArray(result) ? result : (result?.items ?? []);
            const items: IntelCompletion[] = list.slice(0, 400).map((item) => ({
                label: item.label,
                kind: KIND[item.kind] ?? 'variable',
                detail: item.detail,
                apply:
                    item.insertText && item.insertText !== item.label ? item.insertText : undefined,
                // 밑줄로 시작하는 내부 이름은 아래로
                boost: String(item.label).startsWith('_') ? -2 : 0,
            }));
            return { from, items };
        },
        async diagnose(code) {
            await sync(code);
            const want = docVersion;
            if (!lastDiagnostics || lastDiagnostics.version < want) {
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 5_000);
                    diagnosticWaiters.push(() => {
                        clearTimeout(timer);
                        resolve();
                    });
                });
            }
            if (!lastDiagnostics || docText !== code) return [];
            return lastDiagnostics.items.map((d): IntelDiagnostic => ({
                from: fromPosition(code, d.range.start),
                to: Math.max(
                    fromPosition(code, d.range.end),
                    fromPosition(code, d.range.start) + 1
                ),
                severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
                message: d.message,
            }));
        },
        async hover(code, pos) {
            await sync(code);
            const result = await request<{ contents?: unknown }>('textDocument/hover', {
                textDocument: { uri: URI },
                position: toPosition(code, pos),
            });
            return markup(result?.contents) || null;
        },
        async signature(code, pos) {
            await sync(code);
            const help = await request<{
                signatures?: any[];
                activeSignature?: number;
                activeParameter?: number;
            }>('textDocument/signatureHelp', {
                textDocument: { uri: URI },
                position: toPosition(code, pos),
            });
            if (!help?.signatures?.length) return null;
            return help.signatures.slice(0, 6).map((sig): IntelSignature => {
                const index = sig.activeParameter ?? help.activeParameter ?? 0;
                const param = sig.parameters?.[index]?.label;
                let active: [number, number] | undefined;
                if (Array.isArray(param)) active = [param[0], param[1]];
                else if (typeof param === 'string') {
                    const at = sig.label.indexOf(param);
                    if (at >= 0) active = [at, at + param.length];
                }
                return { label: sig.label, active, doc: markup(sig.documentation) || undefined };
            });
        },
        dispose: () => worker.terminate(),
    };
};
