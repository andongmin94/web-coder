// 저장 공간 자동 관리. 사용자에게 따로 보여 주지 않습니다.
//
// 문제별·언어별 코드(code:문제:언어)와 내 테스트(tests:문제)는 계속 쌓입니다. 코드는 문제당 몇 KB라
// 평소에는 아무것도 지우지 않고, 전체가 예산(PRUNE_BUDGET)을 넘을 때만 오래 열지 않은 문제부터 정리합니다.
// 덩치가 큰 내 테스트를 먼저 지우고, 그래도 넘으면 코드를 지웁니다. 지금 연 문제는 건드리지 않습니다.
// (문제 본문 problem:문제는 problem.ts가 최근 100개만 둠)

/** 이만큼 넘으면 정리 (chrome.storage.local, unlimitedStorage) */
export const PRUNE_BUDGET = 50 << 20;
/** 정리할 때 여기까지 줄임 (곧바로 또 넘지 않게) */
export const PRUNE_TARGET = 40 << 20;
/** 문제를 마지막으로 연 시각 { 문제 번호: ms } */
export const RECENT_KEY = 'recent-problems';
/** 마지막으로 크기를 확인한 시각 (하루에 한 번만) */
const CHECKED_KEY = 'storage-checked';
const CHECK_INTERVAL_MS = 24 * 60 * 60_000;

const problemOf = (key: string) => {
    const m = /^(?:code|tests):([^:]+)/.exec(key);
    return m ? m[1] : null;
};

/**
 * 지울 키. entries는 저장된 키와 대략의 크기, lastOpened는 문제별 마지막으로 연 시각(없으면 아주 오래된 것),
 * keep은 지우지 않을 문제(지금 연 문제).
 */
export const planPrune = (
    entries: { key: string; bytes: number }[],
    lastOpened: Record<string, number>,
    keep: string | null,
    budget = PRUNE_BUDGET,
    target = PRUNE_TARGET
): string[] => {
    let total = entries.reduce((n, e) => n + e.bytes, 0);
    if (total <= budget) return [];
    const byProblem = new Map<string, { key: string; bytes: number }[]>();
    for (const entry of entries) {
        const problem = problemOf(entry.key);
        if (!problem || problem === keep) continue;
        const list = byProblem.get(problem) ?? [];
        list.push(entry);
        byProblem.set(problem, list);
    }
    const oldestFirst = [...byProblem.keys()].sort(
        (a, b) => (lastOpened[a] ?? 0) - (lastOpened[b] ?? 0)
    );
    const removed: string[] = [];
    // 내 테스트 먼저, 그다음 코드
    for (const prefix of ['tests:', 'code:']) {
        for (const problem of oldestFirst) {
            if (total <= target) return removed;
            for (const entry of byProblem.get(problem)!) {
                if (!entry.key.startsWith(prefix)) continue;
                removed.push(entry.key);
                total -= entry.bytes;
            }
        }
    }
    return removed;
};

/** 대략의 저장 크기 (키 + JSON) */
const sizeOf = (key: string, value: unknown) =>
    key.length + new TextEncoder().encode(JSON.stringify(value) ?? '').length;

/** 문제를 열었다고 기록합니다. (정리할 때 오래된 순서로 씀) */
export const touchProblem = async (problemId: string) => {
    const write = async () => {
        const { [RECENT_KEY]: recent = {} } = (await chrome.storage.local.get(RECENT_KEY)) as {
            [RECENT_KEY]?: Record<string, number>;
        };
        await chrome.storage.local.set({ [RECENT_KEY]: { ...recent, [problemId]: Date.now() } });
    };
    // 여러 탭이 동시에 쓰면 한쪽이 빠질 수 있어 차례를 맞춥니다. (problem.ts의 목록과 같은 방식)
    await (navigator.locks ? navigator.locks.request('webcoder-recent', write) : write());
};

/** 하루에 한 번, 예산을 넘었으면 정리합니다. 지운 키 수를 돌려줍니다. */
export const autoPrune = async (keep: string | null, now = Date.now()) => {
    const local = chrome.storage.local;
    const { [CHECKED_KEY]: checked = 0 } = (await local.get(CHECKED_KEY)) as {
        [CHECKED_KEY]?: number;
    };
    if (now - checked < CHECK_INTERVAL_MS) return 0;
    await local.set({ [CHECKED_KEY]: now });
    // 크기만 먼저 봅니다. (넘지 않으면 전체를 읽지 않음)
    if (
        typeof local.getBytesInUse === 'function' &&
        (await local.getBytesInUse(null)) <= PRUNE_BUDGET
    )
        return 0;
    const all = (await local.get(null)) as Record<string, unknown>;
    const recent = (all[RECENT_KEY] as Record<string, number> | undefined) ?? {};
    const remove = planPrune(
        Object.entries(all).map(([key, value]) => ({ key, bytes: sizeOf(key, value) })),
        recent,
        keep
    );
    if (!remove.length) return 0;
    await local.remove(remove);
    // 코드까지 다 지운 문제는 기록에서도 뺍니다.
    const left = new Set(
        Object.keys(all)
            .filter((k) => !remove.includes(k))
            .map(problemOf)
    );
    await local.set({
        [RECENT_KEY]: Object.fromEntries(Object.entries(recent).filter(([p]) => left.has(p))),
    });
    return remove.length;
};
