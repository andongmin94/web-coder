// 선택 영역이 배경과 거의 같은 색인 테마(Solarized Light 등)에서 고른 글자가 보이도록,
// 선택 색을 글자 색 쪽으로 조금씩 옮겨 최소 대비를 맞춥니다. 대비가 충분한 테마는 원래 색 그대로입니다.

type Rgb = { r: number; g: number; b: number };

/** #rrggbb 또는 #rrggbbaa (aa는 배경 위에 겹친 색으로 계산) */
const parse = (color: string, under?: Rgb): Rgb | null => {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const rgb = { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
    const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
    if (a === 1 || !under) return rgb;
    return {
        r: rgb.r * a + under.r * (1 - a),
        g: rgb.g * a + under.g * (1 - a),
        b: rgb.b * a + under.b * (1 - a),
    };
};

const luminance = ({ r, g, b }: Rgb) => {
    const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** WCAG 대비 (1 ~ 21) */
export const contrast = (a: Rgb, b: Rgb) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const hex = ({ r, g, b }: Rgb) =>
    `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** 선택 영역과 배경의 최소 대비 (VS Code 기본 밝은·어두운 테마가 약 1.5~2) */
export const MIN_SELECTION_CONTRAST = 1.35;

/** 배경 위에서 선택 색의 대비가 모자라면 글자 색 쪽으로 섞어 맞춘 색. 충분하면 그대로 */
export const visibleSelection = (selection: string, bg: string, fg: string) => {
    const base = parse(bg);
    const sel = base && parse(selection, base);
    const text = parse(fg);
    if (!base || !sel || !text || contrast(sel, base) >= MIN_SELECTION_CONTRAST) return selection;
    for (let t = 0.05; t <= 0.6; t += 0.05) {
        const mixed = {
            r: sel.r + (text.r - sel.r) * t,
            g: sel.g + (text.g - sel.g) * t,
            b: sel.b + (text.b - sel.b) * t,
        };
        if (contrast(mixed, base) >= MIN_SELECTION_CONTRAST) return hex(mixed);
    }
    return selection;
};
