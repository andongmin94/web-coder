// 백준 기능에서 공통으로 사용하는 타입을 모아 둔 파일입니다.
type SubmitPostRequest = {
    'cf-turnstile-response': string;
    problem_id: string;
    language: number;
    code_open: CodeOpen;
    source: string;
    csrf_key: string;
};

type CodeOpen = 'open' | 'close' | 'onlyaccepted';

export type { SubmitPostRequest, CodeOpen };
