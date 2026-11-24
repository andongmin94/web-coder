import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState, Text, type Transaction } from '@codemirror/state';
import { selectLineExtend } from './keymaps.ts';
import { guideColumns, indentColumns } from './indent-guides.ts';

const selectLine = (doc: string, anchor: number, head = anchor) => {
    let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
    selectLineExtend({ state, dispatch: (tr: Transaction) => (state = tr.state) });
    const { from, to } = state.selection.main;
    return state.sliceDoc(from, to);
};

test('Ctrl+L(VS Code): 줄 전체를 고르고, 다시 누르면 다음 줄까지', () => {
    const doc = 'int a;\nint b;\nint c;';
    assert.equal(selectLine(doc, 2), 'int a;\n');
    assert.equal(selectLine(doc, 0, 7), 'int a;\nint b;\n'); // 이미 첫 줄 전체 → 다음 줄까지
    assert.equal(selectLine(doc, 15), 'int c;'); // 마지막 줄은 줄바꿈 없이
    assert.equal(selectLine(doc, 14, 20), 'int c;'); // 마지막 줄 전체에서 더 늘릴 곳 없음
});

test('들여쓰기 안내선: 열 수와 빈 줄 이어 그리기', () => {
    assert.equal(indentColumns('        x', 4), 8);
    assert.equal(indentColumns('\t  x', 4), 6);
    assert.equal(indentColumns('   ', 4), null);
    const doc = Text.of([
        'int main() {',
        '    for (;;) {',
        '        a();',
        '',
        '        b();',
        '    }',
        '',
        '}',
    ]);
    assert.equal(guideColumns(doc, 3, 4), 8);
    assert.equal(guideColumns(doc, 4, 4), 8); // 블록 안의 빈 줄은 이어 그림
    assert.equal(guideColumns(doc, 7, 4), 0); // 블록 밖 빈 줄 (위 4, 아래 0 → 0)
});
