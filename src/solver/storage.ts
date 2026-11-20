// chrome.storage.local 래퍼
export type Prefs = {
    /** 마지막으로 쓴 BOJ 언어 이름 (예: "C++17") */
    lastLanguageLabel?: string;
    /** 문제 패널 너비 비율 (0~1) */
    problemRatio?: number;
    /** 에디터 높이 비율 (0~1) */
    editorRatio?: number;
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
