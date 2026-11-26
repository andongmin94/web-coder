// 이 PC에 설치된 편집기의 테마 파일에서 색을 뽑아 src/solver/theme-data.ts를 만듭니다.
//
//   node tools/themes/extract.mjs [--vscode <폴더>] [--idea <폴더>] [--rider <폴더>]
//
// 읽는 곳 (기본값은 %LOCALAPPDATA%\Programs 아래의 설치 폴더)
// - VS Code: resources/app/extensions/theme-*/ 의 내장 테마 (JSON)
// - IntelliJ IDEA: lib/intellij.platform.resources.jar 의 색 구성 (XML)
// - Rider: plugins/rider-theme-pack 의 색 구성 (XML). Rider, ReSharper, Visual Assist,
//   그리고 JetBrains가 Visual Studio의 색을 옮겨 둔 "Visual Studio Dark/Light"가 들어 있습니다.
//
// 테마 파일 자체는 저장소에 넣지 않고, 에디터에 필요한 색 십여 개만 뽑아 씁니다.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROGRAMS = join(process.env.LOCALAPPDATA ?? '', 'Programs');

const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
};

// ── 공통 ─────────────────────────────────────────────────────────

/** "80", "1e1e1e", "#FFF", "#878b9180" → "#rrggbb" 또는 "#rrggbbaa" */
const hex = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    let v = String(value).replace(/^#/, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(v)) return undefined;
    if (v.length === 3) v = [...v].map((c) => c + c).join('');
    if (v.length < 6) v = v.padStart(6, '0');
    return `#${v}`;
};

const rgb = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
/** a에 b를 ratio만큼 섞습니다. (테마가 값을 주지 않은 강조색을 만들 때) */
const mix = (a, b, ratio) => {
    const [x, y] = [rgb(a), rgb(b)];
    return `#${x
        .map((v, i) =>
            Math.round(v + (y[i] - v) * ratio)
                .toString(16)
                .padStart(2, '0')
        )
        .join('')}`;
};
/**
 * 선택 영역 색이 배경과 너무 다르면 누그러뜨립니다. 원래 편집기는 선택한 글자의 색도 같이 바꾸지만
 * (예: 진한 파랑 배경에 흰 글자) 여기서는 글자색이 그대로라서 읽을 수 없게 되기 때문입니다.
 */
const readableSelection = (bg, selection) => {
    if (selection.length !== 7 || isDark(bg) === isDark(selection)) return selection;
    return mix(bg, selection, 0.4);
};
const isDark = (color) => {
    const [r, g, b] = rgb(color);
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
};

/** jar(zip)에서 파일 하나를 읽습니다. */
const readZipEntry = (zipPath, entryName) => {
    const data = readFileSync(zipPath);
    let end = data.length - 22;
    while (end >= 0 && data.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0) throw new Error(`zip이 아닙니다: ${zipPath}`);
    let pos = data.readUInt32LE(end + 16);
    for (let n = data.readUInt16LE(end + 10); n > 0; n--) {
        const method = data.readUInt16LE(pos + 10);
        const size = data.readUInt32LE(pos + 20);
        const nameLength = data.readUInt16LE(pos + 28);
        const skip = data.readUInt16LE(pos + 30) + data.readUInt16LE(pos + 32);
        const local = data.readUInt32LE(pos + 42);
        const name = data.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
        if (name === entryName) {
            const start =
                local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
            const raw = data.subarray(start, start + size);
            return (method === 0 ? raw : inflateRawSync(raw)).toString('utf8');
        }
        pos += 46 + nameLength + skip;
    }
    throw new Error(`${zipPath}에 ${entryName}이 없습니다.`);
};

// ── JetBrains 색 구성 (XML) ──────────────────────────────────────

const parseScheme = (xml) => {
    const head = /<scheme\s+([^>]*)>/.exec(xml)?.[1] ?? '';
    const colors = {};
    const colorsBlock = /<colors>([\s\S]*?)<\/colors>/.exec(xml)?.[1] ?? '';
    for (const m of colorsBlock.matchAll(/<option name="([^"]+)" value="([^"]*)"\s*\/>/g))
        colors[m[1]] = m[2];

    const attributes = {};
    const attributesBlock = /<attributes>([\s\S]*?)<\/attributes>/.exec(xml)?.[1] ?? '';
    const option =
        /<option name="([^"]+)"(?:\s+baseAttributes="([^"]*)")?\s*(?:\/>|>\s*(?:<value\s*\/>|<value>([\s\S]*?)<\/value>)\s*<\/option>)/g;
    for (const m of attributesBlock.matchAll(option)) {
        const body = m[3] ?? '';
        attributes[m[1]] = {
            base: m[2],
            foreground: /name="FOREGROUND" value="([^"]*)"/.exec(body)?.[1],
            background: /name="BACKGROUND" value="([^"]*)"/.exec(body)?.[1],
        };
    }
    return {
        name: /name="([^"]+)"/.exec(head)?.[1] ?? '?',
        parent: /parent_scheme="([^"]+)"/.exec(head)?.[1],
        colors,
        attributes,
    };
};

/** 색을 주지 않은 항목이 물려받는 순서 (IntelliJ의 DefaultLanguageHighlighterColors와 같음) */
const FALLBACK = {
    'ReSharper.CONTROL_FLOW_KEYWORD': 'DEFAULT_KEYWORD',
    DEFAULT_FUNCTION_DECLARATION: 'DEFAULT_IDENTIFIER',
    DEFAULT_CLASS_NAME: 'DEFAULT_IDENTIFIER',
    DEFAULT_LOCAL_VARIABLE: 'DEFAULT_IDENTIFIER',
    DEFAULT_CONSTANT: 'DEFAULT_IDENTIFIER',
    DEFAULT_METADATA: 'DEFAULT_IDENTIFIER',
    DEFAULT_IDENTIFIER: 'TEXT',
};

const jetbrainsPalette = (scheme, bases) => {
    const chain = [scheme];
    for (let parent = scheme.parent; parent && bases[parent]; parent = bases[parent].parent)
        chain.push(bases[parent]);

    const foreground = (key, depth = 0) => {
        if (depth > 8) return undefined;
        for (const s of chain) {
            const attr = s.attributes[key];
            if (!attr) continue;
            if (attr.foreground) return hex(attr.foreground);
            if (attr.base) return foreground(attr.base, depth + 1);
            break; // 색 없이 선언됨: 부모 구성이 아니라 기본 순서를 따릅니다.
        }
        return FALLBACK[key] ? foreground(FALLBACK[key], depth + 1) : undefined;
    };
    /** 기본 순서로 물려받은 색 말고, 구성이 직접 정한 색만 */
    const explicit = (...keys) => {
        for (const key of keys) {
            for (const s of chain) {
                const attr = s.attributes[key];
                if (!attr) continue;
                if (attr.foreground) return hex(attr.foreground);
                break;
            }
        }
        return undefined;
    };
    const color = (key) => {
        for (const s of chain) if (s.colors[key]) return hex(s.colors[key]);
        return undefined;
    };
    const background = chain.map((s) => s.attributes.TEXT?.background).find(Boolean);

    const bg = hex(background) ?? '#ffffff';
    const fg = foreground('TEXT') ?? (isDark(bg) ? '#bbbbbb' : '#000000');
    const keyword = foreground('DEFAULT_KEYWORD') ?? fg;
    const control = scheme.attributes['ReSharper.CONTROL_FLOW_KEYWORD']
        ? foreground('ReSharper.CONTROL_FLOW_KEYWORD')
        : undefined;
    const gutterBg = color('GUTTER_BACKGROUND');
    return {
        bg,
        fg,
        gutter: color('LINE_NUMBERS_COLOR') ?? mix(bg, fg, 0.45),
        ...(gutterBg && gutterBg !== bg ? { gutterBg } : {}),
        activeLine: color('CARET_ROW_COLOR') ?? mix(bg, fg, 0.06),
        selection: readableSelection(bg, color('SELECTION_BACKGROUND') ?? mix(bg, fg, 0.25)),
        cursor: color('CARET_COLOR') ?? fg,
        keyword,
        ...(control && control !== keyword ? { control } : {}),
        string: foreground('DEFAULT_STRING') ?? fg,
        number: foreground('DEFAULT_NUMBER') ?? fg,
        comment: foreground('DEFAULT_LINE_COMMENT') ?? mix(bg, fg, 0.5),
        // 함수 선언에 색이 없는 구성(Visual Studio 등)은 메서드 색을 씁니다.
        function:
            explicit(
                'DEFAULT_FUNCTION_DECLARATION',
                'DEFAULT_INSTANCE_METHOD',
                'DEFAULT_STATIC_METHOD',
                'DEFAULT_FUNCTION_CALL'
            ) ?? fg,
        type: foreground('DEFAULT_CLASS_NAME') ?? fg,
        variable: foreground('DEFAULT_LOCAL_VARIABLE') ?? fg,
        constant: foreground('DEFAULT_CONSTANT') ?? fg,
        meta: foreground('DEFAULT_METADATA') ?? keyword,
    };
};

// ── VS Code 테마 (JSON) ──────────────────────────────────────────

/** 주석과 끝 쉼표가 있는 JSON. (문자열 안의 // 는 건드리지 않습니다) */
const parseJsonc = (text) => {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            out += c;
            if (c === '\\') out += text[++i];
            else if (c === '"') inString = false;
        } else if (c === '"') {
            inString = true;
            out += c;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
        } else if (c === '/' && text[i + 1] === '*') {
            i = text.indexOf('*/', i + 2) + 1;
        } else {
            out += c;
        }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
};

/** include로 이어진 테마를 합칩니다. (뒤에 오는 정의가 우선) */
const loadVscodeTheme = (file) => {
    const json = parseJsonc(readFileSync(file, 'utf8'));
    const base = json.include
        ? loadVscodeTheme(join(dirname(file), json.include))
        : { colors: {}, tokenColors: [] };
    return {
        colors: { ...base.colors, ...json.colors },
        tokenColors: [
            ...base.tokenColors,
            ...(Array.isArray(json.tokenColors) ? json.tokenColors : []),
        ],
    };
};

const SCOPES = {
    keyword: ['keyword', 'storage.type', 'storage'],
    control: ['keyword.control'],
    string: ['string'],
    number: ['constant.numeric'],
    comment: ['comment'],
    function: ['entity.name.function', 'support.function'],
    type: ['entity.name.type', 'support.type', 'support.class', 'entity.name.class'],
    variable: ['variable', 'variable.other.readwrite'],
    constant: ['variable.other.constant', 'constant.language', 'constant.other', 'constant'],
    meta: ['meta.preprocessor', 'entity.name.function.preprocessor', 'keyword.control.directive'],
};

const vscodePalette = (theme, uiDark) => {
    const scopes = new Map();
    let defaultForeground;
    for (const token of theme.tokenColors) {
        const foreground = hex(token.settings?.foreground);
        if (!foreground) continue;
        if (!token.scope) {
            defaultForeground = foreground;
            continue;
        }
        const list = Array.isArray(token.scope) ? token.scope : String(token.scope).split(',');
        for (const scope of list) scopes.set(scope.trim(), foreground);
    }
    const pick = (key) => SCOPES[key].map((scope) => scopes.get(scope)).find(Boolean);
    const color = (key) => hex(theme.colors[key]);

    const bg = color('editor.background') ?? (uiDark ? '#1e1e1e' : '#ffffff');
    const fg = color('editor.foreground') ?? defaultForeground ?? (uiDark ? '#d4d4d4' : '#000000');
    const keyword = pick('keyword') ?? fg;
    const control = pick('control');
    const gutterBg = color('editorGutter.background');
    return {
        bg,
        fg,
        // 테마가 정하지 않은 값은 VS Code의 기본값입니다.
        gutter: color('editorLineNumber.foreground') ?? (uiDark ? '#858585' : '#237893'),
        ...(gutterBg && gutterBg !== bg ? { gutterBg } : {}),
        activeLine: color('editor.lineHighlightBackground') ?? mix(bg, fg, 0.06),
        selection: readableSelection(
            bg,
            color('editor.selectionBackground') ?? (uiDark ? '#264f78' : '#add6ff')
        ),
        cursor: color('editorCursor.foreground') ?? (uiDark ? '#aeafad' : '#000000'),
        keyword,
        ...(control && control !== keyword ? { control } : {}),
        string: pick('string') ?? fg,
        number: pick('number') ?? fg,
        comment: pick('comment') ?? mix(bg, fg, 0.5),
        function: pick('function') ?? fg,
        type: pick('type') ?? fg,
        variable: pick('variable') ?? fg,
        constant: pick('constant') ?? pick('number') ?? fg,
        meta: pick('meta') ?? control ?? keyword,
    };
};

// ── 수집 ─────────────────────────────────────────────────────────

/** 이미 저장된 설정이 깨지지 않게, 처음에 손으로 넣었던 테마는 id를 그대로 둡니다. */
const FIXED_IDS = {
    'VS Code/Dark+': 'vscode-dark',
    'VS Code/Light+': 'vscode-light',
    'VS Code/Monokai': 'monokai',
    'VS Code/Solarized Dark': 'solarized-dark',
    'VS Code/Solarized Light': 'solarized-light',
    'JetBrains/Darcula': 'darcula',
    'JetBrains/IntelliJ Light': 'intellij-light',
    'JetBrains/Dark': 'jetbrains-dark',
};
const slug = (text) =>
    text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

const themes = [];
const add = (group, name, palette) => {
    const id = FIXED_IDS[`${group}/${name}`] ?? `${slug(group)}-${slug(name)}`;
    themes.push({ id, name, group, dark: isDark(palette.bg), palette });
};

const findVscodeExtensions = () => {
    const given = arg('vscode');
    const root = given ?? join(PROGRAMS, 'Microsoft VS Code');
    const candidates = [join(root, 'resources/app/extensions')];
    if (existsSync(root))
        for (const entry of readdirSync(root))
            candidates.push(join(root, entry, 'resources/app/extensions'));
    return candidates.find((dir) => existsSync(join(dir, 'theme-defaults')));
};

const collectVscode = (extensions) => {
    for (const extension of readdirSync(extensions)
        .filter((name) => name.startsWith('theme-'))
        .sort()) {
        const dir = join(extensions, extension);
        if (!existsSync(join(dir, 'package.json'))) continue;
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        const nls = existsSync(join(dir, 'package.nls.json'))
            ? JSON.parse(readFileSync(join(dir, 'package.nls.json'), 'utf8'))
            : {};
        for (const entry of manifest.contributes?.themes ?? []) {
            const label = String(entry.label).replace(/^%(.+)%$/, (_m, key) => nls[key] ?? key);
            // "Dark+ (default dark)" 같은 꼬리말은 뺍니다.
            const name = label
                .replace(/\s*\((default|기본)[^)]*\)\s*$/i, '')
                .replace(/^Default\s+/, '');
            const theme = loadVscodeTheme(join(dir, entry.path));
            add('VS Code', name, vscodePalette(theme, /dark|black/.test(entry.uiTheme)));
        }
    }
};

const collectJetbrains = (idea, rider) => {
    const resources = join(idea, 'lib/intellij.platform.resources.jar');
    const bases = {};
    const defaults = readZipEntry(resources, 'DefaultColorSchemesManager.xml');
    for (const m of defaults.matchAll(/<scheme name="[^"]+"[\s\S]*?<\/scheme>/g)) {
        const scheme = parseScheme(m[0]);
        bases[scheme.name] = scheme;
    }
    add('JetBrains', 'Classic Light', jetbrainsPalette(bases.Default, bases));
    add('JetBrains', 'Darcula', jetbrainsPalette(bases.Darcula, bases));
    for (const entry of [
        'themes/Light.xml',
        'themes/expUI/expUI_lightScheme.xml',
        'themes/expUI/expUI_darkScheme.xml',
        'themes/expUI/expUI_darculaContrastScheme.xml',
        'themes/islands/IslandSchemeDark.xml',
        'themes/highContrastScheme.xml',
    ]) {
        const scheme = parseScheme(readZipEntry(resources, entry));
        add('JetBrains', scheme.name, jetbrainsPalette(scheme, bases));
    }

    const pack = join(rider, 'plugins/rider-theme-pack/lib/rider-theme-pack.jar');
    for (const file of [
        'RiderLight',
        'RiderDark',
        'RiderIslandsDark',
        'RiderMelonLight',
        'RiderMelonDark',
        'ReSharperLight',
        'ReSharperDark',
        'VisualAssistLight',
        'VisualAssistDark',
        'VisualStudioLight',
        'VisualStudioDark',
    ]) {
        const scheme = parseScheme(readZipEntry(pack, `colorSchemes/${file}.xml`));
        const group = scheme.name.startsWith('Visual Studio')
            ? 'Visual Studio'
            : 'Rider · ReSharper';
        add(group, scheme.name.replace(/^Visual Studio\s+/, ''), jetbrainsPalette(scheme, bases));
    }
};

const vscode = findVscodeExtensions();
const idea = arg('idea') ?? join(PROGRAMS, 'IntelliJ IDEA Ultimate');
const rider = arg('rider') ?? join(PROGRAMS, 'Rider');
const missing = [
    !vscode && 'VS Code (--vscode)',
    !existsSync(join(idea, 'lib/intellij.platform.resources.jar')) && 'IntelliJ IDEA (--idea)',
    !existsSync(join(rider, 'plugins/rider-theme-pack/lib/rider-theme-pack.jar')) &&
        'Rider (--rider)',
].filter(Boolean);
if (missing.length) {
    console.error(`테마를 읽을 설치 폴더를 찾지 못했습니다: ${missing.join(', ')}`);
    process.exit(1);
}

collectVscode(vscode);
collectJetbrains(idea, rider);

const ids = new Set();
for (const theme of themes) {
    if (ids.has(theme.id)) throw new Error(`id가 겹칩니다: ${theme.id}`);
    ids.add(theme.id);
}

const body = themes
    .map(
        (theme) =>
            `    {\n        id: '${theme.id}',\n        name: '${theme.name}',\n` +
            `        group: '${theme.group}',\n        dark: ${theme.dark},\n` +
            `        palette: {\n${Object.entries(theme.palette)
                .map(([key, value]) => `            ${key}: '${value}',`)
                .join('\n')}\n        },\n    },`
    )
    .join('\n');

writeFileSync(
    join(ROOT, 'src/solver/theme-data.ts'),
    `// tools/themes/extract.mjs가 만든 파일입니다. 직접 고치지 마세요.
// 설치된 VS Code, IntelliJ IDEA, Rider의 테마 파일에서 뽑은 색입니다.
import type { ThemeDefinition } from './theme-types.ts';

export const EXTRACTED_THEMES: ThemeDefinition[] = [
${body}
];
`
);
console.log(`${themes.length}개 테마 → src/solver/theme-data.ts`);
for (const group of new Set(themes.map((t) => t.group)))
    console.log(
        `  ${group}: ${themes
            .filter((t) => t.group === group)
            .map((t) => t.name)
            .join(', ')}`
    );
