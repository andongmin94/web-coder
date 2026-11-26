import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from './watchdog.ts';

test('준비 시간이 넘으면 load, 시작한 뒤에는 실행 시간으로 run', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fired: string[] = [];
    createWatchdog(1000, 100, (phase) => fired.push(phase));
    t.mock.timers.tick(999);
    assert.deepEqual(fired, []);
    t.mock.timers.tick(1);
    assert.deepEqual(fired, ['load']);

    const fired2: string[] = [];
    const dog = createWatchdog(1000, 100, (phase) => fired2.push(phase));
    t.mock.timers.tick(500);
    dog.started(); // 준비 시간은 더 이상 재지 않음
    t.mock.timers.tick(99);
    assert.deepEqual(fired2, []);
    t.mock.timers.tick(1);
    assert.deepEqual(fired2, ['run']);
});

test('다시 시작하면(깊은 재귀로 재실행) 실행 시간을 처음부터 다시 잰다', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fired: string[] = [];
    const dog = createWatchdog(1000, 100, (phase) => fired.push(phase));
    dog.started();
    t.mock.timers.tick(90); // 첫 시도가 스택이 넘쳐 실패하고 모듈을 고치는 데 걸린 시간
    dog.started();
    t.mock.timers.tick(90);
    assert.deepEqual(fired, []);
    t.mock.timers.tick(10);
    assert.deepEqual(fired, ['run']);
});

test('멈추면 아무것도 하지 않는다', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fired: string[] = [];
    const dog = createWatchdog(10, 10, (phase) => fired.push(phase));
    dog.stop();
    t.mock.timers.tick(100);
    assert.deepEqual(fired, []);
});
