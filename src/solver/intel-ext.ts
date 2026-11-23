// LanguageIntel(언어별 엔진) → CodeMirror 확장: 자동완성, 실시간 진단, 호버, 시그니처 힌트
import {
    autocompletion,
    insertBracket,
    pickedCompletion,
    snippetCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
    EditorView,
    hoverTooltip,
    showTooltip,
    ViewPlugin,
    type Tooltip,
    type ViewUpdate,
} from '@codemirror/view';
import type { IntelCompletion, IntelSignature, LanguageIntel } from '../intel/types.ts';
import { h } from './dom.ts';

const toCompletion = (item: IntelCompletion): Completion => {
    const base = {
        label: item.label,
        type: item.kind === 'snippet' ? 'text' : item.kind,
        detail: item.detail,
        boost: item.boost,
    };
    // 인자가 있는 함수(`이름(${})`): 이름을 넣고 여는 괄호는 "입력한 것처럼" 넣습니다.
    // 그래야 에디터가 닫는 괄호를 자기가 넣은 것으로 기억해서, 인자를 쓰고 `)`를 쳤을 때
    // 괄호가 두 개(`f(3))`)가 되지 않고 덮어씁니다.
    const call = item.apply ? /^([\w$.]+)\(\$\{\}\)$/.exec(item.apply) : null;
    if (call) {
        return {
            ...base,
            apply: (view, completion, from, to) => {
                view.dispatch({
                    changes: { from, to, insert: call[1] },
                    selection: { anchor: from + call[1].length },
                    annotations: pickedCompletion.of(completion),
                    userEvent: 'input.complete',
                });
                const bracket = insertBracket(view.state, '(');
                view.dispatch(
                    bracket ?? {
                        ...view.state.replaceSelection('()'),
                        selection: { anchor: view.state.selection.main.head + 1 },
                    }
                );
            },
        };
    }
    if (item.apply && item.apply.includes('${')) return snippetCompletion(item.apply, base);
    return { ...base, apply: item.apply };
};

// ── 시그니처 힌트 ───────────────────────────────────────────────────

const setSignature = StateEffect.define<{ pos: number; sigs: IntelSignature[] } | null>();

const signatureField = StateField.define<{ pos: number; sigs: IntelSignature[] } | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setSignature)) return e.value;
        if (!value) return value;
        // 커서가 호출 밖으로 나가면(닫는 괄호 입력, 줄 이동 등) 숨깁니다.
        const head = tr.state.selection.main.head;
        const pos = tr.changes.mapPos(value.pos);
        const line = tr.state.doc.lineAt(head);
        if (head < pos || line.number !== tr.state.doc.lineAt(pos).number) return null;
        if (
            tr.docChanged &&
            /\)\s*$/.test(tr.state.sliceDoc(pos, head)) &&
            !insideCall(tr.state.sliceDoc(pos, head))
        )
            return null;
        return { ...value, pos };
    },
    provide: (f) =>
        showTooltip.from(f, (value): Tooltip | null =>
            value && value.sigs.length
                ? {
                      pos: value.pos,
                      above: true,
                      strictSide: false,
                      create: () => ({ dom: renderSignatures(value.sigs) }),
                  }
                : null
        ),
});

/** pos 이후 텍스트에서 괄호가 아직 열려 있는지 */
const insideCall = (text: string) => {
    let depth = 1;
    for (const ch of text) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (depth === 0) return false;
    }
    return true;
};

const renderSignatures = (sigs: IntelSignature[]) => {
    const dom = h('div', { class: 'cm-signature' });
    for (const sig of sigs.slice(0, 6)) {
        const row = h('div', { class: 'cm-signature-row' });
        if (sig.active) {
            const [a, b] = sig.active;
            row.append(
                sig.label.slice(0, a),
                h('b', {}, sig.label.slice(a, b)),
                sig.label.slice(b)
            );
        } else {
            row.append(sig.label);
        }
        dom.append(row);
        if (sig.doc) dom.append(h('div', { class: 'cm-signature-doc' }, sig.doc));
    }
    if (sigs.length > 6)
        dom.append(h('div', { class: 'cm-signature-doc' }, `+${sigs.length - 6}개 더`));
    return dom;
};

/** 이 위치를 감싸는 호출의 '(' 위치. 없으면 -1 */
const callOpenParen = (code: string, pos: number) => {
    let depth = 0;
    for (let i = pos - 1; i >= 0 && pos - i < 2000; i--) {
        const ch = code[i];
        if (ch === ')' || ch === ']') depth++;
        else if (ch === '(' || ch === '[') {
            if (depth === 0)
                return ch === '(' && /[\w$>]\s*$/.test(code.slice(Math.max(0, i - 40), i)) ? i : -1;
            depth--;
        } else if ((ch === ';' || ch === '{' || ch === '}') && depth === 0) return -1;
    }
    return -1;
};

const signaturePlugin = (getIntel: () => LanguageIntel | null) =>
    ViewPlugin.fromClass(
        class {
            private seq = 0;
            destroy() {
                this.seq++;
            }
            update(update: ViewUpdate) {
                const intel = getIntel();
                if (!intel?.signature || !update.docChanged) return;
                let typed = '';
                update.transactions.forEach((tr) =>
                    tr.changes.iterChanges(
                        (_a, _b, _c, _d, inserted) => (typed += inserted.toString())
                    )
                );
                const view = update.view;
                const code = view.state.doc.toString();
                const pos = view.state.selection.main.head;
                // `(`나 `,`를 입력했을 때, 또는 자동완성으로 `이름()`이 들어가 커서가 괄호 안에 놓였을 때
                const typedCall = /[(,]\s*$/.test(typed);
                const completedCall = /\(\)$/.test(typed) && code[pos - 1] === '(';
                if (!typedCall && !completedCall) return;
                const open = callOpenParen(code, pos);
                if (open < 0) return;
                const seq = ++this.seq;
                const doc = view.state.doc;
                void intel.signature(code, pos).then((sigs) => {
                    // 기다리는 사이 코드가 바뀌었거나(언어 전환으로 문서 교체 포함) 더 새 요청이 있으면 버립니다.
                    if (seq !== this.seq || view.state.doc !== doc) return;
                    view.dispatch({
                        effects: setSignature.of(
                            sigs && sigs.length ? { pos: open + 1, sigs } : null
                        ),
                    });
                });
            }
        }
    );

// ── 확장 묶음 ───────────────────────────────────────────────────────

export const intelExtensions = (getIntel: () => LanguageIntel | null): Extension => [
    autocompletion({
        activateOnTyping: true,
        activateOnTypingDelay: 80,
        maxRenderedOptions: 60,
        icons: true,
        override: [
            async (ctx: CompletionContext): Promise<CompletionResult | null> => {
                const intel = getIntel();
                if (!intel?.complete) return null;
                const code = ctx.state.doc.toString();
                const before = code.slice(Math.max(0, ctx.pos - 2), ctx.pos);
                const word = ctx.matchBefore(/[\w$]*/);
                const triggered = (intel.triggerCharacters ?? []).some(
                    (t) =>
                        before.endsWith(t) || code.slice(0, word ? word.from : ctx.pos).endsWith(t)
                );
                if (!ctx.explicit && !triggered && (!word || word.to - word.from < 1)) return null;
                const result = await intel.complete(code, ctx.pos, ctx.explicit);
                if (!result || ctx.aborted || result.items.length === 0) return null;
                return {
                    from: result.from,
                    options: result.items.map(toCompletion),
                    // 같은 단어를 계속 입력하는 동안에는 다시 묻지 않고 걸러 냅니다.
                    validFor: /^[\w$]*$/,
                };
            },
        ],
    }),
    linter(
        async (view): Promise<Diagnostic[]> => {
            const intel = getIntel();
            if (!intel?.diagnose) return [];
            const doc = view.state.doc;
            const list = await intel.diagnose(doc.toString());
            // 기다리는 사이 코드가 바뀌었으면(언어 전환 포함) 옛 위치의 진단은 버립니다. 바뀐 코드로 다시 돕니다.
            if (view.state.doc !== doc) return [];
            const len = doc.length;
            return list
                .filter((d) => d.from <= len)
                .map((d) => ({
                    from: Math.min(d.from, len),
                    to: Math.min(Math.max(d.to, d.from), len),
                    severity: d.severity,
                    message: d.message,
                }));
        },
        { delay: 700 }
    ),
    lintGutter(),
    hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
        const intel = getIntel();
        if (!intel?.hover) return null;
        const doc = view.state.doc;
        const text = await intel.hover(doc.toString(), pos);
        // 기다리는 사이 문서가 바뀌면 pos가 새 문서 밖일 수 있습니다.
        if (!text || view.state.doc !== doc) return null;
        return {
            pos,
            above: true,
            create: () => ({ dom: h('pre', { class: 'cm-hover-info' }, text) }),
        };
    }),
    signatureField,
    signaturePlugin(getIntel),
    EditorView.domEventHandlers({
        keydown: (e, view) => {
            if (e.key === 'Escape' && view.state.field(signatureField, false)) {
                view.dispatch({ effects: setSignature.of(null) });
            }
            return false;
        },
    }),
];
