import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstDiffLine, isSameOutput, normalizeOutput } from './judge.ts';
import { resolveLanguage } from '../shared/languages.ts';

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
