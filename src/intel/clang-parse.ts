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
        .replace(/<#([^#]*)#>/g, '$1')
        .replace(/\{#([^#]*)#\}/g, '$1')
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
    return `${name}(${args.map((a) => `\${${a.replace(/[{}]/g, '')}}`).join(', ')})`;
};

export const parseClangCompletions = (output: string): IntelCompletion[] => {
    const byLabel = new Map<string, IntelCompletion & { overloads: number }>();
    for (const line of output.split('\n')) {
        const m = /^COMPLETION: (.+?)(?: : (.*))?$/.exec(line.trimEnd());
        if (!m) continue;
        const name = m[1].trim();
        const pattern = m[2] ?? name;
        if (!name || name === 'Pattern' || /^operator\W/.test(name) || name.startsWith('~'))
            continue;
        if (/^__|^_[A-Z]/.test(name)) continue; // 구현 내부 이름

        const isCall = pattern.includes(`${name}(`);
        const type = resultType(pattern);
        let kind: IntelCompletion['kind'] = isCall ? 'method' : type ? 'variable' : 'type';
        if (/\(Hidden\)|\(InBase\)/.test(pattern)) continue;
        if (!isCall && !type) kind = /^[a-z]/.test(name) ? 'namespace' : 'class';
        const detail = isCall
            ? plain(pattern.replace(/^\[#[^#]*#\]/, '')).slice(name.length)
            : type;

        const existing = byLabel.get(name);
        if (existing) {
            existing.overloads++;
            continue;
        }
        byLabel.set(name, {
            label: name,
            kind,
            detail: isCall ? `${detail}${type ? ` → ${type}` : ''}` : detail,
            apply: isCall ? snippet(name, pattern) : undefined,
            overloads: 1,
        });
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
            } else if (body.startsWith('{#', i) || body.startsWith('[#', i)) {
                const end = body.indexOf('#', i + 2) + 2;
                label += body.slice(i + 2, end - 2);
                i = end;
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
