import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequests } from './rpc.ts';

test('답이 오면 그 값, 시간이 넘으면 null', async () => {
    const requests = createRequests();
    const sent: number[] = [];
    const answered = requests.request<string>((id) => sent.push(id), 1000);
    requests.resolve(sent[0], 'ok');
    assert.equal(await answered, 'ok');
    assert.equal(await requests.request((id) => sent.push(id), 5), null);
});

test('워커가 죽으면 기다리던 요청과 이후 요청을 바로 null로', async () => {
    const requests = createRequests();
    const waiting = requests.request(() => {}, 60_000);
    requests.fail();
    assert.equal(await waiting, null);
    let sent = false;
    assert.equal(await requests.request(() => (sent = true), 60_000), null);
    assert.equal(sent, false);
});
