import type { RuntimeKey } from '../shared/languages.ts';

// ── 실행 워커 (runner-worker.js): C++ 결과물, Python 실행 ──────────

export type RunRequest = {
    type: 'run';
    id: number;
    runtime: Exclude<RuntimeKey, 'javascript' | 'java'>;
    /** python: 소스 코드 */
    source?: string;
    /** cpp: 컴파일된 program.wasm */
    artifact?: Uint8Array;
    stdin: string;
};

export type WorkerRequest = RunRequest | { type: 'warmup'; runtime: string };

export type ProcessOutput = {
    stdout: string;
    stderr: string;
    exitCode: number;
    /** 출력 제한을 넘어 잘렸는지 */
    truncated: boolean;
};

export type RunResponse = { type: 'run'; id: number; output: ProcessOutput; timeMs: number };
export type ErrorResponse = { type: 'error'; id: number; message: string };
export type StartedResponse = { type: 'started'; id: number };

export type WorkerResponse = RunResponse | ErrorResponse | StartedResponse;

// ── C++ 컴파일 워커 (clang/compiler-worker.js) ────────────────────

export type CompilerRequest =
    | { type: 'warmup' }
    | { type: 'compile'; id: number; source: string; std: string }
    | { type: 'build-pch'; id: number; std: string };

export type CompilerResponse =
    | {
          type: 'compile';
          id: number;
          ok: boolean;
          artifact?: Uint8Array;
          diagnostics: string;
          /** bits/stdc++.h를 쓰는데 PCH가 아직 없음 → 백그라운드로 만들 것 */
          needsPch?: boolean;
      }
    | { type: 'pch-ready'; id: number; std: string }
    | ErrorResponse;

// ── 공통 결과 ──────────────────────────────────────────────────────

export type RunStatus = 'ok' | 'runtime-error' | 'timeout' | 'internal-error' | 'cancelled';

export type RunResult = {
    status: RunStatus;
    output: ProcessOutput;
    timeMs: number;
    message?: string;
};
