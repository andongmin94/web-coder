// BOJ의 Java 8/11/15는 javac -release N으로 컴파일해서, 그 뒤에 나온 문법을 쓰면 컴파일 에러입니다.
// 웹 코더의 javac(teavm-javac)는 최신 문법 수준이 고정이라 같은 에러를 내지 못하므로,
// 소스를 토큰으로 나눠 버전보다 새로운 문법을 찾아 javac와 같은 문구로 알려 줍니다.
// (표준 API는 버전별로 거른 SDK로 javac가 직접 잡습니다: tools/java/release-sdk.mjs)

export type JavaSyntaxIssue = {
    /** 소스 안의 문자 위치 */
    start: number;
    end: number;
    /** javac 형식의 메시지 (둘째 줄은 안내) */
    message: string;
};

type Token = {
    text: string;
    start: number;
    end: number;
    kind: 'ident' | 'op' | 'literal' | 'textblock';
};

const KEYWORDS = new Set(
    (
        'abstract assert boolean break byte case catch char class const continue default do double else enum extends final ' +
        'finally float for goto if implements import instanceof int interface long native new package private protected public ' +
        'return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'
    ).split(' ')
);
const MODIFIERS = new Set([
    'public',
    'private',
    'protected',
    'static',
    'final',
    'abstract',
    'strictfp',
]);

export const tokenizeJava = (source: string): Token[] => {
    const tokens: Token[] = [];
    let i = 0;
    const n = source.length;
    while (i < n) {
        const c = source[i];
        if (/\s/.test(c)) {
            i++;
        } else if (source.startsWith('//', i)) {
            const end = source.indexOf('\n', i);
            i = end < 0 ? n : end;
        } else if (source.startsWith('/*', i)) {
            const end = source.indexOf('*/', i + 2);
            i = end < 0 ? n : end + 2;
        } else if (source.startsWith('"""', i)) {
            let j = i + 3;
            while (j < n && !source.startsWith('"""', j)) j += source[j] === '\\' ? 2 : 1;
            const end = Math.min(n, j + 3);
            tokens.push({ text: source.slice(i, end), start: i, end, kind: 'textblock' });
            i = end;
        } else if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
            const end = Math.min(n, j + 1);
            tokens.push({ text: source.slice(i, end), start: i, end, kind: 'literal' });
            i = end;
        } else if (/[\p{L}_$]/u.test(c)) {
            let j = i + 1;
            while (j < n && /[\p{L}\p{N}_$]/u.test(source[j])) j++;
            tokens.push({ text: source.slice(i, j), start: i, end: j, kind: 'ident' });
            i = j;
        } else if (/\d/.test(c) || (c === '.' && /\d/.test(source[i + 1] ?? ''))) {
            let j = i + 1;
            while (j < n && /[\w.]/.test(source[j])) j++;
            tokens.push({ text: source.slice(i, j), start: i, end: j, kind: 'literal' });
            i = j;
        } else {
            const op = ['->', '::', '...'].find((o) => source.startsWith(o, i)) ?? c;
            tokens.push({ text: op, start: i, end: i + op.length, kind: 'op' });
            i += op.length;
        }
    }
    return tokens;
};

type Feature = { since: number; plural: string; singular?: boolean };
const FEATURES = {
    textBlocks: { since: 15, plural: 'text blocks' },
    records: { since: 16, plural: 'records' },
    switchRules: { since: 14, plural: 'switch rules' },
    switchExpressions: { since: 14, plural: 'switch expressions' },
    multipleCaseLabels: { since: 14, plural: 'multiple case labels' },
    instanceofPatterns: { since: 16, plural: 'pattern matching in instanceof', singular: true },
    sealed: { since: 17, plural: 'sealed classes' },
    switchPatterns: { since: 21, plural: 'patterns in switch statements' },
    recordPatterns: { since: 21, plural: 'record patterns' },
    tryResourceVariables: { since: 9, plural: 'variables in try-with-resources' },
} satisfies Record<string, Feature>;

const message = (f: Feature, release: number) =>
    `${f.plural} ${f.singular ? 'is' : 'are'} not supported in -source ${release}\n` +
    `  (use -source ${f.since} or higher to enable ${f.plural})`;

/** 타입 이름(점, 제네릭, 배열 포함)을 건너뛴 토큰 위치. 타입이 아니면 -1 */
const skipType = (tokens: Token[], i: number) => {
    if (tokens[i]?.kind !== 'ident' || KEYWORDS.has(tokens[i].text)) {
        // 기본형 배열(int[] 등)
        if (!/^(int|long|short|byte|char|boolean|float|double)$/.test(tokens[i]?.text ?? ''))
            return -1;
    }
    i++;
    while (tokens[i]?.text === '.' && tokens[i + 1]?.kind === 'ident') i += 2;
    if (tokens[i]?.text === '<') {
        let depth = 0;
        for (; i < tokens.length; i++) {
            if (tokens[i].text === '<') depth++;
            else if (tokens[i].text === '>') depth--;
            else if (!/^(\w+|\.|,|\?|\[|\]|&|[\p{L}_$][\p{L}\p{N}_$]*)$/u.test(tokens[i].text))
                return -1;
            if (depth === 0) break;
        }
        i++;
    }
    while (tokens[i]?.text === '[' && tokens[i + 1]?.text === ']') i += 2;
    return i;
};

/** release(8, 11, 15)보다 새로운 문법을 찾습니다. 기능마다 처음 나온 곳 하나씩, 위치 순서로. */
export const findNewerSyntax = (source: string, release: number): JavaSyntaxIssue[] => {
    const tokens = tokenizeJava(source);
    const found = new Map<Feature, Token>();
    const mark = (feature: Feature, token: Token) => {
        if (feature.since > release && !found.has(feature)) found.set(feature, token);
    };
    const isName = (t: Token | undefined) => t?.kind === 'ident' && !KEYWORDS.has(t.text);
    const varTokens: Token[] = [];

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const prev = tokens[i - 1];
        const next = tokens[i + 1];
        if (t.kind === 'textblock') mark(FEATURES.textBlocks, t);
        if (t.kind !== 'ident') continue;

        // record Name( / record Name< : 선언 자리(문장·멤버 시작)에서만
        if (
            t.text === 'record' &&
            isName(next) &&
            (tokens[i + 2]?.text === '(' || tokens[i + 2]?.text === '<') &&
            (!prev ||
                ['{', '}', ';'].includes(prev.text) ||
                MODIFIERS.has(prev.text) ||
                prev.text === ')')
        ) {
            mark(FEATURES.records, t);
        }

        // sealed / non-sealed / permits
        if (
            t.text === 'sealed' &&
            (MODIFIERS.has(next?.text ?? '') ||
                next?.text === 'class' ||
                next?.text === 'interface')
        ) {
            mark(FEATURES.sealed, t);
        }
        if (t.text === 'permits' && isName(next) && isName(prev)) mark(FEATURES.sealed, t);

        // case 라벨: ':' 전에 '->'가 나오면 switch rule, 최상위 ','면 여러 라벨, 타입 + 이름이면 패턴
        if (
            t.text === 'case' ||
            (t.text === 'default' && (next?.text === '->' || next?.text === ':'))
        ) {
            let depth = 0;
            for (let j = i + 1; j < tokens.length; j++) {
                const x = tokens[j].text;
                if (x === '(' || x === '[' || x === '{') depth++;
                else if (x === ')' || x === ']' || x === '}') {
                    if (depth === 0) break;
                    depth--;
                } else if (depth === 0 && x === '->') {
                    mark(FEATURES.switchRules, t);
                    break;
                } else if (depth === 0 && (x === ':' || x === ';')) break;
                else if (depth === 0 && x === ',' && t.text === 'case')
                    mark(FEATURES.multipleCaseLabels, tokens[j]);
            }
            if (t.text === 'case') {
                if (next?.text === 'null') mark(FEATURES.switchPatterns, next);
                const after = skipType(tokens, i + 1);
                if (after > 0 && isName(tokens[after]) && tokens[after + 1]?.text !== '.')
                    mark(FEATURES.switchPatterns, next!);
            }
        }

        // switch가 값 자리에 오면 switch expression
        if (
            t.text === 'switch' &&
            prev &&
            (['return', 'yield'].includes(prev.text) ||
                (prev.kind === 'op' && !['{', '}', ';', ')', ':', '.'].includes(prev.text)))
        ) {
            mark(FEATURES.switchExpressions, t);
        }

        // x instanceof Type name / x instanceof Type(...)
        if (t.text === 'instanceof') {
            let j = i + 1;
            if (tokens[j]?.text === 'final') j++;
            const after = skipType(tokens, j);
            if (after > 0 && isName(tokens[after])) mark(FEATURES.instanceofPatterns, tokens[j]);
            else if (after > 0 && tokens[after]?.text === '(')
                mark(FEATURES.recordPatterns, tokens[j]);
        }

        // try (r) / try (r; ...) : 이미 있는 변수를 자원으로 (Java 9)
        if (t.text === 'try' && next?.text === '(' && isName(tokens[i + 2])) {
            let j = i + 3;
            while (tokens[j]?.text === '.' && isName(tokens[j + 1])) j += 2;
            if (tokens[j]?.text === ')' || tokens[j]?.text === ';')
                mark(FEATURES.tryResourceVariables, tokens[i + 2]);
        }

        // var: Java 10부터 (지역 변수, for, 람다 인자)
        if (
            t.text === 'var' &&
            isName(next) &&
            (!prev || ['{', '}', ';', '(', ',', 'final'].includes(prev.text))
        ) {
            const after = tokens[i + 2]?.text;
            if (after === '=' || after === ':' || after === ';' || after === ',' || after === ')')
                varTokens.push(t);
        }
    }

    const issues: JavaSyntaxIssue[] = [...found].map(([feature, token]) => ({
        start: token.start,
        end: token.end,
        message: message(feature, release),
    }));
    // Java 8의 javac는 var를 타입 이름으로 읽습니다.
    if (release < 10 && varTokens.length) {
        const t = varTokens[0];
        issues.push({
            start: t.start,
            end: t.end,
            message: 'cannot find symbol\n  symbol:   class var',
        });
    }
    return issues.sort((a, b) => a.start - b.start);
};
