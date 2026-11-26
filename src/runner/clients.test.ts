import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunnerWorker } from './clients.ts';
import { FakeWorker } from './fake-worker.test-helper.ts';

const runMessage = { type: 'run', runtime: 'python', source: 'print(1)', stdin: '' };

test('실행 결과가 오면 그 결과, 실행 중 출력은 시간 초과 때 부분 출력으로', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fake = new FakeWorker();
    const worker = new RunnerWorker(fake);

    const ok = worker.request(runMessage, 1000, 100);
    fake.reply({ type: 'started', id: fake.lastId });
    fake.reply({ type: 'run', id: fake.lastId, output: { stdout: '1\n' }, timeMs: 5 });
    assert.deepEqual(await ok, { type: 'run', id: 1, output: { stdout: '1\n' }, timeMs: 5 });

    const slow = worker.request(runMessage, 1000, 100);
    fake.reply({ type: 'started', id: fake.lastId });
    fake.reply({ type: 'output', id: fake.lastId, stdout: 'partial', stderr: '', reset: false });
    t.mock.timers.tick(100);
    assert.deepEqual(await slow, { type: 'timeout', partial: { stdout: 'partial', stderr: '' } });
});

test('준비(불러오기) 시간과 실행 시간을 따로 잰다', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fake = new FakeWorker();
    const worker = new RunnerWorker(fake);
    let done = false;
    const res = worker.request(runMessage, 1000, 100).then((r) => ((done = true), r));
    t.mock.timers.tick(500); // 불러오는 중: 실행 시간(100)이 지나도 끝나지 않음
    await Promise.resolve();
    assert.equal(done, false);
    fake.reply({ type: 'started', id: fake.lastId });
    t.mock.timers.tick(100);
    assert.equal((await res)?.type, 'timeout');
});

test('깊은 재귀로 다시 실행하면(started가 또 옴) 출력을 비우고 시간을 다시 잰다', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fake = new FakeWorker();
    const worker = new RunnerWorker(fake);
    const res = worker.request(runMessage, 1000, 100);
    fake.reply({ type: 'started', id: fake.lastId });
    fake.reply({ type: 'output', id: fake.lastId, stdout: 'first', stderr: '', reset: false });
    t.mock.timers.tick(90);
    fake.reply({ type: 'output', id: fake.lastId, stdout: '', stderr: '', reset: true });
    fake.reply({ type: 'started', id: fake.lastId });
    t.mock.timers.tick(90); // 처음부터 재면 180이지만 다시 잰 뒤로는 90
    fake.reply({ type: 'output', id: fake.lastId, stdout: 'second', stderr: '', reset: false });
    t.mock.timers.tick(10);
    assert.deepEqual(await res, { type: 'timeout', partial: { stdout: 'second', stderr: '' } });
});

test('워커가 죽으면 기다리던 요청은 오류로 끝나고 다시 쓰지 않는다', async () => {
    const fake = new FakeWorker();
    const worker = new RunnerWorker(fake);
    const res = worker.request(runMessage, 1000, 100);
    fake.crash('out of memory');
    assert.deepEqual(await res, { type: 'error', id: 1, message: 'out of memory' });
    assert.equal(worker.crashed, true);
});

test('강제로 끝내면(terminate) 기다리던 요청은 null', async () => {
    const fake = new FakeWorker();
    const worker = new RunnerWorker(fake);
    const res = worker.request(runMessage, 1000, 100);
    worker.terminate();
    assert.equal(await res, null);
    assert.equal(fake.terminated, true);
});
