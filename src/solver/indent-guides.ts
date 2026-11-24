// 들여쓰기 안내선 (VS Code처럼 들여쓰기 단계마다 옅은 세로선)
// 각 줄에 들여쓰기 너비를 CSS 변수로 달고, 그림은 solver.css의 .cm-indent-guides::before가 그립니다.
// 빈 줄은 위아래 줄 중 얕은 쪽만큼 이어 그려서 블록 안에서 선이 끊기지 않게 합니다.
import { RangeSetBuilder, type Text } from '@codemirror/state';
import { getIndentUnit } from '@codemirror/language';
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
} from '@codemirror/view';

/** 줄의 들여쓰기 열 수 (빈 줄이면 null) */
export const indentColumns = (text: string, tabSize: number): number | null => {
    let column = 0;
    for (const ch of text) {
        if (ch === ' ') column++;
        else if (ch === '\t') column += tabSize - (column % tabSize);
        else return column;
    }
    return null;
};

/** 빈 줄은 위아래로 가장 가까운 내용 있는 줄 중 얕은 쪽 (멀리 찾지는 않음) */
export const guideColumns = (doc: Text, lineNumber: number, tabSize: number): number => {
    const own = indentColumns(doc.line(lineNumber).text, tabSize);
    if (own !== null) return own;
    const LIMIT = 200;
    let above = 0;
    for (let n = lineNumber - 1; n >= 1 && n >= lineNumber - LIMIT; n--) {
        const c = indentColumns(doc.line(n).text, tabSize);
        if (c !== null) {
            above = c;
            break;
        }
    }
    let below = 0;
    for (let n = lineNumber + 1; n <= doc.lines && n <= lineNumber + LIMIT; n++) {
        const c = indentColumns(doc.line(n).text, tabSize);
        if (c !== null) {
            below = c;
            break;
        }
    }
    return Math.min(above, below);
};

const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const { doc, tabSize } = view.state;
    const unit = getIndentUnit(view.state);
    for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
            const line = doc.lineAt(pos);
            // 들여쓰기 단위마다 하나씩 (8칸 들여쓰기면 0열과 4열에 두 줄)
            const levels = Math.floor(guideColumns(doc, line.number, tabSize) / unit);
            if (levels > 0) {
                builder.add(
                    line.from,
                    line.from,
                    Decoration.line({
                        class: 'cm-indent-guides',
                        attributes: {
                            style: `--wc-guides: ${levels * unit}ch; --wc-guide-step: ${unit}ch`,
                        },
                    })
                );
            }
            pos = line.to + 1;
        }
    }
    return builder.finish();
};

export const indentGuides = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
            this.decorations = build(view);
        }
        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
        }
    },
    { decorations: (plugin) => plugin.decorations }
);
