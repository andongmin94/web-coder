// Java 컴파일 워커. teavm-javac(OpenJDK javac + TeaVM, wasm-gc)로 Main.java → program.wasm
// 빌드 방법과 패치 내용은 tools/java/README.md 참고.
import { load } from '../../vendor/teavm/wasm-runtime.js';
import type { CompilerRequest, CompilerResponse } from '../runner/types.ts';

type Diagnostic = {
    type: 'javac' | 'teavm';
    severity: 'error' | 'warning' | 'other';
    fileName: string | null;
    lineNumber: number;
    message: string;
    /** javac 진단만: 소스 안의 문자 위치 */
    startPosition?: number;
    endPosition?: number;
    position?: number;
};

export type JavaCheckDiagnostic = {
    from: number;
    to: number;
    severity: 'error' | 'warning';
    message: string;
};

type TeaVMJavac = {
    setSdk(content: Int8Array): void;
    setTeaVMClasslib(content: Int8Array): void;
    onDiagnostic(listener: (d: Diagnostic) => void): unknown;
    addSourceFile(path: string, content: string): void;
    clearSourceFiles(): void;
    clearOutputFiles(): void;
    compile(): boolean;
    generateWebAssembly(options: {
        outputName: string;
        mainClass: string;
        obfuscated?: boolean;
    }): Promise<boolean>;
    getWebAssemblyOutputFile(path: string): Int8Array | null;
};

/**
 * BOJ처럼 Main.main을 실행하되, 잡히지 않은 예외는 JVM과 같은 형식으로 출력하고 종료 코드 1로 끝냅니다.
 * (스택 트레이스의 클래스·메서드·줄 번호는 실행 쪽 src/runner/java.ts가 디버그 정보로 채웁니다.)
 */
const LAUNCHER = `public class WebcoderLauncher {
    public static void main(String[] args) {
        try {
            Main.main(args);
        } catch (Throwable t) {
            System.out.flush();
            System.err.print("Exception in thread \\"main\\" ");
            t.printStackTrace();
            System.exit(1);
        }
        System.out.flush();
    }
}
`;

const reply = (message: CompilerResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(message, transfer);

// 이 워커는 sandbox 안의 blob 워커로 돌아서 확장 리소스를 직접 읽지 못합니다.
// sandbox 호스트가 'assets' 메시지로 컴파일러 파일을 넘겨 줍니다.
type Assets = { wasm: ArrayBuffer; sdk: ArrayBuffer; classlib: ArrayBuffer };
let provideAssets!: (assets: Assets) => void;
const assetsPromise = new Promise<Assets>((resolve) => (provideAssets = resolve));

let diagnostics: Diagnostic[] = [];

const createCompiler = async (): Promise<TeaVMJavac> => {
    const { wasm, sdk, classlib } = await assetsPromise;
    const teavm = await load<{ createCompiler(): TeaVMJavac }>(new Uint8Array(wasm));
    const compiler = teavm.exports.createCompiler();
    compiler.setSdk(new Int8Array(sdk));
    compiler.setTeaVMClasslib(new Int8Array(classlib));
    compiler.onDiagnostic((d) => diagnostics.push(d));
    return compiler;
};

let compilerPromise: Promise<TeaVMJavac> | null = null;
const getCompiler = () => {
    compilerPromise ??= createCompiler();
    compilerPromise.catch(() => (compilerPromise = null));
    return compilerPromise;
};

/**
 * javac처럼 에러가 난 소스 줄과 위치(^)를 덧붙입니다.
 *   Main.java:3: error: incompatible types: String cannot be converted to int
 *           int x = "s";
 *                   ^
 * 메시지가 여러 줄이면(symbol:, location: 등) javac처럼 첫 줄 바로 뒤에 넣습니다.
 */
const sourceSnippet = (source: string, d: Diagnostic) => {
    if (d.type !== 'javac' || d.fileName !== 'Main.java' || d.lineNumber <= 0) return '';
    const text = source.split('\n')[d.lineNumber - 1]?.replace(/\r$/, '');
    if (text === undefined || !text.trim()) return '';
    const position = d.position ?? d.startPosition;
    if (position === undefined || position < 0) return `\n${text}`;
    // 줄 시작 위치를 찾아 열을 구합니다. 탭은 그대로 두어야 ^가 같은 자리에 옵니다.
    const lineStart = source.lastIndexOf('\n', position - 1) + 1;
    const column = Math.min(Math.max(0, position - lineStart), text.length);
    const padding = text.slice(0, column).replace(/[^\t]/g, ' ');
    return `\n${text}\n${padding}^`;
};

const formatDiagnostics = (list: Diagnostic[], source = '') =>
    list
        .filter((d) => d.fileName !== 'WebcoderLauncher.java')
        .map((d) => {
            const where = d.fileName
                ? `${d.fileName}${d.lineNumber > 0 ? `:${d.lineNumber}` : ''}: `
                : '';
            const [head, ...details] = d.message.split('\n');
            const rest = details.length ? `\n${details.join('\n')}` : '';
            return `${where}${d.severity}: ${head}${sourceSnippet(source, d)}${rest}`;
        })
        .join('\n');

const compile = async (source: string): Promise<CompilerResponse> => {
    if (!/\bclass\s+Main\b/.test(source)) {
        return {
            type: 'compile',
            id: 0,
            ok: false,
            diagnostics: '백준 Java 제출은 클래스 이름이 Main이어야 합니다. (public class Main)',
        };
    }
    const compiler = await getCompiler();
    diagnostics = [];
    compiler.clearSourceFiles();
    compiler.clearOutputFiles();
    compiler.addSourceFile('Main.java', source);
    compiler.addSourceFile('WebcoderLauncher.java', LAUNCHER);

    const fail = (fallback: string): CompilerResponse => ({
        type: 'compile',
        id: 0,
        ok: false,
        diagnostics: formatDiagnostics(diagnostics, source) || fallback,
    });

    if (!compiler.compile()) return fail('컴파일에 실패했습니다.');
    const javacWarnings = formatDiagnostics(diagnostics, source);
    diagnostics = [];
    if (
        !(await compiler.generateWebAssembly({
            outputName: 'program',
            mainClass: 'WebcoderLauncher',
        }))
    ) {
        return fail(
            'WebAssembly 생성에 실패했습니다. (TeaVM이 지원하지 않는 API를 썼을 수 있습니다)'
        );
    }
    const output = compiler.getWebAssemblyOutputFile('program.wasm');
    if (!output) return fail('WebAssembly 결과물을 찾지 못했습니다.');
    const artifact = new Uint8Array(output.buffer, output.byteOffset, output.byteLength).slice();
    return { type: 'compile', id: 0, ok: true, artifact, diagnostics: javacWarnings };
};

/** 실시간 진단: javac만 돌려 위치가 있는 진단을 돌려줍니다. (WebAssembly 생성 없음) */
const check = async (source: string): Promise<JavaCheckDiagnostic[]> => {
    const compiler = await getCompiler();
    diagnostics = [];
    compiler.clearSourceFiles();
    compiler.clearOutputFiles();
    compiler.addSourceFile('Main.java', source);
    compiler.compile();
    return diagnostics
        .filter((d) => d.type === 'javac' && d.fileName === 'Main.java' && d.severity !== 'other')
        .map((d) => {
            const from = Math.max(0, d.startPosition ?? d.position ?? 0);
            const to = Math.max(from + 1, d.endPosition ?? from + 1);
            return {
                from,
                to,
                severity: d.severity === 'warning' ? ('warning' as const) : ('error' as const),
                message: d.message,
            };
        });
};

self.addEventListener(
    'message',
    async (
        event: MessageEvent<
            | CompilerRequest
            | ({ type: 'assets' } & Assets)
            | { type: 'check'; id: number; source: string }
        >
    ) => {
        const req = event.data;
        if (req.type === 'assets') {
            provideAssets(req);
            void getCompiler().catch(() => {});
            return;
        }
        if (req.type === 'check') {
            try {
                (self as unknown as Worker).postMessage({
                    type: 'check',
                    id: req.id,
                    diagnostics: await check(req.source),
                });
            } catch {
                (self as unknown as Worker).postMessage({
                    type: 'check',
                    id: req.id,
                    diagnostics: [],
                });
            }
            return;
        }
        try {
            if (req.type === 'warmup') {
                await getCompiler();
                return;
            }
            if (req.type !== 'compile') return;
            const res = await compile(req.source);
            reply(
                { ...res, id: req.id },
                res.type === 'compile' && res.artifact ? [res.artifact.buffer] : []
            );
        } catch (error) {
            reply({
                type: 'error',
                id: 'id' in req ? req.id : 0,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
);
