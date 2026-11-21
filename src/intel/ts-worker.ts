// node.js 인텔리센스 워커: TypeScript 언어 서비스로 JS 파일을 분석합니다. (VS Code의 JS 지원과 같은 엔진)
// 표준 라이브러리 타입(lib.es2022)은 빌드 때 만든 intel/ts-libs.json에서 받고,
// node 쪽은 로컬 실행기(src/runner/node-prelude.js.txt)가 지원하는 범위만 직접 선언합니다.
// 실행기에 모듈이나 함수를 더하면 여기에도 선언을 넣어야 "찾을 수 없음" 오류가 뜨지 않습니다.
import ts from 'typescript-js';

const FILE = '/main.js';

const NODE_SHIM = `
declare class Buffer extends Uint8Array {
    static from(data: string | ArrayLike<number> | ArrayBuffer, encoding?: string): Buffer;
    static alloc(size: number, fill?: number | string): Buffer;
    static allocUnsafe(size: number): Buffer;
    static concat(list: Uint8Array[], totalLength?: number): Buffer;
    static isBuffer(value: unknown): value is Buffer;
    static byteLength(value: string | Uint8Array): number;
    toString(encoding?: string, start?: number, end?: number): string;
    equals(other: Uint8Array): boolean;
    write(text: string, offset?: number): number;
    slice(start?: number, end?: number): Buffer;
    subarray(start?: number, end?: number): Buffer;
    readUInt8(offset?: number): number;
    readInt8(offset?: number): number;
    readUInt16LE(offset?: number): number;
    readInt16LE(offset?: number): number;
    readUInt32LE(offset?: number): number;
    readInt32LE(offset?: number): number;
    readDoubleLE(offset?: number): number;
    readBigInt64LE(offset?: number): bigint;
}
declare module 'fs' {
    /** 표준 입력은 '/dev/stdin' 또는 0. 인코딩을 주지 않으면 Buffer */
    export function readFileSync(path: string | number): Buffer;
    export function readFileSync(path: string | number, options: string | { encoding: string; flag?: string }): string;
    export function readSync(fd: number, buffer: Uint8Array, offset?: number, length?: number, position?: number | null): number;
    export function writeSync(fd: number, data: string | Uint8Array): number;
    export function writeFileSync(path: string | number, data: string | Uint8Array): void;
    export function existsSync(path: string | number): boolean;
}
declare module 'node:fs' { export * from 'fs'; }
declare module 'readline' {
    export interface Interface {
        on(event: 'line', listener: (line: string) => void): this;
        on(event: 'close', listener: () => void): this;
        once(event: 'line', listener: (line: string) => void): this;
        once(event: 'close', listener: () => void): this;
        close(): void;
        question(query: string, callback: (answer: string) => void): void;
        [Symbol.asyncIterator](): AsyncIterableIterator<string>;
    }
    export function createInterface(options: { input: unknown; output?: unknown; terminal?: boolean }): Interface;
}
declare module 'node:readline' { export * from 'readline'; }
declare module 'readline/promises' {
    export interface Interface {
        on(event: 'line', listener: (line: string) => void): this;
        on(event: 'close', listener: () => void): this;
        close(): void;
        question(query: string): Promise<string>;
        [Symbol.asyncIterator](): AsyncIterableIterator<string>;
    }
    export function createInterface(options: { input: unknown; output?: unknown; terminal?: boolean }): Interface;
}
declare module 'path' {
    export const sep: string;
    export function join(...parts: string[]): string;
    export function resolve(...parts: string[]): string;
    export function normalize(path: string): string;
    export function basename(path: string, ext?: string): string;
    export function dirname(path: string): string;
    export function extname(path: string): string;
    export function isAbsolute(path: string): boolean;
}
declare module 'node:path' { export * from 'path'; }
declare module 'assert' {
    function assert(value: unknown, message?: string): asserts value;
    namespace assert {
        function ok(value: unknown, message?: string): asserts value;
        function equal(actual: unknown, expected: unknown, message?: string): void;
        function notEqual(actual: unknown, expected: unknown, message?: string): void;
        function strictEqual(actual: unknown, expected: unknown, message?: string): void;
        function notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
        function deepEqual(actual: unknown, expected: unknown, message?: string): void;
        function deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
        function throws(fn: () => unknown, message?: string): void;
        function fail(message?: string): never;
    }
    export = assert;
}
declare module 'node:assert' { import assert = require('assert'); export = assert; }
declare module 'events' {
    class EventEmitter {
        on(event: string, listener: (...args: any[]) => void): this;
        once(event: string, listener: (...args: any[]) => void): this;
        off(event: string, listener: (...args: any[]) => void): this;
        addListener(event: string, listener: (...args: any[]) => void): this;
        removeListener(event: string, listener: (...args: any[]) => void): this;
        removeAllListeners(event?: string): this;
        emit(event: string, ...args: any[]): boolean;
        listenerCount(event: string): number;
    }
    namespace EventEmitter { export { EventEmitter }; }
    export = EventEmitter;
}
declare module 'node:events' { import E = require('events'); export = E; }
declare module 'util' {
    export function inspect(value: unknown): string;
    export function format(format?: unknown, ...args: unknown[]): string;
    export function isDeepStrictEqual(a: unknown, b: unknown): boolean;
    export function promisify(fn: (...args: any[]) => void): (...args: any[]) => Promise<any>;
}
declare module 'node:util' { export * from 'util'; }
declare module 'os' { export const EOL: string; export function platform(): string; }
declare module 'perf_hooks' { export const performance: { now(): number }; }
declare module 'buffer' { const B: typeof Buffer; export { B as Buffer }; }
declare module 'timers' { export { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate }; }
declare const process: {
    stdin: {
        on(event: 'data', l: (chunk: Buffer | string) => void): void;
        on(event: 'end' | 'close', l: () => void): void;
        setEncoding(enc: string): void;
        resume(): void;
        fd: 0;
    };
    stdout: { write(text: string): boolean };
    stderr: { write(text: string): boolean };
    argv: string[];
    env: Record<string, string | undefined>;
    platform: string;
    exitCode: number | undefined;
    exit(code?: number): never;
    on(event: 'exit', listener: (code: number) => void): void;
    on(event: string, listener: (...args: any[]) => void): void;
    cwd(): string;
    uptime(): number;
    nextTick(fn: (...args: any[]) => void, ...args: any[]): void;
    memoryUsage(): { rss: number; heapTotal: number; heapUsed: number; external: number };
    hrtime: { (prev?: [number, number]): [number, number]; bigint(): bigint };
};
declare const console: {
    log(...data: unknown[]): void;
    error(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    info(...data: unknown[]): void;
    debug(...data: unknown[]): void;
    trace(...data: unknown[]): void;
    table(data: unknown): void;
    dir(data: unknown): void;
    time(label?: string): void;
    timeEnd(label?: string): void;
    timeLog(label?: string): void;
    assert(condition: unknown, ...data: unknown[]): void;
};
declare const performance: { now(): number };
declare const global: typeof globalThis;
declare const __dirname: string;
declare const __filename: string;
declare function require(id: 'fs' | 'node:fs'): typeof import('fs');
declare function require(id: 'readline' | 'node:readline'): typeof import('readline');
declare function require(id: 'readline/promises'): typeof import('readline/promises');
declare function require(id: 'path' | 'node:path'): typeof import('path');
declare function require(id: 'util' | 'node:util'): typeof import('util');
declare function require(id: 'os'): typeof import('os');
declare function require(id: 'perf_hooks'): typeof import('perf_hooks');
declare function require(id: 'buffer'): typeof import('buffer');
declare function require(id: string): any;
declare const module: { exports: any };
declare const exports: any;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearInterval(id?: number): void;
declare function setImmediate(handler: (...args: any[]) => void, ...args: any[]): number;
declare function clearImmediate(id?: number): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T): T;
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

/**
 * 멤버 목록에 끼어 오는, 멤버가 아닌 항목인지: 키워드와 전역 `Symbol`(`[Symbol.iterator]` 때문에 나옴).
 * 종류(const, class 등)만으로 거르면 `path.sep`, `os.EOL` 같은 모듈의 진짜 멤버까지 빠집니다.
 */
const isNonMember = (e: ts.CompletionEntry) =>
    e.kind === ts.ScriptElementKind.keyword ||
    (e.name === 'Symbol' && e.kind === ts.ScriptElementKind.variableElement);

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
                        !e.kindModifiers?.includes('deprecated') &&
                        !(result.isMemberCompletion && isNonMember(e))
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
                // 객체 타입은 여러 줄로 풀려 나오므로 한 줄로 줄입니다.
                if (details)
                    item.detail = flatten(details.displayParts)
                        .replace(/^\(\w+\)\s*/, '')
                        .replace(/\s*\n\s*/g, ' ')
                        .slice(0, 120);
            }
            return items;
        }
        case 'diagnose': {
            const list = [
                ...svc.getSyntacticDiagnostics(FILE),
                ...svc.getSemanticDiagnostics(FILE),
            ];
            return (
                list
                    // 1108: 함수 밖의 return. 로컬 실행기와 Node(CommonJS)는 코드를 함수로 감싸 실행하므로 허용됩니다.
                    .filter((d) => d.start !== undefined && d.code !== 1108)
                    .map((d) => ({
                        from: d.start!,
                        to: d.start! + Math.max(1, d.length ?? 1),
                        severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
                        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
                    }))
            );
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
