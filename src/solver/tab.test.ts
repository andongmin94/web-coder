import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { insertTab } from './tab.ts';

/** doc의 |를 커서로 (여러 개면 여러 커서), [ ]는 선택 범위 */
const make = (doc: string) => {
    const ranges = [];
    let text = '';
    let start = -1;
    for (const ch of doc) {
        if (ch === '|') ranges.push(EditorSelection.cursor(text.length));
        else if (ch === '[') start = text.length;
        else if (ch === ']') ranges.push(EditorSelection.range(start, text.length));
        else text += ch;
    }
    return EditorState.create({
        doc: text,
        selection: EditorSelection.create(ranges),
        extensions: [
            indentUnit.of('    '),
            EditorState.tabSize.of(4),
            EditorState.allowMultipleSelections.of(true),
        ],
    });
};

const press = (doc: string) => {
    let result: EditorState | null = null;
    insertTab({ state: make(doc), dispatch: (tr: Transaction) => (result = tr.state) });
    const state = result!;
    let out = state.doc.toString();
    for (const r of [...state.selection.ranges].reverse()) {
        out = r.empty ? out.slice(0, r.head) + '|' + out.slice(r.head) : out;
    }
    return out;
};

test('커서 자리에만 다음 탭 위치까지 공백을 넣는다 (줄 전체를 들여쓰지 않음)', () => {
    // 14열 → 다음 탭 위치 16열까지 2칸 (VS Code와 같음)
    assert.equal(press('    cin.clear(|)'), '    cin.clear(  |)');
    assert.equal(press('|int x;'), '    |int x;');
    assert.equal(press('ab|c'), 'ab  |c');
    assert.equal(press('abcd|'), 'abcd    |');
});

test('한 줄 안의 선택은 공백으로 바꾸고, 여러 커서도 각자', () => {
    assert.equal(press('a[bc]d'), 'a   |d');
    assert.equal(press('|x\n  |y'), '    |x\n    |y');
});

test('여러 줄을 선택하면 그 줄들을 들여쓴다', () => {
    let result: EditorState | null = null;
    insertTab({ state: make('[a\nb]'), dispatch: (tr: Transaction) => (result = tr.state) });
    assert.equal(result!.doc.toString(), '    a\n    b');
});
