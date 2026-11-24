import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatCode, mapPosition, minimalChange, setFormatWasmLoader } from './format.ts';

const WASM: Record<string, string> = {
    'clang-format.wasm': 'node_modules/@wasm-fmt/clang-format/clang-format.wasm',
    'ruff_fmt_bg.wasm': 'node_modules/@wasm-fmt/ruff_fmt/ruff_fmt_bg.wasm',
};
setFormatWasmLoader(async (file) => new Uint8Array(await readFile(WASM[file])));

const formatted = async (lang: Parameters<typeof formatCode>[0], code: string) => {
    const result = await formatCode(lang, code);
    assert.ok(result.ok, result.ok ? '' : result.message);
    return result.code;
};

test('C++: 들여쓰기 4칸, 중괄호는 줄 끝, include 순서 유지', async () => {
    const code = await formatted(
        'cpp',
        '#include <bits/stdc++.h>\n#include <algorithm>\nusing namespace std;\nint main(){int n;cin>>n;for(int i=0;i<n;i++){cout<<i<<"\\n";}return 0;}\n'
    );
    assert.equal(
        code,
        [
            '#include <bits/stdc++.h>',
            '#include <algorithm>',
            'using namespace std;',
            'int main() {',
            '    int n;',
            '    cin >> n;',
            '    for (int i = 0; i < n; i++) {',
            '        cout << i << "\\n";',
            '    }',
            '    return 0;',
            '}',
            '',
        ].join('\n')
    );
});

test('Java, JavaScript도 같은 규칙', async () => {
    assert.equal(
        await formatted(
            'java',
            'public class Main{public static void main(String[] args){int a=1;System.out.println(a);}}\n'
        ),
        [
            'public class Main {',
            '    public static void main(String[] args) {',
            '        int a = 1;',
            '        System.out.println(a);',
            '    }',
            '}',
            '',
        ].join('\n')
    );
    assert.equal(
        await formatted('javascript', 'const [a,b]=line.split(" ").map(Number);console.log(a+b)\n'),
        'const [a, b] = line.split(" ").map(Number);\nconsole.log(a + b)\n'
    );
});

test('Python: Ruff로 정렬, 문법 오류면 줄 번호를 알려 준다', async () => {
    assert.equal(
        await formatted('python', 'import sys\nn=int( input() )\nprint( n*2 )\n'),
        'import sys\n\nn = int(input())\nprint(n * 2)\n'
    );
    const broken = await formatCode('python', '# 한글 주석\nx = 1\ndef f(:\n    pass\n');
    assert.deepEqual(broken, {
        ok: false,
        message: '문법 오류가 있어 정렬하지 못했습니다. (3번째 줄)',
    });
});

test('커서는 공백이 아닌 글자 기준으로 같은 자리에 남는다', () => {
    const before = 'int main(){return a+b;}';
    const after = 'int main() {\n    return a + b;\n}';
    const pos = before.indexOf('b;');
    assert.equal(mapPosition(before, after, pos), after.indexOf('b;'));
    assert.equal(mapPosition(before, after, 0), 0);
    assert.equal(mapPosition(before, after, before.length), after.length);
    // 줄 끝 커서는 줄 끝에
    assert.equal(mapPosition('a;\nb;', 'a;\n\nb;', 2), 2);
});

test('바뀐 구간만 바꾼다', () => {
    assert.deepEqual(minimalChange('a  b\nc', 'a b\nc'), { from: 2, to: 3, insert: '' });
    assert.deepEqual(minimalChange('same', 'same'), { from: 4, to: 4, insert: '' });
});
