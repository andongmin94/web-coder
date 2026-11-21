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
    /** 긴 줄 자동 줄바꿈 */
    editorWrap?: boolean;
};

export type CustomTest = { id: string; input: string; expected: string };

const get = async <T>(key: string): Promise<T | undefined> => {
    const data = await chrome.storage.local.get(key);
    return data[key] as T | undefined;
};

const set = (key: string, value: unknown) => chrome.storage.local.set({ [key]: value });

export const storage = {
    getPrefs: async () => (await get<Prefs>('prefs')) ?? {},
    updatePrefs: async (patch: Prefs) =>
        set('prefs', { ...((await get<Prefs>('prefs')) ?? {}), ...patch }),

    getCode: (problemId: string, languageId: string) =>
        get<string>(`code:${problemId}:${languageId}`),
    setCode: (problemId: string, languageId: string, code: string) =>
        set(`code:${problemId}:${languageId}`, code),

    getCustomTests: async (problemId: string) =>
        (await get<CustomTest[]>(`tests:${problemId}`)) ?? [],
    setCustomTests: (problemId: string, tests: CustomTest[]) => set(`tests:${problemId}`, tests),
};
