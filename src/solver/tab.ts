// Tab 키: VS Code처럼 커서 자리에 다음 탭 위치까지 공백을 넣습니다.
// (CodeMirror 기본 indentWithTab은 커서가 줄 어디에 있든 줄 전체를 들여씁니다.)
// 여러 줄을 선택했을 때만 그 줄들을 들여씁니다.
import { countColumn, EditorSelection, type StateCommand } from '@codemirror/state';
import { getIndentUnit } from '@codemirror/language';
import { indentMore } from '@codemirror/commands';

export const insertTab: StateCommand = ({ state, dispatch }) => {
    const multiLine = state.selection.ranges.some(
        (r) => !r.empty && state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number
    );
    if (multiLine) return indentMore({ state, dispatch });

    const unit = getIndentUnit(state);
    const tr = state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from);
        const column = countColumn(line.text, state.tabSize, range.from - line.from);
        const spaces = ' '.repeat(unit - (column % unit));
        return {
            changes: { from: range.from, to: range.to, insert: spaces },
            range: EditorSelection.cursor(range.from + spaces.length),
        };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
    return true;
};
