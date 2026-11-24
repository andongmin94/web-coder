// 에디터 키 설정: VS Code(기본)와 IntelliJ.
// 두 키맵에 공통인 기본 단축키(되돌리기, 주석, 줄 옮기기 등)는 editor.ts의 CodeMirror 기본 키맵에 있고,
// 여기서는 서로 다른 키와 마우스 동작만 정의해 그보다 먼저 적용합니다.
// (브라우저가 가로채는 키는 쓸 수 없습니다. 예: IntelliJ의 Ctrl+W 선택 확장은 탭 닫기라 넣지 않음)
import { EditorSelection, Prec, type Extension, type StateCommand } from '@codemirror/state';
import {
    crosshairCursor,
    EditorView,
    keymap,
    rectangularSelection,
    type Command,
} from '@codemirror/view';
import {
    copyLineDown,
    deleteLine,
    indentSelection,
    insertBlankLine,
    moveLineDown,
    moveLineUp,
    toggleBlockComment,
} from '@codemirror/commands';
import {
    gotoLine,
    openSearchPanel,
    selectNextOccurrence,
    selectSelectionMatches,
} from '@codemirror/search';

export type KeymapName = 'vscode' | 'intellij';

export const KEYMAPS: { id: KeymapName; label: string }[] = [
    { id: 'vscode', label: 'VS Code' },
    { id: 'intellij', label: 'IntelliJ' },
];

/**
 * VS Code의 Ctrl+L: 커서가 있는 줄 전체를 고르고, 이미 줄 전체를 골랐으면 다음 줄까지 늘립니다.
 */
export const selectLineExtend: StateCommand = ({ state, dispatch }) => {
    const selection = state.selection.ranges.map((range) => {
        const first = state.doc.lineAt(range.from);
        const wholeLines =
            !range.empty &&
            range.from === first.from &&
            (range.to === state.doc.length || state.doc.lineAt(range.to).from === range.to);
        // 이미 줄 단위로 골랐으면 끝 다음 줄까지, 아니면 커서가 있는 줄들
        const lastLine = wholeLines
            ? state.doc.lineAt(Math.min(range.to, state.doc.length))
            : state.doc.lineAt(range.to);
        const end = lastLine.number < state.doc.lines ? lastLine.to + 1 : lastLine.to;
        return EditorSelection.range(first.from, end);
    });
    dispatch(
        state.update({
            selection: EditorSelection.create(selection),
            scrollIntoView: true,
            userEvent: 'select',
        })
    );
    return true;
};

/** VS Code의 Ctrl+Alt+↑/↓: 위나 아래 줄의 같은 자리에 커서를 하나 더 둡니다. */
const addCursorVertically =
    (forward: boolean): Command =>
    (view) => {
        const { state } = view;
        // 가장 위(아래) 커서를 기준으로 한 줄 위(아래)
        const edge = forward
            ? state.selection.ranges.reduce((a, b) => (b.head > a.head ? b : a))
            : state.selection.ranges.reduce((a, b) => (b.head < a.head ? b : a));
        const moved = view.moveVertically(
            EditorSelection.cursor(edge.head, 0, undefined, edge.goalColumn),
            forward
        );
        if (moved.head === edge.head) return true;
        const ranges = [...state.selection.ranges, EditorSelection.cursor(moved.head)];
        view.dispatch({
            selection: EditorSelection.create(ranges, ranges.length - 1),
            scrollIntoView: true,
            userEvent: 'select',
        });
        return true;
    };

const VSCODE_KEYS = [
    { key: 'Mod-l', run: selectLineExtend },
    { key: 'Mod-g', run: gotoLine },
    { key: 'Mod-Alt-ArrowUp', run: addCursorVertically(false) },
    { key: 'Mod-Alt-ArrowDown', run: addCursorVertically(true) },
];

const INTELLIJ_KEYS = [
    { key: 'Mod-d', run: copyLineDown }, // 줄 복제
    { key: 'Mod-y', run: deleteLine }, // 줄 삭제 (다시 실행은 Ctrl+Shift+Z)
    { key: 'Mod-Shift-/', run: toggleBlockComment },
    { key: 'Alt-j', run: selectNextOccurrence },
    { key: 'Mod-Alt-Shift-j', run: selectSelectionMatches },
    { key: 'Shift-Alt-ArrowUp', run: moveLineUp },
    { key: 'Shift-Alt-ArrowDown', run: moveLineDown },
    { key: 'Mod-Shift-ArrowUp', run: moveLineUp },
    { key: 'Mod-Shift-ArrowDown', run: moveLineDown },
    { key: 'Mod-g', run: gotoLine },
    { key: 'Mod-r', run: openSearchPanel }, // 찾기 창에 바꾸기 칸이 같이 있음
    { key: 'Shift-Enter', run: insertBlankLine }, // 아래에 새 줄
    { key: 'Mod-Alt-i', run: indentSelection }, // 자동 들여쓰기
];

/** 키맵과 그에 맞는 마우스 동작 (커서 추가, 세로 선택) */
export const keymapExtension = (name: KeymapName): Extension =>
    name === 'intellij'
        ? [
              Prec.high(keymap.of(INTELLIJ_KEYS)),
              // IntelliJ: Alt+Shift+클릭으로 커서 추가, Alt+끌기로 세로 선택
              EditorView.clickAddsSelectionRange.of((e) => e.altKey && e.shiftKey),
              rectangularSelection({ eventFilter: (e) => e.altKey && !e.shiftKey }),
              crosshairCursor({ key: 'Alt' }),
          ]
        : [
              Prec.high(keymap.of(VSCODE_KEYS)),
              // VS Code: Alt+클릭으로 커서 추가, Shift+Alt+끌기로 세로 선택
              EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
              rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
          ];
