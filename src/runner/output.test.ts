import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTPUT_LIMIT, OutputCollector } from './output.ts';

test('표준 에러는 출력 초과로 치지 않고 앞부분만 남긴다', () => {
    const out = new OutputCollector();
    const big = 'e'.repeat(1 << 20);
    for (let i = 0; i < 40; i++) out.write(2, big); // 40MB
    out.write(1, 'ok\n');
    assert.equal(out.truncated, false);
    assert.equal(out.stdout, 'ok\n');
    assert.ok(out.stderr.length < 2 << 20);
    assert.match(out.stderr, /생략했습니다/);
    assert.throws(() => out.write(1, 'x'.repeat(OUTPUT_LIMIT)));
    assert.equal(out.truncated, true);
});
