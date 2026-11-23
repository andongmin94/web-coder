// content script(BOJ 페이지) ↔ 솔버 iframe(확장 페이지) 사이의 메시지.
import type { BojLanguage } from './languages.ts';

/** 백준은 acmicpc.net(www 없음)으로 운영되며, www 주소도 함께 허용합니다. */
export const BOJ_ORIGINS = ['https://acmicpc.net', 'https://www.acmicpc.net'];

export const isBojOrigin = (origin: string | undefined): origin is string =>
    origin !== undefined && BOJ_ORIGINS.includes(origin);

export type Sample = { input: string; output: string };

export type ProblemSection = { id: string; title: string; html: string };

export type ProblemData = {
    id: string;
    title: string;
    url: string;
    timeLimitSec: number | null;
    /** 시간 제한에 "추가 시간 없음"이 붙은 문제 (언어별 보정 없음). 예전에 저장한 문제에는 없음 */
    noExtraTime?: boolean;
    /**
     * 문제에 따로 정한 언어별 시간 제한 (초, 키는 BOJ 언어 이름). 시간 제한이 "하단 참고"인 문제의
     * "시간 제한" 목록 (예: Java 8: 1.5 초). 여기 있는 언어는 보정 없이 이 값이 제한입니다.
     */
    languageTimeLimits?: Record<string, number>;
    memoryLimitMB: number | null;
    limitText: { time: string; memory: string };
    isSpecialJudge: boolean;
    /** 스페셜 저지 문제의 실수 허용 오차 (본문에서 찾음). 예전에 저장한 문제에는 없음 */
    tolerance?: number | null;
    sections: ProblemSection[];
    samples: Sample[];
};

export type CodeOpenOption = { value: string; label: string };

export type SubmitFormData = {
    languages: BojLanguage[];
    selectedLanguageId: string | null;
    codeOpenOptions: CodeOpenOption[];
    codeOpenValue: string | null;
    /** 수정 제출 등으로 폼에 이미 들어 있는 코드 */
    initialSource: string;
};

export type ParentToSolver =
    | {
          type: 'init';
          problemId: string;
          problem: ProblemData | null;
          problemError?: string;
          form: SubmitFormData;
      }
    | { type: 'submit-result'; ok: boolean; message?: string }
    /** 다른 탭에서 문제 페이지를 열어 문제 데이터가 새로 저장됨 */
    | { type: 'problem'; problem: ProblemData };

export type SolverToParent =
    | { type: 'ready' }
    | { type: 'submit'; languageId: string; source: string; codeOpen: string | null }
    | { type: 'restore' };

/** content script(격리 world) ↔ MAIN world 스크립트 사이 이벤트 이름 */
export const MAIN_REQUEST_EVENT = 'webcoder:main-request';
export const MAIN_REPLY_EVENT = 'webcoder:main-reply';

export type MainRequest =
    | { id: number; type: 'read-source' }
    /** 숨겨져 있던 원래 폼을 다시 보일 때 BOJ 에디터(CodeMirror 5)를 다시 그리게 함 */
    | { id: number; type: 'refresh-editor' }
    | { id: number; type: 'submit'; languageId: string; source: string; codeOpen: string | null };

export type MainReply = {
    id: number;
    ok: boolean;
    source?: string;
    needsVerification?: boolean;
    message?: string;
};
