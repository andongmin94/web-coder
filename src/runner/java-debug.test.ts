import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJavaStackDecoder } from './java-debug.ts';

const text = (value: string) => [value.length, ...new TextEncoder().encode(value)];
const custom = (name: string, payload: number[]) => {
    const body = [...text(name), ...payload];
    return [0x00, body.length, ...body];
};
const moduleWith = (sections: number[][]) =>
    Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections.flat()]);

// 문자열: 0 java, 1 util, 2 ArrayList, 3 get, 4 Main, 5 main, 6 TArrayList
const STRINGS = ['java', 'util', 'ArrayList', 'get', 'Main', 'main', 'TArrayList'];

/**
 * Main.main(Main.java) 안에 java.util.ArrayList.get(TArrayList.java)이 인라인된 모양:
 *   주소 100~109  Main.main 줄 5
 *   주소 110~119  Main.main 줄 7 안의 ArrayList.get 줄 67
 *   주소 120~124  Main.main 줄 8
 */
const debugModule = () =>
    moduleWith([
        custom('teavm_str', STRINGS.flatMap(text)),
        // 패키지: 0 java, 1 java.util
        custom('teavm_pkg', [0, 0, 1, 1]),
        // 클래스: 0 java.util.ArrayList, 1 Main (기본 패키지)
        custom('teavm_cls', [2, 2, 0, 4]),
        // 메서드: 0 ArrayList.get, 1 Main.main
        custom('teavm_mtd', [0, 3, 1, 5]),
        // 경로: 0 java/, 1 java/TArrayList.java, 2 Main.java
        custom('teavm_file', [0, 0, 1, 6 * 2 + 1, 0, 0, 4 * 2 + 1, 0]),
        custom('teavm_line', [
            ...[4, 100], // 주소 100
            ...[0, 1, 3, 3, 2, 4], // Main.main 시작, 파일 Main.java, 줄 1 + 4
            ...[4, 10], // 주소 110
            ...[2, 2], // 줄 7
            ...[0, 0, 3, 2, 2, 0xc2, 0x00], // ArrayList.get 시작, TArrayList.java, 줄 1 + 66
            ...[4, 10], // 주소 120
            1, // ArrayList.get 끝
            10 + 0 + 32 * 4, // 주소 그대로, 줄 += 1
            ...[4, 5], // 주소 125
            1, // Main.main 끝
        ]),
    ]);

test('주소를 클래스·메서드·파일·줄 번호로 바꾼다', () => {
    const decode = createJavaStackDecoder(debugModule())!;
    assert.deepEqual(decode(105), [
        { className: 'Main', method: 'main', file: 'Main.java', line: 5 },
    ]);
    assert.deepEqual(decode(124), [
        { className: 'Main', method: 'main', file: 'Main.java', line: 8 },
    ]);
});

test('인라인된 호출은 안쪽 프레임부터 나온다', () => {
    const decode = createJavaStackDecoder(debugModule())!;
    assert.deepEqual(decode(110), [
        { className: 'java.util.ArrayList', method: 'get', file: 'TArrayList.java', line: 67 },
        { className: 'Main', method: 'main', file: 'Main.java', line: 7 },
    ]);
});

test('디버그 정보 밖의 주소는 프레임이 없다', () => {
    const decode = createJavaStackDecoder(debugModule())!;
    assert.deepEqual(decode(50), []);
    assert.deepEqual(decode(125), []);
});

test('디버그 정보가 없는 모듈은 null', () => {
    assert.equal(createJavaStackDecoder(moduleWith([])), null);
});
