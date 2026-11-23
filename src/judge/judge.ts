// 출력 비교. BOJ와 같이 줄 끝 공백과 마지막 빈 줄은 무시합니다.

export const normalizeOutput = (text: string): string => {
    const lines = text
        // CRLF만 줄바꿈으로 봅니다. 줄 중간의 단독 \r은 BOJ처럼 다른 글자로 칩니다. (줄 끝이면 trimEnd가 지움)
        .replace(/\r\n/g, '\n')
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

const isNumberToken = (token: string) => /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(token);

/** 문제가 허용하는 오차의 종류. 둘 다 말하거나 그냥 "오차"라고만 하면 either */
export type ToleranceMode = 'absolute' | 'relative' | 'either';

/**
 * 실수 오차를 허용하는 비교 (스페셜 저지 문제용). 토큰 수가 같고, 숫자 토큰은
 * 오차(mode에 따라 절대, 상대, 둘 중 하나)가 tolerance 이하이며, 나머지 토큰은 글자가 같아야 합니다.
 */
export const isSameWithTolerance = (
    actual: string,
    expected: string,
    tolerance: number,
    mode: ToleranceMode = 'either'
): boolean => {
    const a = actual.trim().split(/\s+/).filter(Boolean);
    const e = expected.trim().split(/\s+/).filter(Boolean);
    if (a.length !== e.length) return false;
    // 부동소수점 반올림 여유
    const limit = tolerance * (1 + 1e-6);
    return a.every((token, i) => {
        if (token === e[i]) return true;
        if (!isNumberToken(token) || !isNumberToken(e[i])) return false;
        const diff = Math.abs(Number(token) - Number(e[i]));
        const absolute = diff <= limit;
        const relative = diff <= limit * Math.abs(Number(e[i]));
        return mode === 'absolute'
            ? absolute
            : mode === 'relative'
              ? relative
              : absolute || relative;
    });
};

/** 기대 출력에 실수가 들어 있는지 (오차 비교를 쓸 만한지) */
export const hasDecimalNumber = (text: string) =>
    text
        .trim()
        .split(/\s+/)
        .some((token) => isNumberToken(token) && /[.e]/i.test(token));

/**
 * 문제 본문에서 허용 오차를 찾습니다. "오차"가 들어간 문장에서
 * 10^{-9}, 10^(-9), 10-9(위첨자가 글자로 풀린 것), 2×10^{-3}, 1.0 × 10^{-6}, 1e-9 꼴.
 * 찾지 못하면 null.
 */
export const findTolerance = (text: string): number | null =>
    findToleranceInfo(text)?.value ?? null;

/** 허용 오차와 그 종류. 그 문장이 "절대 오차"만 말하면 absolute, "상대 오차"만 말하면 relative */
export const findToleranceInfo = (text: string): { value: number; mode: ToleranceMode } | null => {
    const DASH = '[-−–]';
    const POWER = `10\\s*(?:\\^\\s*)?[{(]?\\s*${DASH}\\s*(\\d{1,2})(?!\\d)\\s*[})]?`;
    // 앞에 붙은 계수 (2×10^{-3}, 1.0 x 10^{-6})
    const withMantissa = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:×|\\\\times|\\*|x)\\s*${POWER}`, 'i');
    // 숫자나 '-' 바로 뒤의 10은 날짜·범위의 일부라서 제외 (2020-10-12)
    const bare = new RegExp(`(?<![\\d.\\-−–])${POWER}`);
    const exponent = /(?<![\d.])(\d+(?:\.\d+)?)e-(\d{1,2})\b/i;
    // 소수점(1.0)은 문장을 끊지 않도록, 숫자 사이가 아닌 마침표와 줄바꿈에서만 나눕니다.
    for (const sentence of text.split(/(?<!\d)\.|\.(?!\d)|[。\n]/)) {
        if (!/오차|error/i.test(sentence)) continue;
        const value = valueIn(sentence);
        if (value === null) continue;
        const absolute = /절대|absolute/i.test(sentence);
        const relative = /상대|relative/i.test(sentence);
        const mode: ToleranceMode =
            absolute && !relative ? 'absolute' : relative && !absolute ? 'relative' : 'either';
        return { value, mode };
    }
    return null;

    function valueIn(sentence: string): number | null {
        let match = withMantissa.exec(sentence);
        if (match) return Number(match[1]) * 10 ** -Number(match[2]);
        match = bare.exec(sentence);
        if (match) return 10 ** -Number(match[1]);
        match = exponent.exec(sentence);
        if (match) return Number(match[1]) * 10 ** -Number(match[2]);
        return null;
    }
};

/**
 * 한 줄 안에서 서로 다른 구간. 앞뒤로 같은 부분을 빼고 남은 [start, endA) / [start, endB)입니다.
 * (예: "1 2 3"과 "1 5 3" → start 2, endA 3, endB 3)
 */
export const differingRange = (a: string, b: string) => {
    let start = 0;
    const max = Math.min(a.length, b.length);
    while (start < max && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
    }
    return { start, endA, endB };
};
