// 솔버 화면의 상태. 여러 모듈(실행, 저장, 제출 등)이 같은 객체를 나눠 씁니다.
import type { ProblemData } from '../shared/protocol.ts';
import type { ResolvedLanguage, RuntimeKey } from '../shared/languages.ts';
import type { CustomTest } from './storage.ts';
import type { TestState, Verdict } from './tests-view.ts';

export type Stage = { kind: 'loading' | 'compiling' | 'running'; done?: number; total?: number };

/** 마지막 "모두 실행" 결과 (제출 전 확인용) */
export type LastRun = {
    source: string;
    languageId: string;
    verdicts: Verdict[];
    compileError: boolean;
};

export type Timing = { compileMs: number | null; firstLoad: boolean; runMs: number | null };

export const createState = () => ({
    problemId: '',
    problem: null as ProblemData | null,
    languages: [] as ResolvedLanguage[],
    /** 지금 고른 언어 (에디터에 그 언어의 코드가 올라간 뒤에 바뀜) */
    current: null as ResolvedLanguage | null,
    /** 소스 코드 공개 설정 (BOJ 폼에서 고른 것이 없으면 null: BOJ 기본값) */
    codeOpenValue: null as string | null,
    customTests: [] as CustomTest[],
    testStates: new Map<string, TestState>(),
    /** 펼쳐 둔 내 테스트 */
    openTests: new Set<string>(),
    /** 접어 둔 예제 (예제는 기본으로 펼침) */
    closedSamples: new Set<string>(),
    /** 이 세션에서 한 번이라도 준비가 끝난 런타임 (첫 로딩 안내용) */
    warmed: new Set<RuntimeKey>(),
    /** 실행 중이면 그 단계 */
    stage: null as Stage | null,
    cancelRequested: false,
    submitting: false,
    compileMessage: null as { kind: 'error' | 'warning'; text: string } | null,
    lastRun: null as LastRun | null,
    /** 지금 보이는 테스트 결과를 만든 언어와 코드 (하나만 실행할 때 옛 결과를 지울지 판단) */
    resultsKey: null as string | null,
    /** 마지막 실행에 걸린 시간: 컴파일(C++, Java)과 예제 실행을 나눠 상태 줄에 보여 줍니다. */
    lastTiming: null as Timing | null,
    /** 언어를 바꾸는 중(저장된 코드를 읽는 중)이면 실행하지 않습니다. (옛 언어로 돌아 결과가 섞임) */
    switching: false,
});

export type SolverState = ReturnType<typeof createState>;

/** 지금 보이는 결과가 이 언어·코드의 것인지 비교하는 열쇠 */
export const resultKeyOf = (languageId: string, source: string) => `${languageId}\n${source}`;
