import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    differingRange,
    findTolerance,
    firstDiffLine,
    hasDecimalNumber,
    isSameOutput,
    isSameWithTolerance,
    normalizeOutput,
} from './judge.ts';
import { judgeMemoryLimitMB, resolveLanguage } from '../shared/languages.ts';

test('줄 끝 공백과 마지막 개행은 무시한다', () => {
    assert.ok(isSameOutput('1 2 \n3\n\n', '1 2\n3'));
    assert.ok(isSameOutput('a\r\nb\r\n', 'a\nb'));
});

test('줄 앞 공백과 중간 빈 줄은 구분한다', () => {
    assert.ok(!isSameOutput(' 1', '1'));
    assert.ok(!isSameOutput('1\n\n2', '1\n2'));
});

test('빈 출력', () => {
    assert.equal(normalizeOutput('\n\n'), '');
    assert.ok(isSameOutput('', '\n'));
});

test('처음 다른 줄', () => {
    assert.equal(firstDiffLine('1\n2\n3', '1\n2\n3'), null);
    assert.equal(firstDiffLine('1\n5\n3', '1\n2\n3'), 2);
    assert.equal(firstDiffLine('1\n2', '1\n2\n3'), 3);
});

test('BOJ 언어 이름 매핑', () => {
    assert.equal(resolveLanguage({ id: '84', label: 'C++17' })?.runtime, 'cpp');
    assert.equal(resolveLanguage({ id: '95', label: 'C++20' })?.cppStd, 'c++20');
    assert.equal(resolveLanguage({ id: '0', label: 'C++23' })?.cppStd, 'c++23');
    assert.equal(resolveLanguage({ id: '0', label: 'C++26' })?.cppStd, 'c++2c');
    assert.equal(resolveLanguage({ id: '1', label: 'C++' })?.cppStd, 'c++17');
    assert.equal(resolveLanguage({ id: '85', label: 'C++17 (Clang)' })?.cppStd, 'c++17');
    assert.equal(resolveLanguage({ id: '28', label: 'Python 3' })?.runtime, 'python');
    assert.equal(resolveLanguage({ id: '73', label: 'PyPy3' })?.runtime, 'python');
    assert.equal(resolveLanguage({ id: '17', label: 'node.js' })?.runtime, 'javascript');
    assert.equal(resolveLanguage({ id: '93', label: 'Java 11' })?.runtime, 'java');
    assert.equal(resolveLanguage({ id: '3', label: 'Java 8 (OpenJDK)' })?.runtime, 'java');
    assert.equal(resolveLanguage({ id: '0', label: 'JavaScript' }), null);
    assert.equal(resolveLanguage({ id: '0', label: 'Kotlin (JVM)' }), null);
});

test('실수 오차 허용 비교', () => {
    const expected = '0.33333333333333333333333333333333';
    assert.ok(isSameWithTolerance('0.3333333333333333', expected, 1e-9));
    assert.ok(isSameWithTolerance('0.333333333333', expected, 1e-9));
    assert.ok(!isSameWithTolerance('0.333333', expected, 1e-9));
    assert.ok(isSameWithTolerance('1000000000.5', '1000000000.0', 1e-9)); // 상대 오차
    assert.ok(isSameWithTolerance('YES 1.50000', 'YES 1.5', 1e-6));
    assert.ok(!isSameWithTolerance('NO 1.5', 'YES 1.5', 1e-6));
    assert.ok(!isSameWithTolerance('1.5 2', '1.5', 1e-6));
});

test('기대 출력에 실수가 있는지', () => {
    assert.ok(hasDecimalNumber('0.8'));
    assert.ok(hasDecimalNumber('3 1e-5'));
    assert.ok(!hasDecimalNumber('3 4\nYES'));
});

test('문제 본문에서 허용 오차 찾기', () => {
    assert.equal(
        findTolerance(
            '첫째 줄에 A/B를 출력한다. 실제 정답과 출력값의 절대오차 또는 상대오차가 10-9 이하이면 정답이다.'
        ),
        1e-9
    );
    assert.equal(findTolerance('정답과의 오차가 $10^{-6}$ 이하이면 맞은 것으로 처리한다.'), 1e-6);
    assert.equal(findTolerance('절대/상대 오차는 1e-4까지 허용한다.'), 1e-4);
    // 오차 이야기가 없는 문장의 10-9는 무시
    assert.equal(findTolerance('수는 10-9 사이의 정수이다.'), null);
    assert.equal(findTolerance('답이 여러 가지면 아무거나 출력한다.'), null);
});

test('허용 오차: 계수, 괄호 지수, 소수점, 날짜', () => {
    const close = (actual: number | null, expected: number) =>
        assert.ok(actual !== null && Math.abs(actual - expected) < expected * 1e-9, `${actual}`);
    close(findTolerance('정답과의 오차가 1.0×10^{-6} 이하이면 정답으로 인정한다.'), 1e-6);
    close(findTolerance('절대 오차가 2×10^{-3} 이하면 맞는다.'), 2e-3);
    close(findTolerance('오차는 10^(-6)까지 허용한다.'), 1e-6);
    close(findTolerance('상대 오차 또는 절대 오차가 1.5e-7 이하인 답을 정답으로 한다.'), 1.5e-7);
    // 날짜·범위 속의 10은 오차가 아님
    assert.equal(findTolerance('2020-10-12에 추가된 문제로, 오차는 따로 없다.'), null);
    // 소수점이 있어도 문장이 끊기지 않음 (뒤 문장의 값과 섞이지 않음)
    close(findTolerance('출력은 소수점 아래 6자리. 오차 10-9 이하는 정답.'), 1e-9);
});

test('BOJ 언어별 메모리 제한', () => {
    assert.equal(judgeMemoryLimitMB({ runtime: 'cpp', label: 'C++17' }, 128), 128);
    assert.equal(judgeMemoryLimitMB({ runtime: 'python', label: 'Python 3' }, 128), 288);
    assert.equal(judgeMemoryLimitMB({ runtime: 'python', label: 'PyPy3' }, 128), 384);
    assert.equal(judgeMemoryLimitMB({ runtime: 'javascript', label: 'node.js' }, 128), 256);
});

test('한 줄 안에서 다른 구간', () => {
    assert.deepEqual(differingRange('1 2 3', '1 5 3'), { start: 2, endA: 3, endB: 3 });
    assert.deepEqual(differingRange('abc', 'abcd'), { start: 3, endA: 3, endB: 4 });
    assert.deepEqual(differingRange('hello world', 'hello  world'), { start: 6, endA: 6, endB: 7 });
    assert.deepEqual(differingRange('same', 'same'), { start: 4, endA: 4, endB: 4 });
    assert.deepEqual(differingRange('', 'x'), { start: 0, endA: 0, endB: 1 });
});
