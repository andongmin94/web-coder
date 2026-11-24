// chrome.storage.local 래퍼
export type Prefs = {
    /** 마지막으로 쓴 BOJ 언어 이름 (예: "C++17") */
    lastLanguageLabel?: string;
    /** 문제 패널 너비 비율 (0~1) */
    problemRatio?: number;
    /** 결과 패널 너비 비율 (0~1) */
    resultsRatio?: number;
    /** 에디터 테마 (themes.ts의 id, 없으면 시스템 설정을 따름) */
    editorTheme?: string;
    /** 에디터 글자 크기 (px) */
    editorFontSize?: number;
    /** 긴 줄 자동 줄바꿈 (없으면 켬) */
    editorWrap?: boolean;
    /** 에디터 단축키 (없으면 VS Code) */
    editorKeymap?: 'vscode' | 'intellij';
    /** 에디터 글꼴 이름 (PC에 설치된 글꼴, 없으면 기본 목록) */
    editorFont?: string;
    /** 문제 패널을 접어 두었는지 */
    problemCollapsed?: boolean;
    /** 작업 공간 밝기 (없으면 시스템 설정) */
    appearance?: 'light' | 'dark';
};

export type CustomTest = { id: string; input: string; expected: string };

const get = async <T>(key: string): Promise<T | undefined> => {
    const data = await chrome.storage.local.get(key);
    return data[key] as T | undefined;
};

const set = (key: string, value: unknown) => chrome.storage.local.set({ [key]: value });

/**
 * 설정은 읽고-고쳐-쓰기라서 연달아 바꾸면 앞의 변경이 덮어써질 수 있습니다.
 * (예: 글자 크기를 바꾸자마자 테마를 바꾸면 글자 크기가 사라짐) 그래서 차례로 처리합니다.
 */
let prefsQueue: Promise<unknown> = Promise.resolve();

export const storage = {
    getPrefs: async () => (await get<Prefs>('prefs')) ?? {},
    updatePrefs: (patch: Prefs) => {
        const next = prefsQueue.then(async () =>
            set('prefs', { ...((await get<Prefs>('prefs')) ?? {}), ...patch })
        );
        prefsQueue = next.catch(() => {});
        return next;
    },

    getCode: (problemId: string, languageId: string) =>
        get<string>(`code:${problemId}:${languageId}`),
    setCode: (problemId: string, languageId: string, code: string) =>
        set(`code:${problemId}:${languageId}`, code),

    /** 언어(런타임)별 내 템플릿. 없으면 undefined (기본 템플릿 사용) */
    getTemplate: (runtime: string) => get<string>(`template:${runtime}`),
    setTemplate: (runtime: string, code: string | null) =>
        code === null
            ? chrome.storage.local.remove(`template:${runtime}`)
            : set(`template:${runtime}`, code),

    getCustomTests: async (problemId: string) =>
        (await get<CustomTest[]>(`tests:${problemId}`)) ?? [],
    setCustomTests: (problemId: string, tests: CustomTest[]) => set(`tests:${problemId}`, tests),
};
