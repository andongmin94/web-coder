// CodeMirror 6 에디터 (+ 언어별 인텔리센스)
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    rectangularSelection,
} from '@codemirror/view';
import {
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
    syntaxHighlighting,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { java } from '@codemirror/lang-java';
import { oneDark } from '@codemirror/theme-one-dark';
import type { RuntimeInfo } from '../shared/languages.ts';
import type { LanguageIntel } from '../intel/types.ts';
import { intelExtensions } from './intel-ext.ts';

const languageExtension = (editor: RuntimeInfo['editor']): Extension => {
    switch (editor) {
        case 'cpp':
            return cpp();
        case 'python':
            return python();
        case 'javascript':
            return javascript();
        case 'java':
            return java();
    }
};

export type EditorHandlers = {
    onChange: (code: string) => void;
    onRun: () => void;
    onSubmit: () => void;
};

export class CodeEditor {
    private readonly view: EditorView;
    private readonly languageSlot = new Compartment();
    private readonly themeSlot = new Compartment();
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

    private themeExt(): Extension {
        return this.darkQuery.matches
            ? oneDark
            : syntaxHighlighting(defaultHighlightStyle, { fallback: true });
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
                rectangularSelection(),
                crosshairCursor(),
                highlightActiveLine(),
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
                    indentWithTab,
                ]),
                indentUnit.of('    '),
                EditorState.tabSize.of(4),
                intelExtensions(() => this.intel),
                this.languageSlot.of(this.languageExt),
                this.themeSlot.of(this.themeExt()),
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
}
