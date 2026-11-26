import type { RuntimeKey } from '../shared/languages.ts';

// ── 실행 워커 (runner-worker.js): C++ 결과물, Python 실행 ──────────

export type RunRequest = {
    type: 'run';
    id: number;
    /** javascript는 깊은 재귀 모드(QuickJS)일 때만 여기로 옵니다. 보통은 sandbox에서 V8로 실행 */
    runtime: Exclude<RuntimeKey, 'java'>;
    /** python, javascript: 소스 코드 */
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
    /** 실행이 끝났을 때의 메모리 사용량 (wasm 선형 메모리 기준, 잴 수 없으면 없음) */
    memoryBytes?: number;
    /** 브라우저(V8)의 호출 스택 한계로 끝났는지. node.js는 이때 깊은 재귀 모드로 다시 실행합니다. */
    stackOverflow?: boolean;
};

/** C++ 프로그램의 스택 크기. 선형 메모리에 미리 잡히므로 메모리 사용량에서 뺍니다. */
export const CPP_STACK_SIZE = 64 << 20;

export type RunResponse = { type: 'run'; id: number; output: ProcessOutput; timeMs: number };
export type ErrorResponse = { type: 'error'; id: number; message: string };
export type StartedResponse = { type: 'started'; id: number };
/** 실행 중 출력 조각. reset이면 지금까지 받은 것을 버립니다. */
export type OutputResponse = {
    type: 'output';
    id: number;
    stdout: string;
    stderr: string;
    reset: boolean;
};

export type WorkerResponse = RunResponse | ErrorResponse | StartedResponse | OutputResponse;

// ── C++ 컴파일 워커 (clang/compiler-worker.js) ────────────────────

export type CompilerRequest =
    | { type: 'warmup' }
    | { type: 'compile'; id: number; source: string; std: string }
    | { type: 'build-pch'; id: number; std: string; exceptions: boolean }
    /** 인텔리센스: 자동완성/시그니처 (clang -code-completion-at, 줄/열은 1부터, 열은 UTF-8 바이트) */
    | {
          type: 'complete';
          id: number;
          source: string;
          std: string;
          line: number;
          col: number;
          memberOnly: boolean;
      }
    /** 인텔리센스: 실시간 진단 (clang -fsyntax-only) */
    | { type: 'diagnose'; id: number; source: string; std: string };

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
    /** 인텔리센스 결과: clang 출력 원문 (메인 스레드에서 해석) */
    | { type: 'intel'; id: number; output: string; needsPch: boolean }
    | ErrorResponse;

// ── 공통 결과 ──────────────────────────────────────────────────────

export type RunStatus = 'ok' | 'runtime-error' | 'timeout' | 'internal-error' | 'cancelled';

export type RunResult = {
    status: RunStatus;
    output: ProcessOutput;
    timeMs: number;
    message?: string;
    /** 판정과 상관없이 결과 카드에 보여 줄 안내 (예: 깊은 재귀 모드로 다시 실행함) */
    notice?: string;
};

/** 컴파일 결과 (C++, Java). 다른 언어는 바로 ok */
export type CompileOutcome =
    | { ok: true; artifact?: Uint8Array; diagnostics: string }
    | { ok: false; diagnostics: string };
