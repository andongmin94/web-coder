// 설정 창의 에디터·화면 설정: 테마, 화면 밝기, 글꼴, 글자 크기, 줄바꿈, 단축키(VS Code, IntelliJ, Visual Studio, Vim).
// 바꾼 값은 바로 적용하고 prefs에 저장합니다.
import type { CodeEditor } from './editor.ts';
import {
    canQueryLocalFonts,
    defaultFontInUse,
    editorFontFamily,
    installedCodingFonts,
    isFontInstalled,
    queryAllFontFamilies,
} from './fonts.ts';
import { AUTO_THEME, EDITOR_THEMES } from './themes.ts';
import { isKeymapName, KEYMAPS, type KeymapName } from './keymaps.ts';
import { keyLabel, shortcutGroups } from './shortcuts.ts';
import { storage } from './storage.ts';
import { $, h } from './dom.ts';

type ShowToast = (message: string, kind?: 'info' | 'error') => void;

export const setupEditorSettings = (editor: CodeEditor, showToast: ShowToast) => {
    const themeSelect = $<HTMLSelectElement>('#editor-theme');
    const fontSizeSelect = $<HTMLSelectElement>('#editor-font-size');
    const wrapCheckbox = $<HTMLInputElement>('#editor-wrap');
    const keymapSelect = $<HTMLSelectElement>('#editor-keymap');
    keymapSelect.replaceChildren(
        ...KEYMAPS.map((k) =>
            h('option', { value: k.id }, k.id === 'vscode' ? `${k.label} (기본)` : k.label)
        )
    );
    const FONT_SIZES = [12, 13, 14, 14.5, 15, 16, 18, 20];
    const DEFAULT_FONT_SIZE = 14.5;

    // 출처별로 묶고, 그 안에서 밝은 테마를 먼저 보여 줍니다.
    const themeGroups = [...new Set(EDITOR_THEMES.map((theme) => theme.group))].map((group) =>
        h(
            'optgroup',
            { label: group },
            EDITOR_THEMES.filter((theme) => theme.group === group)
                .sort((x, y) => Number(x.dark) - Number(y.dark))
                .map((theme) =>
                    h('option', { value: theme.id }, `${theme.name}${theme.dark ? ' ●' : ' ○'}`)
                )
        )
    );
    themeSelect.replaceChildren(
        h('option', { value: AUTO_THEME }, '시스템 설정 따름'),
        ...themeGroups
    );
    fontSizeSelect.replaceChildren(
        ...FONT_SIZES.map((size) => h('option', { value: String(size) }, `${size}px`))
    );

    /** 에디터 테마는 에디터에만 적용합니다. (작업 공간 밝기는 "화면 밝기"로 따로 고름) */
    const applyTheme = (id: string) => editor.setTheme(id);

    const applyAppearance = (value: string) => {
        const scheme = value === 'light' || value === 'dark' ? value : null;
        if (scheme) document.documentElement.dataset.scheme = scheme;
        else delete document.documentElement.dataset.scheme;
        // 에디터 테마가 "시스템 설정 따름"이면 에디터도 이 밝기를 따릅니다. (다른 테마를 고르면 그 테마 그대로)
        editor.setScheme(scheme);
    };
    const applyFontSize = (size: number) => {
        document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
        editor.refresh();
    };

    // ── 글꼴: PC에 설치된 코딩 글꼴 + 직접 입력 + (지원하면) 모든 글꼴 ──
    const fontSelect = $<HTMLSelectElement>('#editor-font');
    const fontCustomRow = $<HTMLElement>('#editor-font-custom-row');
    const fontCustomInput = $<HTMLInputElement>('#editor-font-custom');
    const FONT_CUSTOM = '\u0000custom';
    const FONT_ALL = '\u0000all';
    let allFonts: string[] = [];
    let currentFont = '';

    const renderFontOptions = () => {
        const detected = installedCodingFonts();
        const extra = allFonts.filter((name) => !detected.includes(name));
        // 저장된 글꼴이 목록에 없으면(직접 입력 등) 그 이름을 그대로 보여 줍니다.
        const saved =
            currentFont && !detected.includes(currentFont) && !extra.includes(currentFont)
                ? [currentFont]
                : [];
        fontSelect.replaceChildren(
            h('option', { value: '' }, `기본 (${defaultFontInUse() ?? '고정폭'})`),
            ...saved.map((name) => h('option', { value: name }, name)),
            detected.length
                ? h(
                      'optgroup',
                      { label: '설치된 코딩 글꼴' },
                      detected.map((name) => h('option', { value: name }, name))
                  )
                : '',
            extra.length
                ? h(
                      'optgroup',
                      { label: '이 PC의 모든 글꼴' },
                      extra.map((name) => h('option', { value: name }, name))
                  )
                : '',
            h('option', { value: FONT_CUSTOM }, '직접 입력…'),
            canQueryLocalFonts() && !allFonts.length
                ? h('option', { value: FONT_ALL }, '이 PC의 모든 글꼴 불러오기…')
                : ''
        );
        fontSelect.value = currentFont;
    };

    const applyFont = (name: string) => {
        currentFont = name.trim();
        document.documentElement.style.setProperty('--editor-font', editorFontFamily(currentFont));
        editor.refresh();
    };
    const saveFont = (name: string) => {
        applyFont(name);
        void storage.updatePrefs({ editorFont: currentFont });
    };

    fontSelect.addEventListener('change', async () => {
        const value = fontSelect.value;
        fontCustomRow.hidden = value !== FONT_CUSTOM;
        if (value === FONT_CUSTOM) {
            fontCustomInput.value = currentFont;
            fontCustomInput.focus();
            return;
        }
        if (value === FONT_ALL) {
            // 브라우저가 글꼴 목록 권한을 물어봅니다. (선택 직후라 사용자 동작으로 인정됨)
            fontSelect.value = currentFont;
            const families = await queryAllFontFamilies();
            if (!families) {
                showToast(
                    '글꼴 목록을 읽지 못했습니다. "직접 입력"으로 글꼴 이름을 넣어 보세요.',
                    'error'
                );
                return;
            }
            allFonts = families;
            renderFontOptions();
            showToast(`글꼴 ${families.length}개를 불러왔습니다.`);
            return;
        }
        saveFont(value);
    });
    fontCustomInput.addEventListener('change', () => {
        const name = fontCustomInput.value.trim();
        if (name && !isFontInstalled(name)) {
            showToast(`"${name}" 글꼴을 이 PC에서 찾지 못해 기본 글꼴로 보입니다.`, 'error');
        }
        saveFont(name);
        fontCustomRow.hidden = true;
        renderFontOptions();
    });

    const appearanceSelect = $<HTMLSelectElement>('#appearance');
    appearanceSelect.addEventListener('change', () => {
        applyAppearance(appearanceSelect.value);
        const value = appearanceSelect.value;
        void storage.updatePrefs({
            appearance: value === 'light' || value === 'dark' ? value : undefined,
        });
    });

    void storage.getPrefs().then((prefs) => {
        const theme = EDITOR_THEMES.some((t) => t.id === prefs.editorTheme)
            ? prefs.editorTheme!
            : AUTO_THEME;
        const size = FONT_SIZES.includes(prefs.editorFontSize ?? NaN)
            ? prefs.editorFontSize!
            : DEFAULT_FONT_SIZE;
        themeSelect.value = theme;
        fontSizeSelect.value = String(size);
        // 긴 줄 줄바꿈은 기본으로 켜 둡니다. (직접 끈 사람만 끔)
        wrapCheckbox.checked = prefs.editorWrap !== false;
        appearanceSelect.value = prefs.appearance ?? '';
        applyTheme(theme);
        applyAppearance(appearanceSelect.value);
        applyFont(prefs.editorFont ?? '');
        renderFontOptions();
        applyFontSize(size);
        editor.setWrap(wrapCheckbox.checked);
        keymapSelect.value = isKeymapName(prefs.editorKeymap) ? prefs.editorKeymap : 'vscode';
        editor.setKeymap(keymapSelect.value as KeymapName);
    });

    themeSelect.addEventListener('change', () => {
        applyTheme(themeSelect.value);
        void storage.updatePrefs({ editorTheme: themeSelect.value });
    });
    fontSizeSelect.addEventListener('change', () => {
        const size = Number(fontSizeSelect.value);
        applyFontSize(size);
        void storage.updatePrefs({ editorFontSize: size });
    });
    wrapCheckbox.addEventListener('change', () => {
        editor.setWrap(wrapCheckbox.checked);
        void storage.updatePrefs({ editorWrap: wrapCheckbox.checked });
    });
    keymapSelect.addEventListener('change', () => {
        const name = keymapSelect.value as KeymapName;
        editor.setKeymap(name);
        void storage.updatePrefs({ editorKeymap: name });
    });

    // ── 단축키 목록: 지금 고른 키 설정의 주요 단축키 ──
    const shortcutsDialog = $<HTMLDialogElement>('#shortcuts-dialog');
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const renderShortcuts = (name: KeymapName) => {
        const label = KEYMAPS.find((k) => k.id === name)?.label ?? name;
        $('#shortcuts-title').textContent = `단축키 — ${label}`;
        $('#shortcuts-body').replaceChildren(
            ...shortcutGroups(name).map((group) =>
                h('section', { class: 'shortcuts-group' }, [
                    h('h3', {}, group.title),
                    ...group.items.map((item) =>
                        h('div', { class: 'shortcuts-row' }, [
                            h('span', {}, item.label),
                            h(
                                'span',
                                { class: 'shortcuts-keys' },
                                item.keys.map((key) => h('kbd', {}, keyLabel(key, mac)))
                            ),
                        ])
                    ),
                ])
            ),
            h(
                'p',
                { class: 'shortcuts-note' },
                '키 설정은 설정의 "단축키"에서 바꿉니다. 브라우저가 쓰는 키(Ctrl+W 등)는 넣지 않았습니다.'
            )
        );
    };
    $('#show-shortcuts').addEventListener('click', () => {
        $('#settings').hidden = true;
        $('#settings-button').setAttribute('aria-expanded', 'false');
        renderShortcuts(keymapSelect.value as KeymapName);
        shortcutsDialog.showModal();
    });
    $('#shortcuts-close').addEventListener('click', () => shortcutsDialog.close());
    // 바깥(어두운 배경)을 누르면 닫기
    shortcutsDialog.addEventListener('click', (e) => {
        if (e.target === shortcutsDialog) shortcutsDialog.close();
    });
    // 닫으면 에디터로 돌아갑니다.
    shortcutsDialog.addEventListener('close', () => editor.focus());
};
