import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findLocations } from './locations.ts';

const pick = (text: string) =>
    findLocations(text).map((l) => [text.slice(l.start, l.end), l.line, l.column]);

test('C++·Java·node 위치', () => {
    assert.deepEqual(pick("main.cpp:7:22: error: expected ';'"), [['main.cpp:7:22', 7, 22]]);
    assert.deepEqual(pick('Main.java:3: error: incompatible types'), [['Main.java:3', 3, null]]);
    assert.deepEqual(pick('    at Main.main(Main.java:12)'), [['Main.java:12', 12, null]]);
    assert.deepEqual(pick('    at f (main.js:2:11)\n    at f (main.js:2:22)'), [
        ['main.js:2:11', 2, 11],
        ['main.js:2:22', 2, 22],
    ]);
});

test('Python 트레이스백 위치', () => {
    assert.deepEqual(pick('  File "/main.py", line 4, in <module>'), [
        ['File "/main.py", line 4', 4, null],
    ]);
});

test('위치가 아닌 것은 무시', () => {
    assert.deepEqual(pick('2 errors generated.'), []);
    assert.deepEqual(pick('domain.cpp:3:1'), []);
    assert.deepEqual(pick('main.cpp:0:1'), []);
});
