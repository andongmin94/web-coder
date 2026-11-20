// 출력 비교. BOJ와 같이 줄 끝 공백과 마지막 빈 줄은 무시합니다.

export const normalizeOutput = (text: string): string => {
    const lines = text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd());
    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines.join('\n');
};

export const isSameOutput = (actual: string, expected: string): boolean =>
    normalizeOutput(actual) === normalizeOutput(expected);

/** 처음으로 달라지는 줄 번호(1부터). 같으면 null. */
export const firstDiffLine = (actual: string, expected: string): number | null => {
    const a = normalizeOutput(actual).split('\n');
    const e = normalizeOutput(expected).split('\n');
    const max = Math.max(a.length, e.length);
    for (let i = 0; i < max; i++) {
        if (a[i] !== e[i]) return i + 1;
    }
    return null;
};
