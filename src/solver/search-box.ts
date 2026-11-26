// VS Code처럼 에디터 오른쪽 위에 뜨는 찾기 상자. (CodeMirror 기본 찾기 창은 에디터 위에 가로 막대)
// 찾기 칸 안에 대소문자(Aa)·단어 단위(ab)·정규식(.*) 단추, "3/10" 결과 수, 이전·다음, 바꾸기 줄(▸로 펼침).
// 찾기·바꾸기 동작 자체는 @codemirror/search의 명령을 그대로 씁니다.
import { EditorState, type Extension } from '@codemirror/state';
import {
    EditorView,
    runScopeHandlers,
    type Command,
    type Panel,
    type ViewUpdate,
} from '@codemirror/view';
import {
    closeSearchPanel,
    findNext,
    findPrevious,
    getSearchQuery,
    openSearchPanel,
    replaceAll,
    replaceNext,
    search,
    SearchQuery,
    selectMatches,
    setSearchQuery,
} from '@codemirror/search';
import { h } from './dom.ts';

/** 결과 수는 이만큼까지만 셉니다. (그 이상은 "1000+") */
const COUNT_LIMIT = 1000;

/** 문서에서 찾은 개수와, 지금 선택이 몇 번째 결과인지 (결과 위가 아니면 0) */
export const countMatches = (state: EditorState, query: SearchQuery) => {
    if (!query.valid) return { total: 0, current: 0, capped: false };
    const { from, to } = state.selection.main;
    let total = 0;
    let current = 0;
    const cursor = query.getCursor(state);
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
        total++;
        if (next.value.from === from && next.value.to === to) current = total;
        if (total >= COUNT_LIMIT) return { total, current, capped: true };
    }
    return { total, current, capped: false };
};

const boxes = new WeakMap<EditorView, SearchBox>();

class SearchBox implements Panel {
    readonly dom: HTMLElement;
    readonly top = true;
    private query: SearchQuery;
    private readonly searchField: HTMLInputElement;
    private readonly replaceField: HTMLInputElement;
    private readonly toggles: Record<'caseSensitive' | 'wholeWord' | 'regexp', HTMLButtonElement>;
    private readonly count: HTMLElement;
    private readonly replaceRow: HTMLElement;
    private readonly expand: HTMLButtonElement;

    private readonly view: EditorView;

    constructor(view: EditorView) {
        this.view = view;
        this.query = getSearchQuery(view.state);
        const commit = () => this.commit();
        const field = (name: string, placeholder: string, main = false) =>
            h('input', {
                class: 'cm-textfield',
                name,
                placeholder,
                'aria-label': placeholder,
                'main-field': main ? 'true' : undefined,
                spellcheck: 'false',
                autocomplete: 'off',
                onInput: commit,
            });
        const button = (label: string, title: string, run: () => void, cls = '') =>
            h(
                'button',
                {
                    type: 'button',
                    class: `sb-button ${cls}`,
                    title,
                    'aria-label': title,
                    onClick: run,
                },
                label
            );
        const toggle = (label: string, title: string, key: keyof SearchBox['toggles']) =>
            h(
                'button',
                {
                    type: 'button',
                    class: 'sb-toggle',
                    title,
                    'aria-label': title,
                    'aria-pressed': 'false',
                    onClick: () => this.flip(key),
                },
                label
            );

        this.searchField = field('search', '찾기', true);
        this.replaceField = field('replace', '바꾸기');
        this.toggles = {
            caseSensitive: toggle('Aa', '대소문자 구분 (Alt+C)', 'caseSensitive'),
            wholeWord: toggle('ab', '단어 단위로 (Alt+W)', 'wholeWord'),
            regexp: toggle('.*', '정규식 (Alt+R)', 'regexp'),
        };
        this.count = h('span', { class: 'sb-count', 'aria-live': 'polite' });
        this.expand = h(
            'button',
            {
                type: 'button',
                class: 'sb-expand',
                title: '바꾸기 펼치기',
                'aria-label': '바꾸기 펼치기',
                'aria-expanded': 'false',
                onClick: () => this.showReplace(Boolean(this.replaceRow.hidden)),
            },
            '›'
        );
        this.replaceRow = h('div', { class: 'sb-row', hidden: true }, [
            h('div', { class: 'sb-field' }, [this.replaceField]),
            button('바꾸기', '바꾸기 (Enter)', () => replaceNext(view), 'sb-text'),
            button('모두', '모두 바꾸기 (Ctrl+Alt+Enter)', () => replaceAll(view), 'sb-text'),
        ]);
        this.dom = h(
            'div',
            { class: 'cm-search sb-box', onKeydown: (e) => this.keydown(e as KeyboardEvent) },
            [
                this.expand,
                h('div', { class: 'sb-rows' }, [
                    h('div', { class: 'sb-row' }, [
                        h('div', { class: 'sb-field' }, [
                            this.searchField,
                            this.toggles.caseSensitive,
                            this.toggles.wholeWord,
                            this.toggles.regexp,
                        ]),
                        this.count,
                        button('↑', '이전 (Shift+Enter)', () => findPrevious(view)),
                        button('↓', '다음 (Enter)', () => findNext(view)),
                        button('≡', '모두 선택 (Alt+Enter)', () => selectMatches(view)),
                        button('×', '닫기 (Esc)', () => closeSearchPanel(view), 'sb-close'),
                    ]),
                    this.replaceRow,
                ]),
            ]
        );
        this.setQuery(this.query);
        boxes.set(view, this);
    }

    mount() {
        this.searchField.select();
        this.renderCount();
    }

    destroy() {
        boxes.delete(this.view);
    }

    showReplace(open: boolean) {
        this.replaceRow.hidden = !open;
        this.expand.setAttribute('aria-expanded', String(open));
        this.expand.classList.toggle('open', open);
        this.expand.title = open ? '바꾸기 접기' : '바꾸기 펼치기';
    }

    private flip(key: keyof SearchBox['toggles']) {
        const pressed = this.toggles[key].getAttribute('aria-pressed') !== 'true';
        this.toggles[key].setAttribute('aria-pressed', String(pressed));
        this.commit();
    }

    private commit() {
        const query = new SearchQuery({
            search: this.searchField.value,
            replace: this.replaceField.value,
            caseSensitive: this.toggles.caseSensitive.getAttribute('aria-pressed') === 'true',
            wholeWord: this.toggles.wholeWord.getAttribute('aria-pressed') === 'true',
            regexp: this.toggles.regexp.getAttribute('aria-pressed') === 'true',
        });
        if (query.eq(this.query)) return;
        this.query = query;
        this.view.dispatch({ effects: setSearchQuery.of(query) });
    }

    private setQuery(query: SearchQuery) {
        this.query = query;
        this.searchField.value = query.search;
        this.replaceField.value = query.replace;
        this.toggles.caseSensitive.setAttribute('aria-pressed', String(query.caseSensitive));
        this.toggles.wholeWord.setAttribute('aria-pressed', String(query.wholeWord));
        this.toggles.regexp.setAttribute('aria-pressed', String(query.regexp));
    }

    private renderCount() {
        const invalid = this.query.search !== '' && !this.query.valid;
        const { total, current, capped } = countMatches(this.view.state, this.query);
        this.count.textContent = !this.query.search
            ? ''
            : invalid
              ? '잘못된 식'
              : total === 0
                ? '결과 없음'
                : `${current || '?'}/${total}${capped ? '+' : ''}`;
        this.dom.classList.toggle('sb-none', this.query.search !== '' && total === 0);
    }

    update(update: ViewUpdate) {
        let queryChanged = false;
        for (const tr of update.transactions)
            for (const effect of tr.effects)
                if (effect.is(setSearchQuery)) {
                    queryChanged = true;
                    if (!effect.value.eq(this.query)) this.setQuery(effect.value);
                }
        if (queryChanged || update.docChanged || update.selectionSet) this.renderCount();
    }

    private keydown(e: KeyboardEvent) {
        const { view } = this;
        if (runScopeHandlers(view, e, 'search-panel')) {
            e.preventDefault();
            return;
        }
        const key = e.key.toLowerCase();
        let handled = true;
        if (e.altKey && !e.ctrlKey && !e.metaKey && (key === 'c' || key === 'w' || key === 'r'))
            this.flip(key === 'c' ? 'caseSensitive' : key === 'w' ? 'wholeWord' : 'regexp');
        else if (e.key === 'Enter' && e.target === this.searchField)
            if (e.altKey) selectMatches(view);
            else (e.shiftKey ? findPrevious : findNext)(view);
        else if (e.key === 'Enter' && e.target === this.replaceField)
            (e.altKey && (e.ctrlKey || e.metaKey) ? replaceAll : replaceNext)(view);
        else handled = false;
        if (handled) e.preventDefault();
    }
}

const createSearchBox = (view: EditorView) => new SearchBox(view);

/** 찾기 상자를 열고 바꾸기 줄도 펼칩니다. (VS Code·Visual Studio의 Ctrl+H, IntelliJ의 Ctrl+R) */
export const openReplacePanel: Command = (view) => {
    openSearchPanel(view);
    boxes.get(view)?.showReplace(true);
    return true;
};

/** 찾기 상자 설정 + CodeMirror가 띄우는 다른 창(줄 번호로 이동)의 한국어 문구 */
export const searchBox: Extension = [
    search({ top: true, createPanel: createSearchBox }),
    EditorState.phrases.of({ 'Go to line': '줄 번호', go: '이동', close: '닫기' }),
];
