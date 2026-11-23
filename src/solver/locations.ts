// 컴파일 에러·표준 에러에서 소스 위치(줄, 열)를 찾아 누르면 에디터의 그 줄로 가게 합니다.

export type SourceLocation = {
    /** 텍스트 안에서 위치 표시가 차지하는 범위 [start, end) */
    start: number;
    end: number;
    /** 1부터 */
    line: number;
    /** 1부터, 모르면 null */
    column: number | null;
};

/**
 * 언어별 위치 표시:
 *   C++  main.cpp:12:5      Java  Main.java:12 (javac, 스택 트레이스)
 *   node main.js:12:5       Python File "/main.py", line 12
 */
const PATTERNS = [
    /\b(?:main\.cpp|Main\.java|main\.js):(\d+)(?::(\d+))?/g,
    /File "\/?main\.py", line (\d+)/g,
];

export const findLocations = (text: string): SourceLocation[] => {
    const found: SourceLocation[] = [];
    for (const pattern of PATTERNS) {
        for (const match of text.matchAll(pattern)) {
            found.push({
                start: match.index,
                end: match.index + match[0].length,
                line: Number(match[1]),
                column: match[2] ? Number(match[2]) : null,
            });
        }
    }
    return found
        .filter((loc) => loc.line > 0)
        .sort((a, b) => a.start - b.start)
        .filter((loc, i, all) => i === 0 || loc.start >= all[i - 1].end);
};

/** 텍스트를 글자 노드와 위치 버튼으로 나눕니다. (pre 안에 넣을 내용) */
export const linkifyLocations = (
    text: string,
    onJump: (line: number, column: number | null) => void
): (Node | string)[] => {
    const parts: (Node | string)[] = [];
    let last = 0;
    for (const loc of findLocations(text)) {
        if (loc.start > last) parts.push(text.slice(last, loc.start));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'source-link';
        button.title = `에디터에서 ${loc.line}번째 줄로 이동`;
        button.textContent = text.slice(loc.start, loc.end);
        button.addEventListener('click', () => onJump(loc.line, loc.column));
        parts.push(button);
        last = loc.end;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
};
