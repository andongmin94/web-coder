// CodeMirror 6 에디터 (+ 언어별 인텔리센스)
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import {
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
} from '@codemirror/view';
import {
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentLess } from '@codemirror/commands';
import {
    acceptCompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import type { RuntimeInfo } from '../shared/languages.ts';
import type { LanguageIntel } from '../intel/types.ts';
import { intelExtensions } from './intel-ext.ts';
import { insertTab } from './tab.ts';
import { keymapExtension, type KeymapName } from './keymaps.ts';
import { indentGuides } from './indent-guides.ts';
import { languageExtension } from './syntax.ts';
import { AUTO_THEME, editorThemeExtension } from './themes.ts';

export type EditorHandlers = {
    onChange: (code: string) => void;
    onRun: () => void;
    onSubmit: () => void;
};

export class CodeEditor {
    private readonly view: EditorView;
    private readonly languageSlot = new Compartment();
    private readonly themeSlot = new Compartment();
    private readonly wrapSlot = new Compartment();
    private readonly keymapSlot = new Compartment();
    private keymapName: KeymapName = 'vscode';
    private theme = AUTO_THEME;
    private wrap = true;
    private readonly darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    private languageExt: Extension = [];
    private readonly handlers: EditorHandlers;
    private intel: LanguageIntel | null = null;

    constructor(parent: HTMLElement, handlers: EditorHandlers) {
        this.handlers = handlers;
        this.view = new EditorView({ parent, state: this.createState('') });
        this.darkQuery.addEventListener('change', () => {
            this.view.dispatch({ effects: this.themeSlot.reconfigure(this.themeExt()) });
        });
    }

    /** "화면 밝기"를 직접 고른 경우 (null이면 시스템 설정) */
    private scheme: 'light' | 'dark' | null = null;

    private themeExt(): Extension {
        const dark = this.scheme ? this.scheme === 'dark' : this.darkQuery.matches;
        return editorThemeExtension(this.theme, dark);
    }

    /** 자동 테마가 따를 밝기. 화면 밝기를 고르면 시스템 설정 대신 그것을 따릅니다. */
    setScheme(scheme: 'light' | 'dark' | null) {
        this.scheme = scheme;
        this.view.dispatch({ effects: this.themeSlot.reconfigure(this.themeExt()) });
    }

    private wrapExt(): Extension {
        return this.wrap ? EditorView.lineWrapping : [];
    }

    /** 에디터 테마 (themes.ts의 id, 또는 시스템 설정을 따르는 AUTO_THEME) */
    setTheme(id: string) {
        this.theme = id;
        this.view.dispatch({ effects: this.themeSlot.reconfigure(this.themeExt()) });
    }

    /** 긴 줄을 화면 너비에 맞춰 접을지 */
    setWrap(wrap: boolean) {
        this.wrap = wrap;
        this.view.dispatch({ effects: this.wrapSlot.reconfigure(this.wrapExt()) });
    }

    /** 키 설정 (VS Code 또는 IntelliJ) */
    setKeymap(name: KeymapName) {
        this.keymapName = name;
        this.view.dispatch({ effects: this.keymapSlot.reconfigure(keymapExtension(name)) });
    }

    /** 글자 크기 같은 스타일이 바뀐 뒤 줄 높이를 다시 재게 합니다. */
    refresh() {
        this.view.requestMeasure();
    }

    private createState(doc: string) {
        const { onRun, onSubmit, onChange } = this.handlers;
        return EditorState.create({
            doc,
            extensions: [
                lineNumbers(),
                highlightActiveLineGutter(),
                highlightSpecialChars(),
                history(),
                foldGutter(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentOnInput(),
                bracketMatching(),
                closeBrackets(),
                highlightActiveLine(),
                indentGuides,
                highlightSelectionMatches(),
                Prec.highest(
                    keymap.of([
                        { key: 'Mod-Enter', run: () => (onRun(), true) },
                        { key: 'Mod-Shift-Enter', run: () => (onSubmit(), true) },
                    ])
                ),
                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...searchKeymap,
                    ...historyKeymap,
                    ...foldKeymap,
                    ...completionKeymap,
                    ...lintKeymap,
                    // 자동 완성 목록이 열려 있으면 Tab으로 고릅니다. (VS Code처럼) 닫혀 있으면 들여쓰기
                    { key: 'Tab', run: acceptCompletion },
                    // 커서 자리에 공백 (여러 줄 선택이면 그 줄들을 들여쓰기), Shift+Tab은 내어쓰기
                    { key: 'Tab', run: insertTab, shift: indentLess },
                ]),
                indentUnit.of('    '),
                EditorState.tabSize.of(4),
                intelExtensions(() => this.intel),
                this.languageSlot.of(this.languageExt),
                this.themeSlot.of(this.themeExt()),
                this.wrapSlot.of(this.wrapExt()),
                // 키 설정별 단축키와 마우스 동작 (기본 키맵보다 먼저)
                this.keymapSlot.of(keymapExtension(this.keymapName)),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) onChange(update.state.doc.toString());
                }),
            ],
        });
    }

    get value() {
        return this.view.state.doc.toString();
    }

    /** 문서를 교체합니다 (변경 이벤트 없이, 되돌리기 기록도 초기화). */
    load(code: string, runtime: RuntimeInfo, intel: LanguageIntel | null) {
        this.languageExt = languageExtension(runtime.editor);
        this.intel = intel;
        this.view.setState(this.createState(code));
    }

    focus() {
        this.view.focus();
    }

    /** 줄(1부터)과 열(1부터, 없으면 줄 처음 글자)로 커서를 옮기고 화면 가운데로 보여 줍니다. */
    goTo(line: number, column: number | null) {
        const doc = this.view.state.doc;
        const target = doc.line(Math.min(Math.max(1, line), doc.lines));
        const offset =
            column === null
                ? target.text.length - target.text.trimStart().length
                : Math.min(column - 1, target.length);
        const pos = target.from + Math.max(0, offset);
        this.view.dispatch({
            selection: { anchor: pos },
            effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        this.view.focus();
    }
}
