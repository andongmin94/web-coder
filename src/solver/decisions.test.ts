import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseInitialLanguage, submitWarning } from './decisions.ts';
import type { ResolvedLanguage } from '../shared/languages.ts';
import type { Verdict } from './tests-view.ts';

const lang = (
    id: string,
    label: string,
    runtime: ResolvedLanguage['runtime']
): ResolvedLanguage => ({
    id,
    label,
    runtime,
});
const CPP = lang('84', 'C++17', 'cpp');
const PY = lang('28', 'Python 3', 'python');
const languages = [PY, CPP];

test('수정 제출: 지원하는 언어면 그 언어와 그 코드로', () => {
    const r = chooseInitialLanguage(
        languages,
        { selectedLanguageId: '28', initialSource: 'print(1)' },
        'C++17'
    );
    assert.deepEqual(
        [r.language.id, r.initialCode, r.unsupportedSource],
        ['28', 'print(1)', false]
    );
});

test('수정 제출: 지원하지 않는 언어(Rust)의 코드는 다른 언어 칸에 올리지 않는다', () => {
    const r = chooseInitialLanguage(
        languages,
        { selectedLanguageId: '94', initialSource: 'fn main() {}' },
        'Python 3'
    );
    assert.equal(r.language.id, '28'); // 마지막으로 고른 언어
    assert.equal(r.initialCode, undefined); // 저장해 둔 코드를 덮어쓰지 않음
    assert.equal(r.unsupportedSource, true);
});

test('새 제출: 폭 없는 공백만 있는 폼은 빈 것으로, 마지막 언어 → C++17 순서', () => {
    const empty = { selectedLanguageId: '28', initialSource: '​\n' };
    assert.equal(chooseInitialLanguage(languages, empty, undefined).language.id, '84');
    assert.equal(chooseInitialLanguage(languages, empty, 'Python 3').language.id, '28');
    assert.equal(chooseInitialLanguage(languages, empty, undefined).unsupportedSource, false);
});

const base = {
    functionOnly: false,
    source: 'code',
    languageId: '84',
    lastRun: {
        source: 'code',
        languageId: '84',
        verdicts: ['pass', 'fail'] as Verdict[],
        compileError: false,
    },
    currentVerdicts: null,
    hasCustomTests: false,
};

test('제출 경고: 실행 안 함, 컴파일 에러, 실패 개수', () => {
    assert.match(submitWarning({ ...base, source: 'changed' })!, /아직 예제를 실행하지/);
    assert.match(submitWarning({ ...base, languageId: '28' })!, /아직 예제를 실행하지/);
    assert.match(
        submitWarning({ ...base, lastRun: { ...base.lastRun, compileError: true } })!,
        /컴파일 에러/
    );
    assert.equal(submitWarning(base), '예제 2개 중 1개를 통과하지 못했습니다.');
    assert.equal(
        submitWarning({ ...base, hasCustomTests: true }),
        '예제와 내 테스트 2개 중 1개를 통과하지 못했습니다.'
    );
    assert.equal(submitWarning({ ...base, functionOnly: true, source: 'x' }), null);
});

test('제출 경고: 실행 뒤 기대 출력을 고쳐 통과하게 되면 경고하지 않는다', () => {
    assert.equal(submitWarning({ ...base, currentVerdicts: ['pass', 'pass'] }), null);
});
