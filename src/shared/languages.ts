// BOJ 제출 언어와 로컬 런타임의 대응 관계.
// BOJ 언어 ID를 하드코딩하지 않고 제출 폼의 언어 이름으로 판별합니다.

export type RuntimeKey = 'cpp' | 'python' | 'javascript' | 'java';

export type RuntimeInfo = {
    key: RuntimeKey;
    /** 에디터 문법 강조용 */
    editor: 'cpp' | 'python' | 'javascript' | 'java';
    template: string;
};

export type BojLanguage = {
    /** BOJ 제출 폼의 language 값 */
    id: string;
    /** BOJ 제출 폼에 표시되는 이름 */
    label: string;
};

export type ResolvedLanguage = BojLanguage & {
    runtime: RuntimeKey;
    /** C++ 표준 (cpp 런타임일 때만) */
    cppStd?: string;
};

const CPP_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    return 0;
}
`;

const PYTHON_TEMPLATE = `import sys
input = sys.stdin.readline

`;

const JS_TEMPLATE = `const input = require('fs').readFileSync('/dev/stdin', 'utf8').trim().split('\\n');

`;

const JAVA_TEMPLATE = `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));

    }
}
`;

export const RUNTIMES: Record<RuntimeKey, RuntimeInfo> = {
    cpp: { key: 'cpp', editor: 'cpp', template: CPP_TEMPLATE },
    python: { key: 'python', editor: 'python', template: PYTHON_TEMPLATE },
    javascript: { key: 'javascript', editor: 'javascript', template: JS_TEMPLATE },
    java: { key: 'java', editor: 'java', template: JAVA_TEMPLATE },
};

/** BOJ 언어 이름의 숫자 → clang -std 값 (번호 없는 "C++"는 C++17로 실행) */
const CPP_STD: Record<string, string> = {
    '98': 'c++98',
    '03': 'c++03',
    '11': 'c++11',
    '14': 'c++14',
    '17': 'c++17',
    '20': 'c++20',
    '23': 'c++23',
    '26': 'c++2c',
};

/** BOJ 언어 이름을 로컬 런타임으로 매핑합니다. 지원하지 않으면 null. */
export const resolveLanguage = (lang: BojLanguage): ResolvedLanguage | null => {
    const label = lang.label.replace(/\s+/g, ' ').trim();

    const cpp = /^C\+\+\s?(\d{2})?(?:\s*\((?:Clang|GCC)\))?$/i.exec(label);
    if (cpp) {
        const cppStd = CPP_STD[cpp[1] ?? ''] ?? 'c++17';
        return { ...lang, label, runtime: 'cpp', cppStd };
    }

    if (/^(Python 3|PyPy3)$/i.test(label)) {
        return { ...lang, label, runtime: 'python' };
    }

    // Java 8, Java 11, Java 8 (OpenJDK) 등. 로컬에서는 모두 같은 javac(TeaVM)로 실행합니다.
    if (/^Java(\s+\d+)?(\s*\(OpenJDK\))?$/i.test(label)) {
        return { ...lang, label, runtime: 'java' };
    }

    if (/^node\.?js$/i.test(label)) {
        return { ...lang, label, runtime: 'javascript' };
    }

    return null;
};

export const resolveLanguages = (langs: BojLanguage[]): ResolvedLanguage[] =>
    langs.map(resolveLanguage).filter((l): l is ResolvedLanguage => l !== null);

/**
 * BOJ가 언어별로 늘려 주는 시간 제한 (https://help.acmicpc.net/language/info).
 * C++는 그대로, Java는 ×2+1초, Python·PyPy·node.js는 ×3+2초.
 */
export const judgeTimeLimitMs = (runtime: RuntimeKey, limitSec: number) => {
    const base = limitSec * 1000;
    if (runtime === 'java') return base * 2 + 1000;
    if (runtime === 'python' || runtime === 'javascript') return base * 3 + 2000;
    return base;
};

/**
 * 로컬 실행을 강제로 끊는 시간. 브라우저 실행은 채점 서버보다 느리므로 BOJ 제한보다 넉넉하게 잡습니다.
 * (C++ wasm은 네이티브의 1.5~2배, CPython wasm은 3~4배쯤 걸림)
 */
const LOCAL_SLACK: Record<RuntimeKey, number> = { cpp: 3, java: 2, python: 2.5, javascript: 1.5 };
export const localTimeoutMs = (runtime: RuntimeKey, limitSec: number) =>
    Math.min(30_000, Math.max(3_000, judgeTimeLimitMs(runtime, limitSec) * LOCAL_SLACK[runtime]));
