// 에디터 테마의 모양 (themes.ts, 자동으로 만든 theme-data.ts가 같이 씀)

export type Palette = {
    bg: string;
    fg: string;
    /** 줄 번호 */
    gutter: string;
    /** 줄 번호 영역 배경 (없으면 bg) */
    gutterBg?: string;
    activeLine: string;
    selection: string;
    cursor: string;
    keyword: string;
    /** if, for, return 등 흐름 제어 (없으면 keyword) */
    control?: string;
    string: string;
    number: string;
    comment: string;
    function: string;
    type: string;
    variable: string;
    constant: string;
    /** 전처리기, 어노테이션 */
    meta: string;
};

export type EditorTheme = {
    id: string;
    name: string;
    /** 선택 목록에서 묶어 보여 줄 이름 (출처) */
    group: string;
    dark: boolean;
};

export type ThemeDefinition = EditorTheme & { palette: Palette };
