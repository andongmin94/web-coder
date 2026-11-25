import type { ProcessOutput, RunStatus } from '../runner/types.ts';
import type { JavaCheckDiagnostic } from './java-compiler-worker.ts';

/**
 * 솔버 → sandbox 페이지.
 * sandbox는 eval이 허용되는 대신 extension API와 확장 리소스에 직접 접근하지 못하므로,
 * Java 컴파일러 파일은 솔버가 읽어 'java-assets'로 넘겨 줍니다.
 */
export type SandboxRequest =
    | {
          type: 'run';
          id: number;
          language: 'javascript';
          source: string;
          stdin: string;
          timeoutMs: number;
      }
    | {
          type: 'run';
          id: number;
          language: 'java';
          artifact: Uint8Array;
          stdin: string;
          timeoutMs: number;
          /** 앞선 테스트에서 스택이 넘친 프로그램: 처음부터 깊은 재귀 모드로 실행 */
          deep?: boolean;
      }
    | {
          type: 'java-assets';
          wasm: ArrayBuffer;
          /** javac SDK: Java 버전('8', '11', '15', 제한 없음 '') → 아카이브 */
          sdks: Record<string, ArrayBuffer>;
          classlib: ArrayBuffer;
      }
    | { type: 'java-compile'; id: number; source: string; release: string }
    | { type: 'java-check'; id: number; source: string; release: string }
    | { type: 'cancel' };

export type SandboxRunResponse = {
    kind: 'run';
    id: number;
    status: RunStatus;
    output?: ProcessOutput;
    timeMs?: number;
    message?: string;
    /** Java: 깊은 재귀 모드로 실행했는지 */
    deep?: boolean;
};

export type SandboxCompileResponse = {
    kind: 'compile';
    id: number;
    ok: boolean;
    artifact?: Uint8Array;
    diagnostics: string;
};

export type SandboxCheckResponse = {
    kind: 'check';
    id: number;
    diagnostics: JavaCheckDiagnostic[];
};

export type SandboxResponse =
    | { kind: 'ready' }
    | SandboxRunResponse
    | SandboxCompileResponse
    | SandboxCheckResponse;
