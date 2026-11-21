import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readArchive } from '../../tools/java/classlib-archive.mjs';
import { buildJavaIndex } from './classfile.ts';
import { declarations, javaComplete, javaHover, javaSignature } from './java.ts';

const index = buildJavaIndex(readArchive(readFileSync('public/java/compile-classlib.bin')).entries);

const at = (code: string) => {
    const pos = code.indexOf('|');
    return { code: code.replace('|', ''), pos };
};
const labels = (code: string) => {
    const { code: c, pos } = at(code);
    return javaComplete(index, c, pos, true)?.items.map((i) => i.label) ?? [];
};

const PRE =
    'import java.util.*;\nimport java.io.*;\npublic class Main {\n  public static void main(String[] args) throws IOException {\n';

test('선언 찾기', () => {
    const v = declarations(
        'Scanner sc = new Scanner(System.in); int[] arr = new int[3]; for (String s : list) {',
        999
    );
    assert.equal(v.get('sc'), 'Scanner');
    assert.equal(v.get('arr'), 'int[]');
    assert.equal(v.get('s'), 'String');
});

test('변수 멤버: Scanner', () => {
    const l = labels(PRE + 'Scanner sc = new Scanner(System.in);\n sc.|');
    assert.ok(l.includes('nextInt'));
    assert.ok(l.includes('nextLine'));
});

test('static 멤버와 필드 체인: System.out.', () => {
    assert.ok(labels(PRE + 'System.|').includes('out'));
    const l = labels(PRE + 'System.out.|');
    assert.ok(l.includes('println'));
    assert.ok(l.includes('printf'));
});

test('제네릭 치환: List<Integer>의 get(0).', () => {
    const l = labels(PRE + 'List<Integer> list = new ArrayList<>();\n list.get(0).|');
    assert.ok(l.includes('intValue'), l.slice(0, 10).join());
    assert.ok(labels(PRE + 'ArrayList<Integer> a = new ArrayList<>();\n a.|').includes('add'));
});

test('Map.Entry, 문자열 리터럴, 배열', () => {
    const l = labels(
        PRE +
            'Map<String, Integer> m = new HashMap<>();\n for (Map.Entry<String, Integer> e : m.entrySet()) { e.|'
    );
    assert.ok(l.includes('getKey'));
    assert.ok(labels(PRE + '"abc".|').includes('charAt'));
    assert.ok(labels(PRE + 'int[] arr = new int[3];\n arr.|').includes('length'));
    assert.ok(
        labels(PRE + 'String[] parts = br.readLine().split(" ");\n parts[0].|').includes('trim')
    );
});

test('메서드 체인: br.readLine().', () => {
    assert.ok(
        labels(
            PRE +
                'BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n br.readLine().|'
        ).includes('split')
    );
});

test('식별자 완성: 지역 변수, 템플릿, 클래스', () => {
    const l = labels(PRE + 'int count = 0;\n co|');
    assert.ok(l.includes('count'));
    assert.ok(l.includes('sout'));
    assert.ok(l.includes('ArrayList'));
});

test('시그니처: 생성자와 현재 인자', () => {
    const { code, pos } = at(PRE + 'StringTokenizer st = new StringTokenizer(|');
    const sigs = javaSignature(index, code, pos)!;
    assert.ok(sigs.some((s) => s.label.startsWith('StringTokenizer(String')));
    const { code: c2, pos: p2 } = at(
        PRE + 'List<Integer> list = new ArrayList<>();\n list.add(1, |'
    );
    const s2 = javaSignature(index, c2, p2)!;
    const two = s2.find((s) => s.label.startsWith('add(int, Integer)'))!;
    assert.equal(two.label.slice(...two.active!), 'Integer');
});

test('호버', () => {
    const { code, pos } = at(PRE + 'Scanner sc = new Scanner(System.in);\n s|c.nextInt();');
    assert.equal(javaHover(index, code, pos), 'Scanner sc');
});

const USER =
    'import java.util.*;\nimport java.io.*;\npublic class Main {\n' +
    '  static int n, m; static int[] arr; static Map<String, List<Integer>> mp = new HashMap<>();\n' +
    '  static class Node implements Comparable<Node> {\n    int v; long cost;\n' +
    '    Node(int v, long c) { this.v = v; cost = c; }\n' +
    '    public int compareTo(Node o) { return Long.compare(cost, o.cost); }\n    int weight() { return v; }\n  }\n' +
    '  record Point(int x, int y) {}\n  enum Dir { UP, DOWN }\n' +
    '  static Node best(int a, long b) { return null; }\n  static int solve(int a) { return a; }\n' +
    '  public static void main(String[] args) throws IOException {\n' +
    '    PriorityQueue<Node> pq = new PriorityQueue<>();\n    Node node = new Node(1, 2);\n';

test('수식어가 붙은 필드와 쉼표로 이은 선언', () => {
    const v = declarations(USER, 9999);
    assert.equal(v.get('n'), 'int');
    assert.equal(v.get('m'), 'int');
    assert.equal(v.get('arr'), 'int[]');
    assert.equal(v.get('mp'), 'Map<String, List<Integer>>');
    assert.ok(labels(USER + 'arr.|').includes('length'));
    assert.ok(labels(USER + 'mp.get("a").|').includes('add'));
});

test('직접 만든 클래스의 멤버', () => {
    const l = labels(USER + 'node.|');
    assert.ok(l.includes('v') && l.includes('cost') && l.includes('weight'));
    // 컬렉션에서 꺼낸 원소, 직접 만든 메서드의 반환값
    assert.ok(labels(USER + 'pq.poll().|').includes('weight'));
    assert.ok(labels(USER + 'best(1, 2).|').includes('cost'));
    assert.ok(labels(USER + 'for (Node nd : pq) { nd.|').includes('v'));
});

test('record와 enum', () => {
    assert.deepEqual(
        labels(USER + 'Point p = new Point(1, 2); p.|').filter((x) => x === 'x' || x === 'y'),
        ['x', 'y']
    );
    assert.ok(labels(USER + 'Dir.|').includes('UP'));
});

test('직접 만든 메서드: 전역 목록과 시그니처', () => {
    const { code, pos } = at(USER + 'so|');
    const items = javaComplete(index, code, pos, false)!.items;
    const solve = items.find((i) => i.label === 'solve')!;
    assert.equal(solve.kind, 'function');
    assert.equal(solve.apply, 'solve(${})');

    const call = at(USER + 'best(1, |');
    const sigs = javaSignature(index, call.code, call.pos)!;
    assert.equal(sigs[0].label, 'best(int a, long b) → Node');
    assert.equal(sigs[0].label.slice(...sigs[0].active!), 'long b');

    const ctor = at(USER + 'new Node(|');
    assert.equal(javaSignature(index, ctor.code, ctor.pos)![0].label, 'Node(int v, long c)');
});

test('자주 쓰는 클래스가 먼저 온다', () => {
    const { code, pos } = at(USER + 'Str|');
    const items = javaComplete(index, code, pos, false)!.items;
    const boost = (label: string) => items.find((i) => i.label === label)?.boost ?? 0;
    assert.ok(boost('String') > boost('StreamTokenizer'));
});
