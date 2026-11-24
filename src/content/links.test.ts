import { test } from 'node:test';
import assert from 'node:assert/strict';

test('다시 제출(수정) 주소만 골라낸다', async () => {
    // links.ts는 불러올 때 document에 리스너를 다므로, 판정 함수만 쓰도록 가짜 document를 둡니다.
    (globalThis as unknown as { document: unknown }).document ??= { addEventListener() {} };
    const { isResubmitPath } = await import('./links.ts');
    assert.equal(isResubmitPath('/submit/2743/105256511'), true);
    assert.equal(isResubmitPath('/submit/2743/105256511/'), true);
    assert.equal(isResubmitPath('/submit/2743'), false); // 그냥 제출
    assert.equal(isResubmitPath('/status'), false);
    assert.equal(isResubmitPath('/source/105256511'), false);
    assert.equal(isResubmitPath('/submit/2743/abc'), false);
});
