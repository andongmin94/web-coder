import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SELECTION_CONTRAST, contrast, visibleSelection } from './theme-contrast.ts';
import { EXTRACTED_THEMES } from './theme-data.ts';

const rgb = (c: string) => {
    const n = parseInt(c.slice(1, 7), 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
};

test('대비가 충분한 선택 색은 그대로', () => {
    assert.equal(visibleSelection('#264f78', '#1e1e1e', '#d4d4d4'), '#264f78'); // VS Code Dark
});

test('모든 테마에서 선택 영역이 배경과 구별된다', () => {
    const changed: string[] = [];
    for (const t of EXTRACTED_THEMES) {
        const { selection, bg, fg } = t.palette;
        const fixed = visibleSelection(selection, bg, fg);
        if (fixed !== selection) changed.push(t.id);
        if (fixed.length === 7)
            assert.ok(contrast(rgb(fixed), rgb(bg)) >= MIN_SELECTION_CONTRAST - 0.01, t.id);
    }
    // 원래 색이 거의 배경과 같던 몇 개만 바뀜
    assert.ok(changed.length > 0 && changed.length <= 5, changed.join(','));
    assert.ok(changed.includes('solarized-light'));
});
