// 사용자 소스에 선언된 클래스(중첩 클래스, record, enum, interface)의 멤버를 읽습니다.
// JDK 색인(classfile.ts)과 같은 모양으로 만들어, `node.` 뒤의 자동완성이나 직접 만든 메서드의
// 시그니처 힌트에 씁니다. 컴파일러가 아니라 정규식 수준의 분석이라, 흔한 선언 형태만 알아봅니다.
import type { JavaClass, JavaMember } from './classfile.ts';

export type UserClass = JavaClass & {
    /** 클래스 본문의 범위 (여는 중괄호 ~ 닫는 중괄호) */
    from: number;
    to: number;
};

/** 주석과 문자열·문자 리터럴을 같은 길이의 공백으로 바꿉니다. (위치는 그대로) */
export const blankLiterals = (code: string) =>
    code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) =>
        m.replace(/[^\n]/g, ' ')
    );

/** 최상위 쉼표로 나누기 (괄호/꺾쇠 안은 무시) */
const splitTop = (text: string) => {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if ('<([{'.includes(ch)) depth++;
        else if ('>)]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
};

const MODIFIERS = String.raw`(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|volatile|transient|strictfp)\s+)*`;
const TYPE = String.raw`(?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s*<[^;(){}=]*?>)?(?:\s*\[\s*\])*`;
const ANNOTATIONS = String.raw`(?:@\w+(?:\([^)]*\))?\s+)*`;
const NOT_A_TYPE =
    /^(return|new|throw|else|case|import|package|class|interface|enum|record|if|for|while|do|switch|try|catch|finally|break|continue|assert|yield)$/;

/** `final int a` → 표시용 `int a` */
const parameter = (text: string) => text.replace(/^(?:final\s+|@\w+\s+)+/, '').replace(/\s+/g, ' ');

const HEADER = new RegExp(
    String.raw`\b(class|interface|enum|record)\s+([A-Za-z_]\w*)\s*(<[^{(]*?>)?\s*(?:\(([^)]*)\))?\s*` +
        String.raw`(?:extends\s+([\w.<>,\s?\[\]]+?))?\s*(?:implements\s+([\w.<>,\s?\[\]]+?))?\s*\{`,
    'g'
);

/**
 * 클래스 본문에서 멤버 선언만 남깁니다: 안쪽 블록(메서드 본문, 중첩 클래스, 초기화 목록)을 비우고
 * 닫는 중괄호 자리에 `;`를 둬서, 모든 멤버가 `;` 뒤에서 시작하게 만듭니다.
 */
const flattenBody = (body: string) => {
    let out = '';
    let depth = 0;
    for (const ch of body) {
        if (ch === '{') {
            depth++;
            out += ' ';
        } else if (ch === '}') {
            depth--;
            out += depth === 0 ? ';' : ' ';
        } else {
            out += depth === 0 || ch === '\n' ? ch : ' ';
        }
    }
    return out;
};

export const parseUserClasses = (source: string): UserClass[] => {
    const code = blankLiterals(source);
    const classes: UserClass[] = [];
    for (const header of code.matchAll(HEADER)) {
        const [, keyword, name, typeParams, recordParams, extendsText, implementsText] = header;
        const from = header.index + header[0].length - 1;
        let depth = 0;
        let to = -1;
        for (let i = from; i < code.length; i++) {
            if (code[i] === '{') depth++;
            else if (code[i] === '}' && --depth === 0) {
                to = i;
                break;
            }
        }
        // 닫는 중괄호를 아직 안 쓴 경우(입력 중)에는 끝까지를 본문으로 봅니다.
        if (to < 0) to = code.length;
        const flat = flattenBody(code.slice(from + 1, to));

        const cls: UserClass = { n: name, f: [], m: [], c: [], from, to };
        if (typeParams)
            cls.tp = splitTop(typeParams.slice(1, -1)).map((p) => /^\w+/.exec(p)?.[0] ?? p);
        const parents = extendsText ? splitTop(extendsText) : [];
        const interfaces = implementsText ? splitTop(implementsText) : [];
        if (keyword === 'interface') {
            cls.iface = 1;
            cls.itf = parents;
        } else {
            if (parents[0]) cls.sup = parents[0];
            if (interfaces.length) cls.itf = interfaces;
        }

        if (keyword === 'record' && recordParams !== undefined) {
            const components = splitTop(recordParams).map(parameter);
            cls.c.push({ n: name, p: components, t: name });
            for (const component of components) {
                const m = /^(.+?)\s+(\w+)$/.exec(component);
                if (!m) continue;
                cls.f.push({ n: m[2], t: m[1] });
                cls.m.push({ n: m[2], p: [], t: m[1] });
            }
        }
        if (keyword === 'enum') {
            // 첫 `;` 전까지가 상수 목록
            const constants = flat.slice(0, flat.includes(';') ? flat.indexOf(';') : flat.length);
            for (const constant of splitTop(constants)) {
                const id = /^[A-Za-z_]\w*/.exec(constant)?.[0];
                if (id) cls.f.push({ n: id, t: name, s: 1 });
            }
            cls.m.push({ n: 'values', p: [], t: `${name}[]`, s: 1 });
            cls.m.push({ n: 'valueOf', p: ['String name'], t: name, s: 1 });
            cls.m.push({ n: 'ordinal', p: [], t: 'int' }, { n: 'name', p: [], t: 'String' });
        }

        const methodRe = new RegExp(
            String.raw`(?:^|;)\s*${ANNOTATIONS}(${MODIFIERS})(?:<[^>;]*>\s*)?(${TYPE})\s+([A-Za-z_]\w*)\s*\(([^)]*)\)`,
            'g'
        );
        for (const m of flat.matchAll(methodRe)) {
            const [, modifiers, type, methodName, params] = m;
            if (NOT_A_TYPE.test(type)) continue;
            const member: JavaMember = {
                n: methodName,
                p: splitTop(params).map(parameter),
                t: type.replace(/\s+/g, ''),
            };
            if (/\bstatic\b/.test(modifiers)) member.s = 1;
            cls.m.push(member);
        }
        const ctorRe = new RegExp(
            String.raw`(?:^|;)\s*${ANNOTATIONS}${MODIFIERS}${name}\s*\(([^)]*)\)`,
            'g'
        );
        for (const m of flat.matchAll(ctorRe))
            cls.c.push({ n: name, p: splitTop(m[1]).map(parameter), t: name });
        if (cls.c.length === 0) cls.c.push({ n: name, p: [], t: name });

        const fieldRe = new RegExp(
            String.raw`(?:^|;)\s*${ANNOTATIONS}(${MODIFIERS})(${TYPE})\s+([A-Za-z_]\w*(?:\s*\[\s*\])*(?:\s*[=,][^;]*)?)\s*(?=;)`,
            'g'
        );
        for (const m of flat.matchAll(fieldRe)) {
            const [, modifiers, type, declarators] = m;
            if (NOT_A_TYPE.test(type)) continue;
            for (const declarator of splitTop(declarators)) {
                const d = /^([A-Za-z_]\w*)((?:\s*\[\s*\])*)/.exec(declarator);
                if (!d) continue;
                const field: JavaMember = {
                    n: d[1],
                    t: type.replace(/\s+/g, '') + d[2].replace(/\s+/g, ''),
                };
                if (/\bstatic\b/.test(modifiers) || keyword === 'interface') field.s = 1;
                cls.f.push(field);
            }
        }
        classes.push(cls);
    }
    return classes;
};

/** pos를 감싸는 클래스들 (안쪽 먼저) */
export const enclosingClasses = (classes: UserClass[], pos: number) =>
    classes.filter((c) => c.from < pos && pos <= c.to).sort((a, b) => b.from - a.from);
