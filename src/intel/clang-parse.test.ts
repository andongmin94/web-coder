import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseClangCompletions,
    parseClangDiagnostics,
    parseClangSignatures,
} from './clang-parse.ts';
import { offsetOf } from './types.ts';

test('멤버 완성: 오버로드는 하나로 묶고 함수는 스니펫으로', () => {
    const out = [
        'COMPLETION: push_back : [#void#]push_back(<#const_reference x#>)',
        'COMPLETION: push_back : [#void#]push_back(<#value_type &&x#>)',
        'COMPLETION: size : [#size_type#]size()[# const#]',
        'COMPLETION: __base : [#int#]__base',
        'COMPLETION: operator= : [#vector &#]operator=(<#const vector &#>)',
        'COMPLETION: value_type : value_type',
    ].join('\n');
    const items = parseClangCompletions(out);
    const push = items.find((i) => i.label === 'push_back')!;
    assert.equal(push.kind, 'method');
    assert.equal(push.apply, 'push_back(${const_reference x})');
    assert.match(push.detail!, /\+1 오버로드/);
    assert.equal(items.find((i) => i.label === 'size')!.apply, 'size()');
    assert.ok(!items.some((i) => i.label === '__base' || i.label.startsWith('operator')));
});

test('시그니처: 현재 인자 위치', () => {
    const sigs = parseClangSignatures(
        'OVERLOAD: [#void#]sort(<#RandomAccessIterator first#>, RandomAccessIterator last)\n'
    );
    assert.equal(
        sigs[0].label,
        'sort(RandomAccessIterator first, RandomAccessIterator last) → void'
    );
    const [a, b] = sigs[0].active!;
    assert.equal(sigs[0].label.slice(a, b), 'RandomAccessIterator first');
});

test('진단: 바이트 열을 offset으로, note는 붙이기', () => {
    const code = 'int main(){\n  int x = "가"; foo();\n}';
    const out = [
        "main.cpp:2:11: error: cannot initialize a variable of type 'int'",
        "main.cpp:2:18: error: use of undeclared identifier 'foo'",
        'main.cpp:1:5: note: here',
    ].join('\n');
    const d = parseClangDiagnostics(out, code);
    assert.equal(d.length, 2);
    assert.equal(code.slice(d[0].from, d[0].to), '"');
    // "가"는 UTF-8 3바이트 → 2:18 바이트 열은 foo의 시작
    assert.equal(code.slice(d[1].from, d[1].to), 'foo');
    assert.match(d[1].message, /참고: here/);
});

test('offsetOf: 줄/열', () => {
    assert.equal(offsetOf('ab\ncd', 2, 2), 4);
});
