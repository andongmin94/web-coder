// 에디터 테마. 널리 쓰이는 편집기·색 구성의 색을 CodeMirror 6 테마로 옮긴 것입니다.
// 테마를 고르면 에디터뿐 아니라 작업 공간 전체가 그 테마의 밝기(밝은/어두운)를 따릅니다.
//
// 색의 출처
// - VS Code, JetBrains, Rider · ReSharper, Visual Studio: 설치된 프로그램의 테마 파일에서
//   tools/themes/extract.mjs로 뽑은 것 (theme-data.ts). Visual Studio는 JetBrains가 Rider에
//   넣어 둔 "Visual Studio Dark/Light" 색 구성입니다.
// - One Dark: CodeMirror 공식 패키지(@codemirror/theme-one-dark)
// - GitHub, Dracula, Nord: 각 테마의 공개 색상표를 옮긴 것 (원본 파일과 대조하지 않음)
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { tags as t, type Tag } from '@lezer/highlight';
import { EXTRACTED_THEMES } from './theme-data.ts';
import type { EditorTheme, Palette, ThemeDefinition } from './theme-types.ts';

export type { EditorTheme, Palette, ThemeDefinition } from './theme-types.ts';

const MANUAL_THEMES: ThemeDefinition[] = [
    {
        id: 'github-light',
        name: 'GitHub Light',
        group: '기타',
        dark: false,
        palette: {
            bg: '#ffffff',
            fg: '#24292f',
            gutter: '#8c959f',
            activeLine: '#f6f8fa',
            selection: '#b6e3ff',
            cursor: '#24292f',
            keyword: '#cf222e',
            string: '#0a3069',
            number: '#0550ae',
            comment: '#6e7781',
            function: '#8250df',
            type: '#953800',
            variable: '#24292f',
            constant: '#0550ae',
            meta: '#cf222e',
        },
    },
    {
        id: 'github-dark',
        name: 'GitHub Dark',
        group: '기타',
        dark: true,
        palette: {
            bg: '#0d1117',
            fg: '#c9d1d9',
            gutter: '#6e7681',
            activeLine: '#161b22',
            selection: '#264f78',
            cursor: '#c9d1d9',
            keyword: '#ff7b72',
            string: '#a5d6ff',
            number: '#79c0ff',
            comment: '#8b949e',
            function: '#d2a8ff',
            type: '#ffa657',
            variable: '#c9d1d9',
            constant: '#79c0ff',
            meta: '#ff7b72',
        },
    },
    {
        id: 'dracula',
        name: 'Dracula',
        group: '기타',
        dark: true,
        palette: {
            bg: '#282a36',
            fg: '#f8f8f2',
            gutter: '#6272a4',
            activeLine: '#343746',
            selection: '#44475a',
            cursor: '#f8f8f2',
            keyword: '#ff79c6',
            string: '#f1fa8c',
            number: '#bd93f9',
            comment: '#6272a4',
            function: '#50fa7b',
            type: '#8be9fd',
            variable: '#f8f8f2',
            constant: '#bd93f9',
            meta: '#ff79c6',
        },
    },
    {
        id: 'nord',
        name: 'Nord',
        group: '기타',
        dark: true,
        palette: {
            bg: '#2e3440',
            fg: '#d8dee9',
            gutter: '#4c566a',
            activeLine: '#3b4252',
            selection: '#434c5e',
            cursor: '#d8dee9',
            keyword: '#81a1c1',
            string: '#a3be8c',
            number: '#b48ead',
            comment: '#616e88',
            function: '#88c0d0',
            type: '#8fbcbb',
            variable: '#d8dee9',
            constant: '#b48ead',
            meta: '#5e81ac',
        },
    },
];

const PALETTES: ThemeDefinition[] = [...EXTRACTED_THEMES, ...MANUAL_THEMES];

/** 시스템의 밝은/어두운 설정을 따르는 기본값 */
export const AUTO_THEME = 'auto';

export const EDITOR_THEMES: EditorTheme[] = [
    ...PALETTES.map(({ id, name, group, dark }) => ({ id, name, group, dark })),
    { id: 'one-dark', name: 'One Dark', group: '기타', dark: true },
];

/**
 * 문법 요소 → 팔레트 색. (syntax.test.ts가 언어별로 어떤 이름이 어느 색이 되는지 이것으로 확인합니다)
 * control은 팔레트에 없으면 keyword 색입니다.
 */
export const SYNTAX_RULES: {
    tag: Tag | Tag[];
    color: Exclude<keyof Palette, 'control'> | 'control';
}[] = [
    { tag: [t.keyword, t.modifier, t.operatorKeyword, t.self, t.bool, t.null], color: 'keyword' },
    { tag: [t.controlKeyword, t.moduleKeyword], color: 'control' },
    { tag: [t.string, t.special(t.string), t.character, t.regexp], color: 'string' },
    { tag: [t.number, t.escape], color: 'number' },
    { tag: t.comment, color: 'comment' },
    { tag: [t.variableName, t.propertyName], color: 'variable' },
    {
        tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
        color: 'function',
    },
    { tag: [t.typeName, t.className, t.namespace], color: 'type' },
    { tag: [t.constant(t.variableName), t.standard(t.variableName), t.atom], color: 'constant' },
    { tag: [t.meta, t.processingInstruction, t.annotation], color: 'meta' },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'fg' },
];

/** 색에 투명도를 붙입니다. (이미 투명도가 있는 색은 그대로) */
const alpha = (color: string, suffix: string) => (color.length === 7 ? color + suffix : color);

const fromPalette = (p: Palette, dark: boolean): Extension => [
    EditorView.theme(
        {
            '&': { color: p.fg, backgroundColor: p.bg },
            '.cm-content': { caretColor: p.cursor },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.cursor },
            '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
                { backgroundColor: p.selection },
            '.cm-activeLine': { backgroundColor: p.activeLine },
            '.cm-gutters': {
                backgroundColor: p.gutterBg ?? p.bg,
                color: p.gutter,
                border: 'none',
            },
            '.cm-activeLineGutter': { backgroundColor: p.activeLine, color: p.fg },
            '.cm-foldPlaceholder': {
                backgroundColor: 'transparent',
                border: 'none',
                color: p.comment,
            },
            '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
                backgroundColor: p.selection,
                outline: `1px solid ${p.gutter}`,
            },
            '.cm-selectionMatch': { backgroundColor: alpha(p.selection, '99') },
            '.cm-searchMatch': { backgroundColor: alpha(p.constant, '55') },
            // 찾기 상자 등 에디터 위 창 (테마 배경이 없으면 글자가 비쳐 보임)
            '.cm-panels': { backgroundColor: p.gutterBg ?? p.bg, color: p.fg },
        },
        { dark }
    ),
    syntaxHighlighting(
        HighlightStyle.define([
            ...SYNTAX_RULES.map(({ tag, color }) => ({
                tag,
                color: color === 'control' ? (p.control ?? p.keyword) : p[color],
            })),
            { tag: t.invalid, color: '#f44747' },
        ])
    ),
];

const built = new Map<string, Extension>();

/** 테마의 CodeMirror 확장. prefersDark는 '자동'일 때 쓸 시스템 설정입니다. */
export const editorThemeExtension = (id: string, prefersDark: boolean): Extension => {
    if (id === 'one-dark') return oneDark;
    const found = PALETTES.find((theme) => theme.id === id);
    if (!found) {
        return prefersDark
            ? oneDark
            : syntaxHighlighting(defaultHighlightStyle, { fallback: true });
    }
    let extension = built.get(id);
    if (!extension) {
        extension = fromPalette(found.palette, found.dark);
        built.set(id, extension);
    }
    return extension;
};
