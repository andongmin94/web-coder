import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPrune } from './storage-prune.ts';

const KB = 1024;

test('예산 안이면 아무것도 지우지 않는다', () => {
    const entries = [
        { key: 'code:1000:84', bytes: 2 * KB },
        { key: 'tests:1000', bytes: 10 * KB },
    ];
    assert.deepEqual(planPrune(entries, {}, null, 100 * KB, 80 * KB), []);
});

test('넘으면 오래 안 연 문제의 내 테스트부터, 그래도 넘으면 코드', () => {
    const entries = [
        { key: 'prefs', bytes: 1 * KB },
        { key: 'problem:1', bytes: 5 * KB },
        { key: 'code:1:84', bytes: 10 * KB },
        { key: 'tests:1', bytes: 30 * KB },
        { key: 'code:2:84', bytes: 10 * KB },
        { key: 'tests:2', bytes: 30 * KB },
        { key: 'code:3:84', bytes: 10 * KB },
        { key: 'tests:3', bytes: 30 * KB },
    ];
    const opened = { '1': 100, '2': 300, '3': 200 }; // 1이 가장 오래됨, 그다음 3
    // 126KB → 100KB 이하로: 1의 테스트(30)를 지우면 96KB
    assert.deepEqual(planPrune(entries, opened, null, 100 * KB, 100 * KB), ['tests:1']);
    // 60KB 이하로: 테스트 셋(90) 지우면 36KB
    assert.deepEqual(planPrune(entries, opened, null, 100 * KB, 60 * KB), [
        'tests:1',
        'tests:3',
        'tests:2',
    ]);
    // 20KB 이하로: 테스트를 다 지우고(36) 코드도 오래된 것부터 (1 → 26, 3 → 16)
    assert.deepEqual(planPrune(entries, opened, null, 100 * KB, 20 * KB), [
        'tests:1',
        'tests:3',
        'tests:2',
        'code:1:84',
        'code:3:84',
    ]);
});

test('지금 연 문제와 문제와 상관없는 키(설정, 템플릿, 문제 본문)는 지우지 않는다', () => {
    const entries = [
        { key: 'prefs', bytes: 50 * KB },
        { key: 'template:cpp', bytes: 50 * KB },
        { key: 'problem:7', bytes: 50 * KB },
        { key: 'code:7:84', bytes: 50 * KB },
        { key: 'tests:7', bytes: 50 * KB },
    ];
    assert.deepEqual(planPrune(entries, {}, '7', 100 * KB, 10 * KB), []);
});

test('연 기록이 없는 문제는 가장 오래된 것으로', () => {
    const entries = [
        { key: 'tests:5', bytes: 60 * KB },
        { key: 'tests:6', bytes: 60 * KB },
    ];
    assert.deepEqual(planPrune(entries, { '5': 1000 }, null, 100 * KB, 100 * KB), ['tests:6']);
});

test('autoPrune: 하루 한 번, 예산을 넘었을 때만 지우고 기록도 정리', async () => {
    const { autoPrune, RECENT_KEY, PRUNE_BUDGET } = await import('./storage-prune.ts');
    const big = 'x'.repeat(PRUNE_BUDGET / 4); // 문제 하나의 내 테스트가 예산의 1/4
    const data: Record<string, unknown> = {
        'code:1:84': 'int main(){}',
        'tests:1': big,
        'code:2:84': 'int main(){}',
        'tests:2': big,
        'tests:3': big,
        'tests:4': big,
        'tests:5': big,
        prefs: {},
        [RECENT_KEY]: { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 },
    };
    const size = () =>
        Object.entries(data).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
    (globalThis as { chrome?: unknown }).chrome = {
        storage: {
            local: {
                get: async (keys: string | null) =>
                    keys === null ? { ...data } : keys in data ? { [keys]: data[keys] } : {},
                set: async (items: Record<string, unknown>) => void Object.assign(data, items),
                remove: async (keys: string[]) => keys.forEach((k) => delete data[k]),
                getBytesInUse: async () => size(),
            },
        },
    };
    const day = 24 * 60 * 60_000;
    assert.ok(size() > PRUNE_BUDGET);
    const removed = await autoPrune('5', 10 * day);
    assert.equal(removed, 2); // 오래된 1, 2의 테스트만 지우면 40MB 아래
    assert.ok(!('tests:1' in data) && !('tests:2' in data));
    assert.ok('code:1:84' in data && 'tests:5' in data); // 코드와 지금 문제는 그대로
    assert.deepEqual(Object.keys(data[RECENT_KEY] as object).sort(), ['1', '2', '3', '4', '5']);
    // 같은 날 다시 불러도 확인하지 않음
    data['tests:9'] = big + big;
    assert.equal(await autoPrune('5', 10 * day + 1000), 0);
    delete (globalThis as { chrome?: unknown }).chrome;
});
