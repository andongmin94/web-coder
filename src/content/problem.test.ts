import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTexDelimiters } from './problem.ts';

test('MathJax 3 copytext의 구분자를 떼어 TeX 원문을 얻는다', () => {
    assert.deepEqual(splitTexDelimiters('\\(N\\)'), { tex: 'N', display: false });
    assert.deepEqual(splitTexDelimiters(' \\[\\binom{N}{K}\\] '), {
        tex: '\\binom{N}{K}',
        display: true,
    });
    assert.deepEqual(splitTexDelimiters('$$x^2$$'), { tex: 'x^2', display: true });
    assert.deepEqual(splitTexDelimiters('$1 \\le N$'), { tex: '1 \\le N', display: false });
});

test('구분자가 없거나 비어 있으면 null', () => {
    assert.equal(splitTexDelimiters('N'), null);
    assert.equal(splitTexDelimiters('\\(\\)'), null);
    assert.equal(splitTexDelimiters(''), null);
});
