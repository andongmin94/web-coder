// CodeMirror 6 에디터
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { java } from '@codemirror/lang-java';
import { oneDark } from '@codemirror/theme-one-dark';
import type { RuntimeInfo } from '../shared/languages.ts';

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

    constructor(parent: HTMLElement, handlers: EditorHandlers) {
        this.handlers = handlers;
        this.view = new EditorView({ parent, state: this.createState('') });
        this.darkQuery.addEventListener('change', () => {
            this.view.dispatch({ effects: this.themeSlot.reconfigure(this.themeExt()) });
        });
    }

    private themeExt(): Extension {
        return this.darkQuery.matches ? oneDark : [];
    }

    private createState(doc: string) {
        const { onRun, onSubmit, onChange } = this.handlers;
        return EditorState.create({
            doc,
            extensions: [
                basicSetup,
                keymap.of([indentWithTab]),
                Prec.highest(
                    keymap.of([
                        { key: 'Mod-Enter', run: () => (onRun(), true) },
                        { key: 'Mod-Shift-Enter', run: () => (onSubmit(), true) },
                    ])
                ),
                indentUnit.of('    '),
                EditorState.tabSize.of(4),
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
    load(code: string, runtime: RuntimeInfo) {
        this.languageExt = languageExtension(runtime.editor);
        this.view.setState(this.createState(code));
    }

    focus() {
        this.view.focus();
    }
}
