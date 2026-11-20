// node.js 인텔리센스 워커: TypeScript 언어 서비스로 JS 파일을 분석합니다. (VS Code의 JS 지원과 같은 엔진)
// 표준 라이브러리 타입(lib.es2022)은 빌드 때 만든 intel/ts-libs.json에서 받고,
// node 쪽은 웹 코더가 지원하는 범위(fs, readline, process)만 직접 선언합니다.
import ts from 'typescript-js';

const FILE = '/main.js';

const NODE_SHIM = `
declare module 'fs' {
    /** 표준 입력은 '/dev/stdin' 또는 0 */
    export function readFileSync(path: string | number, options?: string | { encoding?: string | null; flag?: string }): string;
    export function writeFileSync(path: string | number, data: string): void;
}
declare module 'node:fs' { export * from 'fs'; }
declare module 'readline' {
    export interface Interface {
        on(event: 'line', listener: (line: string) => void): this;
        on(event: 'close', listener: () => void): this;
        once(event: 'line', listener: (line: string) => void): this;
        close(): void;
        question(query: string, callback: (answer: string) => void): void;
        [Symbol.asyncIterator](): AsyncIterableIterator<string>;
    }
    export function createInterface(options: { input: unknown; output?: unknown; terminal?: boolean }): Interface;
}
declare module 'node:readline' { export * from 'readline'; }
declare const process: {
    stdin: { on(event: 'data', l: (chunk: string) => void): void; on(event: 'end', l: () => void): void; setEncoding(enc: string): void; fd: 0 };
    stdout: { write(text: string): boolean };
    stderr: { write(text: string): boolean };
    argv: string[];
    env: Record<string, string | undefined>;
    exitCode: number | undefined;
    exit(code?: number): never;
    hrtime: { (prev?: [number, number]): [number, number]; bigint(): bigint };
};
declare const console: {
    log(...data: unknown[]): void;
    error(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    info(...data: unknown[]): void;
    table(data: unknown): void;
    dir(data: unknown): void;
};
declare function require(id: string): any;
declare const module: { exports: any };
declare const exports: any;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(id?: number): void;
declare function setImmediate(handler: (...args: any[]) => void, ...args: any[]): number;
`;

let libs: Record<string, string> = {};
let code = '';
let version = 0;

const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    lib: ['lib.es2022.d.ts'],
    strict: false,
    noImplicitAny: false,
    types: [],
};

const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [FILE, '/node-shim.d.ts'],
    getScriptVersion: (name) => (name === FILE ? String(version) : '1'),
    getScriptSnapshot: (name) => {
        const text =
            name === FILE
                ? code
                : name === '/node-shim.d.ts'
                  ? NODE_SHIM
                  : libs[name.replace(/^\//, '')];
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/lib.es2022.d.ts',
    fileExists: (name) =>
        name === FILE || name === '/node-shim.d.ts' || name.replace(/^\//, '') in libs,
    readFile: (name) => (name === FILE ? code : libs[name.replace(/^\//, '')]),
    directoryExists: () => true,
    getDirectories: () => [],
};

let service: ts.LanguageService | null = null;
const ready = (async () => {
    const response = await fetch(new URL('ts-libs.json', self.location.href));
    libs = (await response.json()) as Record<string, string>;
    service = ts.createLanguageService(host, ts.createDocumentRegistry());
})();

const setCode = (next: string) => {
    if (next !== code) {
        code = next;
        version++;
    }
};

const KIND: Record<string, string> = {
    method: 'method',
    function: 'function',
    'local function': 'function',
    property: 'property',
    getter: 'property',
    setter: 'property',
    var: 'variable',
    let: 'variable',
    const: 'constant',
    'local var': 'variable',
    parameter: 'variable',
    class: 'class',
    interface: 'type',
    type: 'type',
    enum: 'type',
    module: 'namespace',
    keyword: 'keyword',
};

const flatten = (parts?: ts.SymbolDisplayPart[]) => (parts ?? []).map((p) => p.text).join('');

type Request =
    | { id: number; type: 'complete'; code: string; pos: number }
    | { id: number; type: 'diagnose'; code: string }
    | { id: number; type: 'hover'; code: string; pos: number }
    | { id: number; type: 'signature'; code: string; pos: number };

const handle = (req: Request): unknown => {
    setCode(req.code);
    const svc = service!;
    switch (req.type) {
        case 'complete': {
            const result = svc.getCompletionsAtPosition(FILE, req.pos, {
                includeCompletionsForModuleExports: false,
                includeCompletionsWithInsertText: true,
            });
            if (!result) return null;
            const items = result.entries
                // JS 파일의 단어 기반 추측(kind 'warning')과 폐기된 API(String.prototype.anchor 등)는 뺍니다.
                .filter(
                    (e) =>
                        e.kind !== ts.ScriptElementKind.warning &&
                        !e.kindModifiers?.includes('deprecated')
                )
                .slice(0, 400)
                .map((e) => ({
                    label: e.name,
                    kind: KIND[e.kind] ?? 'variable',
                    detail: e.kindModifiers?.includes('deprecated') ? '(deprecated)' : undefined,
                    boost: e.sortText < '11' ? 2 : 0,
                }));
            // 상위 몇 개는 시그니처를 붙여 줍니다.
            for (const item of items.slice(0, 30)) {
                const details = svc.getCompletionEntryDetails(
                    FILE,
                    req.pos,
                    item.label,
                    undefined,
                    undefined,
                    undefined,
                    undefined
                );
                if (details) item.detail = flatten(details.displayParts).replace(/^\(\w+\)\s*/, '');
            }
            return items;
        }
        case 'diagnose': {
            const list = [
                ...svc.getSyntacticDiagnostics(FILE),
                ...svc.getSemanticDiagnostics(FILE),
            ];
            return list
                .filter((d) => d.start !== undefined)
                .map((d) => ({
                    from: d.start!,
                    to: d.start! + Math.max(1, d.length ?? 1),
                    severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
                    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
                }));
        }
        case 'hover': {
            const info = svc.getQuickInfoAtPosition(FILE, req.pos);
            if (!info) return null;
            const doc = flatten(info.documentation);
            return flatten(info.displayParts) + (doc ? `\n\n${doc}` : '');
        }
        case 'signature': {
            const help = svc.getSignatureHelpItems(FILE, req.pos, undefined);
            if (!help) return null;
            return help.items.slice(0, 8).map((item) => {
                const params = item.parameters.map((p) => flatten(p.displayParts));
                const prefix = flatten(item.prefixDisplayParts);
                const sep = flatten(item.separatorDisplayParts);
                let label = prefix;
                let active: [number, number] | undefined;
                params.forEach((p, i) => {
                    if (i > 0) label += sep;
                    if (i === help.argumentIndex) active = [label.length, label.length + p.length];
                    label += p;
                });
                label += flatten(item.suffixDisplayParts);
                return { label, active, doc: flatten(item.documentation) || undefined };
            });
        }
    }
};

self.onmessage = async (event: MessageEvent<Request>) => {
    await ready;
    let result: unknown = null;
    try {
        result = handle(event.data);
    } catch {
        result = null;
    }
    (self as unknown as Worker).postMessage({ id: event.data.id, result });
};
