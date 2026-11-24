// 에디터 글꼴: 이 PC에 설치된 코딩 글꼴을 찾아 고를 수 있게 합니다.
// 글꼴 파일을 받지 않고, CSS font-family로 설치된(로컬) 글꼴을 그대로 씁니다.

/**
 * 에디터 기본 글꼴 목록. 고른 글꼴이 없을 때 이 순서로 씁니다. (Consolas가 기본)
 * Consolas에는 한글이 없어서, 한글은 다음 글꼴(D2Coding 등)이나 시스템 글꼴로 나옵니다.
 */
const DEFAULT_MONO =
    "Consolas, 'D2Coding', 'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace";

/** 많이 쓰는 코딩 글꼴. 설치된 것만 목록에 보여 줍니다. */
const CODING_FONTS = [
    'D2Coding',
    'D2Coding ligature',
    'JetBrains Mono',
    'Fira Code',
    'Cascadia Code',
    'Cascadia Mono',
    'Consolas',
    'Source Code Pro',
    'Hack',
    'Iosevka',
    'Sarasa Mono K',
    'NanumGothicCoding',
    'Noto Sans Mono',
    'Roboto Mono',
    'IBM Plex Mono',
    'Inconsolata',
    'Ubuntu Mono',
    'DejaVu Sans Mono',
    'SF Mono',
    'Menlo',
    'Monaco',
    'Courier New',
];

const SAMPLE = 'mmmmmmmmmmlli1WW0Oo가나다{}[]';

let canvas: CanvasRenderingContext2D | null = null;
const widthOf = (fontFamily: string) => {
    canvas ??= document.createElement('canvas').getContext('2d');
    if (!canvas) return 0;
    canvas.font = `72px ${fontFamily}`;
    return canvas.measureText(SAMPLE).width;
};

/** CSS font-family 값에 넣을 수 있게 이름을 따옴표로 감쌉니다. */
const quoteFamily = (name: string) => `"${name.replace(/["\\]/g, '')}"`;

/**
 * 글꼴이 설치되어 있는지. 대체 글꼴(monospace, serif)로 그렸을 때와 폭이 다르면 있는 것으로 봅니다.
 * (document.fonts.check는 설치되지 않은 로컬 글꼴에도 true를 돌려줘서 쓸 수 없음)
 */
export const isFontInstalled = (name: string) =>
    ['monospace', 'serif'].some(
        (fallback) => widthOf(`${quoteFamily(name)}, ${fallback}`) !== widthOf(fallback)
    );

let installed: string[] | null = null;
/** 이 PC에 설치된 코딩 글꼴 (한 번만 확인) */
export const installedCodingFonts = () => (installed ??= CODING_FONTS.filter(isFontInstalled));

/** 기본 목록에서 이 PC에 있어 실제로 쓰이는 글꼴 이름 (없으면 null = 브라우저 기본 고정폭) */
export const defaultFontInUse = () =>
    ['Consolas', 'D2Coding', 'JetBrains Mono', 'Cascadia Code'].find(isFontInstalled) ?? null;

type LocalFontData = { family: string };
type QueryLocalFonts = () => Promise<LocalFontData[]>;

/** Local Font Access API로 PC의 모든 글꼴 이름을 읽을 수 있는지 (Chrome 103+) */
export const canQueryLocalFonts = () =>
    typeof (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === 'function';

/**
 * PC에 설치된 모든 글꼴 이름. 브라우저가 권한을 물어보며, 사용자의 클릭 직후에만 부를 수 있습니다.
 * 거절하거나 지원하지 않으면 null.
 */
export const queryAllFontFamilies = async (): Promise<string[] | null> => {
    const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
    if (!query) return null;
    try {
        const fonts = await query.call(window);
        return [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b));
    } catch {
        return null;
    }
};

/** 에디터에 쓸 font-family 값. 고른 글꼴이 없으면(빈 문자열) 기본 목록 */
export const editorFontFamily = (name: string) =>
    name.trim() ? `${quoteFamily(name.trim())}, ${DEFAULT_MONO}` : DEFAULT_MONO;
