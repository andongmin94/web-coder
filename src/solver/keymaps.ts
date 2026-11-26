// 에디터 키 설정: VS Code(기본), IntelliJ, Visual Studio, Vim.
// 두 키맵에 공통인 기본 단축키(되돌리기, 주석, 줄 옮기기 등)는 editor.ts의 CodeMirror 기본 키맵에 있고,
// 여기서는 서로 다른 키와 마우스 동작만 정의해 그보다 먼저 적용합니다.
// (브라우저가 가로채는 키는 쓸 수 없습니다. 예: IntelliJ의 Ctrl+W 선택 확장은 탭 닫기라 넣지 않음)
// 코드 정렬(format.ts)은 어느 키맵이든 Shift+Alt+F, 그리고 각 에디터의 서식 키로 합니다.
// Vim은 @replit/codemirror-vim(MIT)을 씁니다.
import { EditorSelection, Facet, Prec, type Extension, type StateCommand } from '@codemirror/state';
import {
    crosshairCursor,
    EditorView,
    keymap,
    rectangularSelection,
    type Command,
    type KeyBinding,
} from '@codemirror/view';
import {
    copyLineDown,
    defaultKeymap,
    historyKeymap,
    indentLess,
    redo,
    cursorMatchingBracket,
    deleteLine,
    indentSelection,
    insertBlankLine,
    lineComment,
    lineUncomment,
    moveLineDown,
    moveLineUp,
    toggleBlockComment,
} from '@codemirror/commands';
import { vim, Vim } from '@replit/codemirror-vim';
import { acceptCompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { foldKeymap } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { insertTab } from './tab.ts';
import { formatDocument } from './format.ts';
import { openReplacePanel } from './search-box.ts';
import {
    gotoLine,
    searchKeymap,
    selectNextOccurrence,
    selectSelectionMatches,
} from '@codemirror/search';

export type KeymapName = 'vscode' | 'intellij' | 'visualstudio' | 'vim';

export const KEYMAPS: { id: KeymapName; label: string }[] = [
    { id: 'vscode', label: 'VS Code' },
    { id: 'intellij', label: 'IntelliJ' },
    { id: 'visualstudio', label: 'Visual Studio' },
    { id: 'vim', label: 'Vim' },
];

export const isKeymapName = (value: unknown): value is KeymapName =>
    KEYMAPS.some((k) => k.id === value);

/** Visual Studio의 Ctrl+L: 커서가 있는 줄을 잘라 클립보드에 넣습니다. */
const cutLine: Command = (view) => {
    const { state } = view;
    const lines = new Set(state.selection.ranges.map((r) => state.doc.lineAt(r.head).number));
    const text = [...lines].map((n) => state.doc.line(n).text + state.lineBreak).join('');
    void navigator.clipboard?.writeText(text).catch(() => {});
    return deleteLine(view);
};

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
    { key: 'Mod-h', run: openReplacePanel }, // 바꾸기
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
    { key: 'Mod-r', run: openReplacePanel }, // 바꾸기
    { key: 'Shift-Enter', run: insertBlankLine }, // 아래에 새 줄
    { key: 'Mod-Alt-i', run: indentSelection }, // 자동 들여쓰기
    { key: 'Mod-Alt-l', run: formatDocument }, // 코드 정렬 (Reformat Code)
];

const VISUAL_STUDIO_KEYS = [
    // Ctrl+M, Ctrl+M(접기)는 CodeMirror 기본 Ctrl+M(Tab 포커스 모드)과 겹쳐 키맵 전체가 깨지므로 넣지 않습니다.
    // 접기는 줄 번호 옆 화살표나 Ctrl+Shift+[로 합니다.
    { key: 'Mod-l', run: cutLine }, // 줄 잘라내기
    { key: 'Mod-Shift-l', run: deleteLine }, // 줄 삭제
    { key: 'Mod-d', run: copyLineDown }, // 줄 복제
    { key: 'Mod-k Mod-c', run: lineComment }, // 주석
    { key: 'Mod-k Mod-u', run: lineUncomment }, // 주석 풀기
    { key: 'Mod-k Mod-d', run: formatDocument }, // 문서 서식
    { key: 'Mod-]', run: cursorMatchingBracket }, // 짝 괄호로
    { key: 'Mod-g', run: gotoLine },
    { key: 'Mod-h', run: openReplacePanel }, // 바꾸기
    { key: 'Shift-Alt-.', run: selectNextOccurrence }, // 다음 같은 단어에 커서 추가
    { key: 'Shift-Alt-;', run: selectSelectionMatches }, // 같은 단어 모두
];

/** 어느 키 설정이든 깔리는 기본 키 (CodeMirror 기본 + 자동 완성·Tab) */
export const BASE_KEYS: readonly KeyBinding[] = [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    // CodeMirror는 Ctrl+Shift+Z 다시 실행을 Linux에만 둡니다. VS Code·IntelliJ처럼 Windows에서도
    // (IntelliJ 키 설정은 Ctrl+Y가 줄 삭제라 이것이 유일한 다시 실행 키)
    { key: 'Mod-Shift-z', run: redo, preventDefault: true },
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    // 자동 완성 목록이 열려 있으면 Tab으로 고릅니다. (VS Code처럼) 닫혀 있으면 들여쓰기
    { key: 'Tab', run: acceptCompletion },
    // 커서 자리에 공백 (여러 줄 선택이면 그 줄들을 들여쓰기), Shift+Tab은 내어쓰기
    { key: 'Tab', run: insertTab, shift: indentLess },
];

/** Vim의 :w(저장)는 예제 실행으로. 코드는 자동 저장되므로 저장할 일이 없습니다. */
export const vimWriteHandler = Facet.define<() => void, (() => void) | null>({
    combine: (values) => values[0] ?? null,
});
Vim.defineEx('write', 'w', (cm: { cm6: EditorView }) => {
    cm.cm6.state.facet(vimWriteHandler)?.();
});

/** 모든 키맵에 공통: VS Code의 문서 서식 키 */
const FORMAT_KEYS = keymap.of([{ key: 'Shift-Alt-f', run: formatDocument }]);

/** 키맵과 그에 맞는 마우스 동작 (커서 추가, 세로 선택) */
export const keymapExtension = (name: KeymapName): Extension => [
    Prec.high(FORMAT_KEYS),
    keymapFor(name),
];

const keymapFor = (name: KeymapName): Extension =>
    name === 'vim'
        ? // Vim 모드는 다른 키맵보다 먼저 키를 받아야 합니다. (아래에 모드 표시줄)
          [Prec.highest(vim({ status: true }))]
        : name === 'visualstudio'
          ? [
                Prec.high(keymap.of(VISUAL_STUDIO_KEYS)),
                // Visual Studio: Ctrl+Alt+클릭으로 커서 추가, Alt+끌기로 세로 선택
                EditorView.clickAddsSelectionRange.of((e) => e.ctrlKey && e.altKey),
                rectangularSelection({ eventFilter: (e) => e.altKey && !e.ctrlKey }),
                crosshairCursor({ key: 'Alt' }),
            ]
          : name === 'intellij'
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
