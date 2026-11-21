import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXTRACTED_THEMES } from './theme-data.ts';

test('추출한 테마는 id가 겹치지 않고 색이 모두 올바른 형식이다', () => {
    const ids = new Set(EXTRACTED_THEMES.map((theme) => theme.id));
    assert.equal(ids.size, EXTRACTED_THEMES.length);
    for (const theme of EXTRACTED_THEMES) {
        for (const [key, value] of Object.entries(theme.palette))
            assert.match(value, /^#[0-9a-f]{6}([0-9a-f]{2})?$/, `${theme.id}.${key}`);
    }
});

test('처음에 손으로 넣었던 테마의 id가 그대로다 (저장된 설정 유지)', () => {
    const ids = new Set(EXTRACTED_THEMES.map((theme) => theme.id));
    for (const id of ['vscode-dark', 'vscode-light', 'darcula', 'intellij-light', 'jetbrains-dark'])
        assert.ok(ids.has(id), id);
});
