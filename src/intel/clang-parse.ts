// clang -code-completion-at / -fsyntax-only 출력 해석
import {
    offsetOf,
    tokenEnd,
    type IntelCompletion,
    type IntelDiagnostic,
    type IntelSignature,
} from './types.ts';

/** `[#int#]foo(<#int a#>, <#int b#>)[# const#]` 같은 clang 패턴에서 표시용 텍스트를 만듭니다. */
const plain = (pattern: string) =>
    pattern
        .replace(/\[#([^#]*)#\]/g, '')
        // 기본값 있는 인자는 `{#, <#int b#>{#, <#int c#>#}#}`처럼 중첩되므로 표시만 지웁니다.
        .replace(/<#|#>|\{#|#\}/g, '')
        .trim();

const resultType = (pattern: string) => /^\[#([^#]*)#\]/.exec(pattern)?.[1]?.trim();

/** 함수 패턴을 스니펫으로: 인자 자리표시자 `${a}` */
const snippet = (name: string, pattern: string) => {
    // 반환형(`[#size_type#]`) 안에 같은 이름이 있을 수 있어 `이름(`으로 찾습니다.
    const at = pattern.indexOf(`${name}(`);
    if (at < 0) return undefined;
    const call = pattern.slice(at + name.length);
    if (!call.startsWith('(')) return undefined;
    const args = [...call.matchAll(/<#([^#]*)#>/g)].map((m) => m[1]);
    if (args.length === 0) return `${name}()`;
    // 인자가 있으면 괄호 안에 커서를 두고(`${}`) 시그니처 힌트로 인자를 안내합니다.
    // (인자 자리에 `const_reference x` 같은 글자를 채워 넣으면, 지우지 않고 넘어갔을 때 컴파일 에러가 됩니다)
    return `${name}(\${})`;
};

const KEYWORDS = new Set(
    (
        'alignas alignof auto bool break case catch char class const constexpr const_cast continue decltype default ' +
        'delete do double dynamic_cast else enum explicit extern false float for friend goto if inline int long ' +
        'mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return ' +
        'short signed sizeof static static_assert static_cast struct switch template this throw true try typedef ' +
        'typeid typename union unsigned using virtual void volatile wchar_t while char8_t char16_t char32_t concept ' +
        'requires consteval constinit co_await co_return co_yield final override'
    ).split(' ')
);

/** 풀이에서 자주 쓰는 이름. clang은 우선순위를 알려 주지 않아서(이름순), 이 이름들을 위로 올립니다. */
const COMMON = new Set(
    (
        'cout cin cerr endl vector string pair map set queue stack deque priority_queue unordered_map unordered_set ' +
        'multiset multimap tuple array bitset sort stable_sort min max swap abs reverse lower_bound upper_bound ' +
        'binary_search memset memcpy fill accumulate printf scanf puts getline to_string stoi stoll make_pair ' +
        'make_tuple get tie greater less size_t int64_t iota unique next_permutation prev_permutation gcd lcm ' +
        'min_element max_element find count sqrt pow ceil floor round INT_MAX INT_MIN LLONG_MAX LLONG_MIN ' +
        'begin end push_back emplace_back pop_back size empty clear front back top push pop insert erase first second'
    ).split(' ')
);

/** 멤버 목록에서 거의 쓰지 않아 아래로 내릴 이름 */
const RARE_MEMBERS = new Set(
    'cbegin cend crbegin crend get_allocator max_size shrink_to_fit key_comp value_comp hash_function key_eq'.split(
        ' '
    )
);

export type ClangCompletionContext = {
    /** 멤버 접근(`.`, `->`) 뒤의 목록인지 */
    member?: boolean;
    /** 사용자 소스. 여기에 이미 나온 이름(직접 선언했거나 쓰고 있는 것)을 위로 올립니다. */
    source?: string;
    /**
     * 문장 키워드(if, for, while 등)를 채워 넣을지. clang은 이 키워드들을 코드 패턴 옵션을 켰을 때만
     * 주기 때문에, 일반 위치의 전역 목록에는 직접 넣습니다.
     */
    keywords?: boolean;
};

/** clang이 기본 목록에 넣지 않는 문장·선언 키워드 */
const STATEMENT_KEYWORDS =
    'if else for while do switch case default break continue struct class enum union namespace template try catch throw public private protected'.split(
        ' '
    );

export const parseClangCompletions = (
    output: string,
    context: ClangCompletionContext = {}
): IntelCompletion[] => {
    const member = context.member === true;
    const used = new Set(context.source?.match(/[A-Za-z_]\w*/g) ?? []);
    const byLabel = new Map<string, IntelCompletion & { overloads: number }>();
    const add = (item: IntelCompletion) => {
        const existing = byLabel.get(item.label);
        if (existing) existing.overloads++;
        else byLabel.set(item.label, { ...item, overloads: 1 });
    };
    const boostOf = (name: string, kind: IntelCompletion['kind']) => {
        if (member) return RARE_MEMBERS.has(name) ? -5 : COMMON.has(name) ? 5 : undefined;
        let boost = 0;
        if (used.has(name)) boost += 30;
        if (COMMON.has(name)) boost += 20;
        if (kind === 'keyword') boost += 10;
        return boost || undefined;
    };

    for (const line of output.split('\n')) {
        const m = /^COMPLETION: (.+?)(?: : (.*))?$/.exec(line.trimEnd());
        if (!m) continue;
        let name = m[1].trim();

        // `Pattern : return <#expression#>;` 처럼 이름 없이 오는 문법 조각에서 키워드를 꺼냅니다.
        if (name === 'Pattern') {
            const keyword = /^[A-Za-z_]\w*/.exec((m[2] ?? '').replace(/^\[#[^#]*#\]/, ''))?.[0];
            if (keyword && KEYWORDS.has(keyword) && !member)
                add({ label: keyword, kind: 'keyword', boost: boostOf(keyword, 'keyword') });
            continue;
        }
        if (/ \(Hidden\)/.test(name)) continue; // 가려진 선언
        name = name.replace(/ \(InBase\)$/, ''); // 상속받은 멤버
        const pattern = m[2] ?? name;
        if (!name || /^operator\W/.test(name) || name.startsWith('~')) continue;
        if (name.includes('<') || name.includes(' ')) continue; // 부분 특수화, 추론 가이드
        if (/^__|^_[A-Z]/.test(name)) continue; // 구현 내부 이름

        const isCall = pattern.includes(`${name}(`);
        const type = resultType(pattern);
        let kind: IntelCompletion['kind'];
        if (m[2] === undefined) {
            // 패턴 없이 이름만: 키워드 또는 매크로
            kind = KEYWORDS.has(name) ? 'keyword' : 'constant';
            if (kind === 'keyword' && member) continue;
        } else if (pattern === `${name}::`) {
            // 멤버 목록에 끼어 오는 자기 클래스 이름(`P : P::`)은 뺍니다.
            if (member) continue;
            kind = 'namespace';
        } else if (isCall) {
            kind = member ? 'method' : 'function';
        } else if (type) {
            kind = member
                ? 'field'
                : /^const\b/.test(type) || /^[A-Z][A-Z0-9_]*$/.test(name)
                  ? 'constant'
                  : 'variable';
        } else if (pattern === name && /^[A-Z][A-Z0-9_]*$/.test(name)) {
            kind = 'constant'; // 매크로 상수 (INT_MAX, 사용자가 #define한 MAXN)
        } else {
            kind = 'class';
        }
        const detail = isCall
            ? plain(pattern.replace(/^\[#[^#]*#\]/, '')).slice(name.length)
            : type;
        add({
            label: name,
            kind,
            detail: isCall ? `${detail}${type ? ` → ${type}` : ''}` : detail,
            apply: isCall ? snippet(name, pattern) : undefined,
            boost: boostOf(name, kind),
        });
    }
    if (context.keywords && !member) {
        for (const keyword of STATEMENT_KEYWORDS)
            if (!byLabel.has(keyword))
                add({ label: keyword, kind: 'keyword', boost: boostOf(keyword, 'keyword') });
    }
    return [...byLabel.values()].map(({ overloads, ...item }) =>
        overloads > 1
            ? { ...item, detail: `${item.detail ?? ''}  (+${overloads - 1} 오버로드)` }
            : item
    );
};

/**
 * `OVERLOAD: [#void#]sort(<#RandomAccessIterator first#>, RandomAccessIterator last)`
 * clang은 현재 인자를 `<#...#>`로 표시합니다.
 */
export const parseClangSignatures = (output: string): IntelSignature[] => {
    const result: IntelSignature[] = [];
    for (const line of output.split('\n')) {
        const m = /^OVERLOAD: (.*)$/.exec(line.trimEnd());
        if (!m) continue;
        const pattern = m[1];
        const ret = resultType(pattern);
        const body = pattern.replace(/^\[#[^#]*#\]/, '');
        let label = '';
        let active: [number, number] | undefined;
        let i = 0;
        while (i < body.length) {
            if (body.startsWith('<#', i)) {
                const end = body.indexOf('#>', i);
                const text = body.slice(i + 2, end);
                active = [label.length, label.length + text.length];
                label += text;
                i = end + 2;
            } else if (body.startsWith('{#', i) || body.startsWith('#}', i)) {
                // 선택 인자 묶음: 안에 <#...#>와 다른 묶음이 중첩될 수 있어 표시만 건너뜁니다.
                i += 2;
            } else if (body.startsWith('[#', i)) {
                const end = body.indexOf('#]', i);
                label += body.slice(i + 2, end);
                i = end + 2;
            } else {
                label += body[i++];
            }
        }
        if (ret) label += ` → ${ret}`;
        result.push({ label, active });
    }
    return result.slice(0, 8);
};

/** `main.cpp:3:7: error: message` 형식의 진단 (note는 앞의 진단에 붙입니다) */
export const parseClangDiagnostics = (
    output: string,
    code: string,
    file = 'main.cpp'
): IntelDiagnostic[] => {
    const result: IntelDiagnostic[] = [];
    const re = new RegExp(
        `^${file.replace('.', '\\.')}:(\\d+):(\\d+): (error|warning|note|fatal error): (.*)$`
    );
    for (const line of output.split('\n')) {
        const m = re.exec(line.trimEnd());
        if (!m) continue;
        const [, l, c, level, message] = m;
        if (level === 'note') {
            const last = result.at(-1);
            if (last) last.message += `\n참고: ${message}`;
            continue;
        }
        const from = offsetOf(code, Number(l), Number(c), true);
        result.push({
            from,
            to: tokenEnd(code, from),
            severity: level === 'warning' ? 'warning' : 'error',
            message,
        });
    }
    return result;
};
