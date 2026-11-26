import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunnerPool } from './pool.ts';
import { RunnerWorker } from './clients.ts';
import { FakeWorker } from './fake-worker.test-helper.ts';
import type { ResolvedLanguage } from '../shared/languages.ts';

const PY: ResolvedLanguage = { id: '28', label: 'Python 3', runtime: 'python' };
const output = (stdout: string, exitCode = 0) => ({
    stdout,
    stderr: '',
    exitCode,
    truncated: false,
});

/** 가짜 실행 워커로 만든 풀. fakes에 만든 워커가 차례로 쌓입니다. */
const poolWith = (size: number) => {
    const fakes: FakeWorker[] = [];
    const pool = new RunnerPool(size, () => {
        const fake = new FakeWorker();
        fakes.push(fake);
        return new RunnerWorker(fake);
    });
    return { pool, fakes };
};

const tick = () => new Promise((r) => setImmediate(r));

test('정상 종료·런타임 에러·제한을 넘긴 실행 시간을 구분한다', async () => {
    const { pool, fakes } = poolWith(1);
    const finish = async (out: ReturnType<typeof output>, timeMs: number) => {
        const run = pool.run(PY, { source: 'x' }, '', 1000);
        await tick();
        const fake = fakes[0];
        fake.reply({ type: 'started', id: fake.lastId });
        fake.reply({ type: 'run', id: fake.lastId, output: out, timeMs });
        return run;
    };
    assert.equal((await finish(output('1\n'), 10)).status, 'ok');
    assert.equal((await finish(output('', 1), 10)).status, 'runtime-error');
    // 워커가 끝까지 돌았어도 제한보다 오래 걸렸으면 시간 초과
    const slow = await finish(output('1\n'), 1500);
    assert.deepEqual([slow.status, slow.timeMs], ['timeout', 1500]);
    assert.equal(fakes.length, 1); // 워커는 계속 재사용
});

test('시간 초과면 그 워커를 버리고 다음 실행은 새 워커로', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { pool, fakes } = poolWith(1);
    const run = pool.run(PY, { source: 'while True: pass' }, '', 100);
    await tick();
    fakes[0].reply({ type: 'started', id: fakes[0].lastId });
    fakes[0].reply({
        type: 'output',
        id: fakes[0].lastId,
        stdout: 'so far',
        stderr: '',
        reset: false,
    });
    t.mock.timers.tick(100 + 250); // 실행 시간 + 여유
    const result = await run;
    assert.equal(result.status, 'timeout');
    assert.equal(result.output.stdout, 'so far'); // 그때까지의 출력은 보여 줌
    assert.equal(fakes[0].terminated, true);

    const next = pool.run(PY, { source: 'print(1)' }, '', 100);
    await tick();
    assert.equal(fakes.length, 2);
    fakes[1].reply({ type: 'started', id: fakes[1].lastId });
    fakes[1].reply({ type: 'run', id: fakes[1].lastId, output: output('1\n'), timeMs: 1 });
    assert.equal((await next).status, 'ok');
});

test('워커 수만큼만 동시에 돌리고 나머지는 차례를 기다린다', async () => {
    const { pool, fakes } = poolWith(2);
    const runs = [1, 2, 3].map((i) => pool.run(PY, { source: `print(${i})` }, '', 1000));
    await tick();
    assert.equal(fakes.length, 2);
    assert.equal(fakes[0].sent.length + fakes[1].sent.length, 2); // 세 번째는 아직 안 보냄
    fakes[0].reply({ type: 'run', id: fakes[0].lastId, output: output('1\n'), timeMs: 1 });
    await tick();
    // 끝난 워커가 세 번째를 받음
    assert.equal(fakes[0].sent.length, 2);
    fakes[0].reply({ type: 'run', id: fakes[0].lastId, output: output('3\n'), timeMs: 1 });
    fakes[1].reply({ type: 'run', id: fakes[1].lastId, output: output('2\n'), timeMs: 1 });
    assert.deepEqual(
        (await Promise.all(runs)).map((r) => r.output.stdout),
        ['1\n', '2\n', '3\n']
    );
});

test('중단하면 돌던 것과 기다리던 것 모두 cancelled, 워커는 모두 끝냄', async () => {
    const { pool, fakes } = poolWith(1);
    const running = pool.run(PY, { source: 'a' }, '', 1000);
    const waiting = pool.run(PY, { source: 'b' }, '', 1000);
    await tick();
    pool.cancelAll();
    assert.equal((await running).status, 'cancelled');
    assert.equal((await waiting).status, 'cancelled');
    assert.equal(fakes[0].terminated, true);
});

test('워커가 죽으면 내부 오류로 알리고 그 워커는 버린다', async () => {
    const { pool, fakes } = poolWith(1);
    const run = pool.run(PY, { source: 'x' }, '', 1000);
    await tick();
    fakes[0].crash('memory');
    const result = await run;
    assert.deepEqual([result.status, result.message], ['internal-error', 'memory']);
    assert.equal(fakes[0].terminated, true);
});
