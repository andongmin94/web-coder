// 내 템플릿: 언어(런타임)별로 저장해 새 문제와 "템플릿으로 초기화"에 씁니다. (설정 메뉴)
import type { LanguageIntel } from '../intel/types.ts';
import { RUNTIMES, type ResolvedLanguage, type RuntimeKey } from '../shared/languages.ts';
import type { CodeStore } from './code-store.ts';
import type { CodeEditor } from './editor.ts';
import type { Elements } from './elements.ts';
import type { SolverState } from './state.ts';
import { storage } from './storage.ts';
import type { ShowToast } from './toast.ts';

/** 템플릿을 나눠 저장하는 단위 (C++17과 C++20은 같은 템플릿) */
const LANGUAGE_GROUP: Record<RuntimeKey, string> = {
    cpp: 'C++',
    python: 'Python',
    javascript: 'node.js',
    java: 'Java',
};

/** 내 템플릿이 있으면 그것, 없으면 기본 템플릿 */
export const templateFor = async (runtime: RuntimeKey) =>
    (await storage.getTemplate(runtime)) ?? RUNTIMES[runtime].template;

export const setupTemplates = (deps: {
    state: SolverState;
    els: Elements;
    editor: CodeEditor;
    store: CodeStore;
    intelFor: (lang: ResolvedLanguage) => LanguageIntel;
    showToast: ShowToast;
}) => {
    const { state, els, editor, store, showToast } = deps;

    const updateTemplateMenu = async () => {
        if (!state.current) return;
        const custom = await storage.getTemplate(state.current.runtime);
        els.resetButton.textContent = custom ? '내 템플릿으로 초기화' : '템플릿으로 초기화';
        els.clearTemplateButton.hidden = custom === undefined;
    };

    els.resetButton.addEventListener('click', async () => {
        els.settingsPanel.hidden = true;
        const lang = state.current;
        if (!lang) return;
        const custom = await storage.getTemplate(lang.runtime);
        const what = custom ? '내 템플릿' : '기본 템플릿';
        if (!confirm(`코드를 ${what}으로 되돌릴까요? 지금 코드는 사라집니다.`)) return;
        editor.load(
            custom ?? RUNTIMES[lang.runtime].template,
            RUNTIMES[lang.runtime],
            deps.intelFor(lang)
        );
        store.saveCodeNow();
    });
    els.saveTemplateButton.addEventListener('click', async () => {
        els.settingsPanel.hidden = true;
        const lang = state.current;
        if (!lang) return;
        await storage.setTemplate(lang.runtime, editor.value);
        await updateTemplateMenu();
        showToast(
            `${LANGUAGE_GROUP[lang.runtime]} 템플릿으로 저장했습니다. 새 문제를 열면 이 코드로 시작합니다.`
        );
    });
    els.clearTemplateButton.addEventListener('click', async () => {
        els.settingsPanel.hidden = true;
        const lang = state.current;
        if (!lang) return;
        await storage.setTemplate(lang.runtime, null);
        await updateTemplateMenu();
        showToast(`${LANGUAGE_GROUP[lang.runtime]} 템플릿을 기본으로 되돌렸습니다.`);
    });

    return { updateTemplateMenu };
};
