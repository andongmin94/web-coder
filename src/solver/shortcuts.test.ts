import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { BASE_KEYS, keymapExtension, type KeymapName } from './keymaps.ts';
import { keyLabel, shortcutGroups } from './shortcuts.ts';

/** 'Alt-A'(대문자는 Shift 포함)와 'Shift-Alt-a'를 같게, Mod는 Windows 기준 Ctrl로 */
const normalize = (key: string) => {
    const parts = key.split(/-(?=.)/);
    let last = parts.pop()!;
    const mods = new Set(parts.map((m) => (m === 'Mod' ? 'Ctrl' : m)));
    if (/^[A-Z]$/.test(last)) mods.add('Shift');
    if (last.length === 1) last = last.toLowerCase();
    return [...[...mods].sort(), last].join('-');
};

const boundKeys = (name: KeymapName) => {
    const state = EditorState.create({ extensions: [keymapExtension(name), keymap.of(BASE_KEYS)] });
    const keys = new Set<string>();
    for (const bindings of state.facet(keymap))
        for (const b of bindings) {
            const key = b.win ?? b.key;
            if (!key) continue;
            keys.add(key.split(' ').map(normalize).join(' '));
            if (b.shift) keys.add(`Shift-${key}`.split(' ').map(normalize).join(' '));
        }
    return keys;
};

test('목록의 에디터 단축키는 그 키 설정에 실제로 있다', () => {
    for (const name of ['vscode', 'intellij', 'visualstudio'] as const) {
        const bound = boundKeys(name);
        // 첫 묶음(웹 코더 기능)은 문서 전체에서 처리하므로 빼고 봄. 마우스 동작도 제외
        for (const group of shortcutGroups(name).slice(1))
            for (const item of group.items)
                for (const key of item.keys) {
                    if (/클릭|끌기/.test(key)) continue;
                    const normalized = key.split(' ').map(normalize).join(' ');
                    assert.ok(bound.has(normalized), `${name}: ${item.label} (${key})`);
                }
    }
});

test('다시 실행: Ctrl+Shift+Z는 어느 키 설정에서든 된다 (IntelliJ는 Ctrl+Y가 줄 삭제)', () => {
    for (const name of ['vscode', 'intellij', 'visualstudio'] as const)
        assert.ok(boundKeys(name).has('Ctrl-Shift-z'), name);
});

test('키 표시', () => {
    assert.equal(keyLabel('Mod-Shift-k'), 'Ctrl+Shift+K');
    assert.equal(keyLabel('Mod-k Mod-c'), 'Ctrl+K, Ctrl+C');
    assert.equal(keyLabel('Shift-Alt-ArrowUp'), 'Shift+Alt+↑');
    assert.equal(keyLabel('Mod-['), 'Ctrl+[');
    assert.equal(keyLabel('Shift-Alt-.'), 'Shift+Alt+.');
    assert.equal(keyLabel('Mod-Shift-Enter', true), '⌘⇧↩');
    assert.equal(keyLabel(':w'), ':w');
    assert.equal(keyLabel('dd'), 'dd');
    assert.equal(keyLabel('F3'), 'F3');
});
