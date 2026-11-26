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
    const items = parseClangCompletions(out, { member: true });
    const push = items.find((i) => i.label === 'push_back')!;
    assert.equal(push.kind, 'method');
    assert.equal(push.apply, 'push_back(${})');
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

test('진단: 헤더 안의 에러는 그것을 부른 내 코드 위치에, note는 그 에러에', () => {
    const code = 'int main(){\n  int w;\n  std::sort(a, a + 3, bad);\n}';
    const out = [
        "main.cpp:2:7: warning: unused variable 'w'",
        '/include/c++/v1/__algorithm/sort.h:100:10: error: no matching function for call to object',
        '/include/c++/v1/__algorithm/sort.h:90:5: note: candidate function not viable',
        "main.cpp:3:8: note: in instantiation of function template specialization 'std::sort' requested here",
    ].join('\n');
    const d = parseClangDiagnostics(out, code);
    assert.equal(d.length, 2);
    assert.equal(d[0].severity, 'warning');
    assert.doesNotMatch(d[0].message, /참고/); // 경고에 엉뚱한 note가 붙지 않음
    assert.equal(d[1].severity, 'error');
    assert.equal(code.slice(d[1].from, d[1].to), 'sort');
    assert.match(d[1].message, /no matching function for call to object \(sort\.h:100\)/);
    assert.match(d[1].message, /candidate function not viable/);
    assert.match(d[1].message, /requested here/);
});

test('진단: 내 코드 위치가 없는 헤더 에러는 첫 줄에', () => {
    const d = parseClangDiagnostics('/x/y.h:1:1: error: boom', 'int main(){}');
    assert.deepEqual([d.length, d[0].from, d[0].severity], [1, 0, 'error']);
});

test('offsetOf: 줄/열', () => {
    assert.equal(offsetOf('ab\ncd', 2, 2), 4);
});

test('전역 완성: 키워드, 이름공간, 종류 분류, 순위', () => {
    const out = [
        'COMPLETION: Pattern : return <#expression#>;',
        'COMPLETION: Pattern : [#bool#]false',
        'COMPLETION: const',
        'COMPLETION: MAXN',
        'COMPLETION: chrono : chrono::',
        'COMPLETION: codecvt : codecvt<<#class#>>',
        'COMPLETION: cout : [#ostream#]cout',
        'COMPLETION: count_total : [#int#]count_total',
        'COMPLETION: INF : [#const int#]INF',
        'COMPLETION: solve : [#int#]solve(<#int a#>)',
        'COMPLETION: pair<type-parameter-0-0, type-parameter-0-1> : pair<<#class#>, <#class#>>()',
        'COMPLETION: nullptr_t (Hidden) : std::__2::nullptr_t',
    ].join('\n');
    const items = parseClangCompletions(out, { source: 'int count_total; int solve(int a);' });
    const kind = (label: string) => items.find((i) => i.label === label)?.kind;
    assert.equal(kind('return'), 'keyword');
    assert.equal(kind('false'), 'keyword');
    assert.equal(kind('const'), 'keyword');
    assert.equal(kind('MAXN'), 'constant');
    assert.equal(kind('chrono'), 'namespace');
    assert.equal(kind('codecvt'), 'class');
    assert.equal(kind('cout'), 'variable');
    assert.equal(kind('INF'), 'constant');
    assert.equal(kind('solve'), 'function');
    assert.ok(!items.some((i) => i.label.includes('<') || i.label.includes('Hidden')));
    // 사용자 코드에 나온 이름 > 자주 쓰는 이름 > 나머지
    const boost = (label: string) => items.find((i) => i.label === label)?.boost ?? 0;
    assert.ok(boost('count_total') > boost('cout'));
    assert.ok(boost('cout') > boost('codecvt'));
});

test('멤버 완성: 자기 클래스 이름은 빼고 상속 멤버는 남긴다', () => {
    const out = [
        'COMPLETION: P : P::',
        'COMPLETION: x : [#int#]x',
        'COMPLETION: base_value (InBase) : [#int#]base_value',
        'COMPLETION: Pattern : return <#expression#>;',
    ].join('\n');
    const items = parseClangCompletions(out, { member: true });
    assert.deepEqual(
        items.map((i) => `${i.label}:${i.kind}`),
        ['x:field', 'base_value:field']
    );
});

test('기본값 인자({#...#})가 현재 인자여도 시그니처가 깨지지 않는다', () => {
    const [sig] = parseClangSignatures(
        'OVERLOAD: [#basic_string#]substr(size_type __pos{#, <#size_type __n#>#})[# const#]\n'
    );
    assert.equal(sig.label, 'substr(size_type __pos, size_type __n) const → basic_string');
    assert.equal(sig.label.slice(...sig.active!), 'size_type __n');
});
