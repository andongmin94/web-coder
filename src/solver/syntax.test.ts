import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightTree, tagHighlighter } from '@lezer/highlight';
import { SYNTAX } from './syntax.ts';
import { SYNTAX_RULES } from './themes.ts';

// 테마와 같은 규칙으로, 각 토큰이 어느 팔레트 색이 되는지 (없으면 'text' = 기본 글자색)
const highlighter = tagHighlighter(SYNTAX_RULES.map(({ tag, color }) => ({ tag, class: color })));

const colorsOf = (lang: keyof typeof SYNTAX, code: string) => {
    const spans: [number, number, string][] = [];
    highlightTree(SYNTAX[lang].parser.parse(code), highlighter, (from, to, cls) =>
        spans.push([from, to, cls])
    );
    /** code 안에서 n번째(0부터)로 나오는 word의 색 */
    return (word: string, n = 0) => {
        let at = -1;
        for (let i = 0; i <= n; i++) at = code.indexOf(word, at + 1);
        assert.ok(at >= 0, `${word} 없음`);
        const span = spans.find(([f, e]) => f <= at && e >= at + word.length);
        return span ? span[2] : 'text';
    };
};

test('C++: 함수 정의·호출과 클래스 안의 멤버 함수 정의', () => {
    const color = colorsOf(
        'cpp',
        `struct Seg { void update(int i) { } bool operator<(const Seg& o) const; };
int solve(int n) { return n; }
int main() { Seg seg; seg.update(1); vector<int> v; v.push_back(solve(1)); }`
    );
    assert.equal(color('update'), 'function'); // 클래스 안 정의 (고침)
    assert.equal(color('update', 1), 'function'); // 호출
    assert.equal(color('solve'), 'function');
    assert.equal(color('main'), 'function');
    assert.equal(color('push_back'), 'function');
    assert.equal(color('Seg'), 'type');
    assert.equal(color('seg'), 'variable');
});

test('Python: 함수 정의·호출, 메서드, 타입 힌트', () => {
    const color = colorsOf(
        'python',
        `class G:
    def bfs(self, s: int) -> int:
        return len(s)
def solve(n):
    return max(n, 1)
print(solve(1), G().bfs(0))`
    );
    assert.equal(color('bfs'), 'function');
    assert.equal(color('int'), 'type'); // 타입 힌트 (고침)
    assert.equal(color('solve'), 'function');
    assert.equal(color('print'), 'function');
    assert.equal(color('G'), 'type');
});

test('JavaScript: 함수 선언, 클래스 메서드 선언, 이름 있는 함수 식', () => {
    const color = colorsOf(
        'javascript',
        `class Seg { constructor(n) { this.n = n; } update(i) { return i; } }
function solve(n) { return n; }
const g = function named(y) { return y; };
console.log(solve(1), new Seg(1).update(2));`
    );
    assert.equal(color('constructor'), 'function'); // (고침)
    assert.equal(color('update'), 'function'); // 메서드 선언 (고침)
    assert.equal(color('named'), 'function'); // (고침)
    assert.equal(color('solve'), 'function');
    assert.equal(color('log'), 'function');
    assert.equal(color('Seg'), 'type');
});

test('Java: 메서드·생성자 선언, 클래스·record 선언 이름, record 키워드, 어노테이션', () => {
    const color = colorsOf(
        'java',
        `public class Main {
    record P(int a) {}
    Main() {}
    @Override public String toString() { return ""; }
    static int solve(int n) { return Math.max(n, 1); }
    public static void main(String[] args) { System.out.println(solve(1)); }
}`
    );
    assert.equal(color('Main'), 'type'); // 클래스 선언 이름 (고침)
    assert.equal(color('record'), 'keyword'); // (고침: 원래 아무 색도 없음)
    assert.equal(color('P'), 'type');
    assert.equal(color('Main', 1), 'function'); // 생성자 선언
    assert.equal(color('@'), 'meta'); // (고침)
    assert.equal(color('Override'), 'meta'); // (고침)
    assert.equal(color('toString'), 'function');
    assert.equal(color('solve'), 'function');
    assert.equal(color('max'), 'function');
    assert.equal(color('main'), 'function');
    assert.equal(color('println'), 'function');
    assert.equal(color('String'), 'type');
});
