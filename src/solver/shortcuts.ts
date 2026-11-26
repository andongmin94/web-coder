// 설정의 "단축키 목록": 고른 키 설정(keymaps.ts)에서 쓸 수 있는 주요 단축키.
// 키는 CodeMirror 표기(Mod-Shift-k, 여러 키는 공백)로 적고, 보여 줄 때 Ctrl/⌘ 등으로 바꿉니다.
// keymaps.ts·editor.ts·CodeMirror 기본 키맵과 맞춰야 합니다. (shortcuts.test.ts가 일부를 확인)
import type { KeymapName } from './keymaps.ts';

export type Shortcut = { keys: string[]; label: string };
export type ShortcutGroup = { title: string; items: Shortcut[] };

const s = (label: string, ...keys: string[]): Shortcut => ({ keys, label });

/** 키 설정과 관계없이 쓰는 단축키 (웹 코더 자체 기능) */
const APP: ShortcutGroup = {
    title: '웹 코더',
    items: [
        s('예제 실행', 'Mod-Enter'),
        s('제출', 'Mod-Shift-Enter'),
        s('문제 패널 접기·펴기', 'Mod-b'),
        s('코드 정렬', 'Shift-Alt-f'),
        s('자동 완성 열기', 'Ctrl-Space'),
        s('자동 완성 고르기 (목록이 열려 있을 때)', 'Tab', 'Enter'),
    ],
};

const FOLD = [s('접기 · 펴기', 'Ctrl-Shift-[', 'Ctrl-Shift-]')];

const EDITOR: Record<Exclude<KeymapName, 'vim'>, ShortcutGroup[]> = {
    vscode: [
        {
            title: '편집',
            items: [
                s('되돌리기 · 다시 실행', 'Mod-z', 'Mod-y'),
                s('줄 주석', 'Mod-/'),
                s('블록 주석', 'Shift-Alt-a'),
                s('줄 옮기기', 'Alt-ArrowUp', 'Alt-ArrowDown'),
                s('줄 복사', 'Shift-Alt-ArrowUp', 'Shift-Alt-ArrowDown'),
                s('줄 삭제', 'Mod-Shift-k'),
                s('내어쓰기 · 들여쓰기', 'Mod-[', 'Mod-]'),
                ...FOLD,
            ],
        },
        {
            title: '선택 · 이동',
            items: [
                s('줄 선택 (누를수록 늘어남)', 'Mod-l'),
                s('다음 같은 단어도 선택', 'Mod-d'),
                s('같은 단어 모두 선택', 'Mod-Shift-l'),
                s('위 · 아래에 커서 추가', 'Mod-Alt-ArrowUp', 'Mod-Alt-ArrowDown'),
                s('커서 추가', 'Alt-클릭'),
                s('세로 선택', 'Shift-Alt-끌기'),
                s('짝 괄호로', 'Mod-Shift-\\'),
                s('줄 번호로 이동', 'Mod-g'),
                s('찾기 · 바꾸기', 'Mod-f', 'Mod-h'),
                s('다음 · 이전 찾기', 'F3', 'Shift-F3'),
            ],
        },
    ],
    intellij: [
        {
            title: '편집',
            items: [
                s('되돌리기 · 다시 실행', 'Mod-z', 'Mod-Shift-z'),
                s('코드 정렬', 'Mod-Alt-l'),
                s('줄 주석', 'Mod-/'),
                s('블록 주석', 'Mod-Shift-/'),
                s('줄 옮기기', 'Shift-Alt-ArrowUp', 'Shift-Alt-ArrowDown'),
                s('줄 복제', 'Mod-d'),
                s('줄 삭제', 'Mod-y'),
                s('아래에 새 줄', 'Shift-Enter'),
                s('자동 들여쓰기', 'Mod-Alt-i'),
                ...FOLD,
            ],
        },
        {
            title: '선택 · 이동',
            items: [
                s('다음 같은 단어도 선택', 'Alt-j'),
                s('같은 단어 모두 선택', 'Mod-Alt-Shift-j'),
                s('커서 추가', 'Shift-Alt-클릭'),
                s('세로 선택', 'Alt-끌기'),
                s('줄 번호로 이동', 'Mod-g'),
                s('찾기 · 바꾸기', 'Mod-f', 'Mod-r'),
            ],
        },
    ],
    visualstudio: [
        {
            title: '편집',
            items: [
                s('되돌리기 · 다시 실행', 'Mod-z', 'Mod-y'),
                s('문서 서식', 'Mod-k Mod-d'),
                s('주석 · 주석 풀기', 'Mod-k Mod-c', 'Mod-k Mod-u'),
                s('줄 옮기기', 'Alt-ArrowUp', 'Alt-ArrowDown'),
                s('줄 복제', 'Mod-d'),
                s('줄 잘라내기', 'Mod-l'),
                s('줄 삭제', 'Mod-Shift-l'),
                ...FOLD,
            ],
        },
        {
            title: '선택 · 이동',
            items: [
                s('다음 같은 단어도 선택', 'Shift-Alt-.'),
                s('같은 단어 모두 선택', 'Shift-Alt-;'),
                s('커서 추가', 'Mod-Alt-클릭'),
                s('세로 선택', 'Alt-끌기'),
                s('짝 괄호로', 'Mod-]'),
                s('줄 번호로 이동', 'Mod-g'),
                s('찾기 · 바꾸기', 'Mod-f', 'Mod-h'),
            ],
        },
    ],
};

const VIM: ShortcutGroup[] = [
    {
        title: 'Vim',
        items: [
            s('예제 실행', ':w'),
            s('입력 모드 · 일반 모드', 'i', 'Escape'),
            s('줄 삭제 · 복사 · 붙여넣기', 'dd', 'yy', 'p'),
            s('되돌리기 · 다시 실행', 'u', 'Ctrl-r'),
            s('찾기 · 다음', '/', 'n'),
            s('바꾸기', ':s/찾을/바꿀/g'),
        ],
    },
];

export const shortcutGroups = (name: KeymapName): ShortcutGroup[] => [
    APP,
    ...(name === 'vim' ? VIM : EDITOR[name]),
];

const KEY_NAMES: Record<string, [win: string, mac: string]> = {
    Mod: ['Ctrl', '⌘'],
    Ctrl: ['Ctrl', '⌃'],
    Alt: ['Alt', '⌥'],
    Shift: ['Shift', '⇧'],
    Enter: ['Enter', '↩'],
    ArrowUp: ['↑', '↑'],
    ArrowDown: ['↓', '↓'],
    Escape: ['Esc', 'Esc'],
    Space: ['Space', 'Space'],
};

/** 'Mod-Shift-k' → 'Ctrl+Shift+K', 'Mod-k Mod-c' → 'Ctrl+K, Ctrl+C' (Vim 명령은 그대로) */
export const keyLabel = (keys: string, mac = false) => {
    if (!/^(Mod|Ctrl|Alt|Shift)-|^(Tab|Enter|Escape|F\d+)$/.test(keys)) return keys;
    return keys
        .split(' ')
        .map((chord) =>
            chord
                // 마지막 '-'는 키 자체일 수 있음 (Mod--는 없지만 Mod-[ 등은 그대로)
                .split(/-(?=.)/)
                .map((part) => {
                    const named = KEY_NAMES[part];
                    if (named) return named[mac ? 1 : 0];
                    return part.length === 1 ? part.toUpperCase() : part;
                })
                .join(mac ? '' : '+')
        )
        .join(', ');
};
