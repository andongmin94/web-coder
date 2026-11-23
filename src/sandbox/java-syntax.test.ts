import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNewerSyntax } from './java-syntax.ts';

const firstLines = (source: string, release: number) =>
    findNewerSyntax(source, release).map((i) => i.message.split('\n')[0]);

test('Java 11에서 안 되는 문법을 javac 문구로 찾는다', () => {
    const source = `import java.util.*;
public class Main {
    record P(int a, int b) {}
    public static void main(String[] args) {
        String tb = """
            hi""";
        Object o = new P(1, 2);
        String s = switch (args.length) { case 0 -> "zero"; default -> "many"; };
        if (o instanceof P p) System.out.println(p.a());
    }
}`;
    assert.deepEqual(firstLines(source, 11), [
        'records are not supported in -source 11',
        'text blocks are not supported in -source 11',
        'switch expressions are not supported in -source 11',
        'switch rules are not supported in -source 11',
        'pattern matching in instanceof is not supported in -source 11',
    ]);
    // Java 15는 text blocks, switch expressions가 되고 records, instanceof 패턴은 16부터
    assert.deepEqual(firstLines(source, 15), [
        'records are not supported in -source 15',
        'pattern matching in instanceof is not supported in -source 15',
    ]);
    const [record] = findNewerSyntax(source, 11);
    assert.equal(source.slice(record.start, record.end), 'record');
    assert.match(record.message, /use -source 16 or higher to enable records/);
});

test('Java 8: var, 여러 case 라벨, try 자원 변수', () => {
    const source = `class Main { public static void main(String[] a) throws Exception {
        var n = 3;
        for (var x : a) {}
        switch (n) { case 1, 2: break; }
        java.io.BufferedReader br = null;
        try (br) {}
    } }`;
    assert.deepEqual(firstLines(source, 8), [
        'cannot find symbol',
        'multiple case labels are not supported in -source 8',
        'variables in try-with-resources are not supported in -source 8',
    ]);
    assert.deepEqual(firstLines(source, 11), [
        'multiple case labels are not supported in -source 11',
    ]);
});

test('옛 문법과 이름이 겹치는 코드는 잡지 않는다', () => {
    const source = `import java.util.*;
// record P(int a) {} 주석은 무시
public class Main {
    static int record(int x) { return x; }
    static int var = 1;
    public static void main(String[] args) {
        String s = "record R(int a) {} \\"\\"\\" case 1 -> x";
        char q = '"';
        int record = record(3), sealed = 2, permits = 3;
        Record r = null;
        switch (record) {
            case 1: System.out.println(args.length > 0 ? "a" : "b"); break;
            case 2: { Runnable f = () -> System.out.println(1); f.run(); break; }
            default: break;
        }
        Object o = s;
        if (o instanceof String && ((String) o).length() > 0) var++;
        List<int[]> l = new ArrayList<>();
        boolean b = o instanceof List<?>;
        Comparator<Integer> c = (x, y) -> x - y;
        label: for (int i = 0; i < 1; i++) { continue label; }
        int t = true ? 1 : 2;
        try (Scanner sc = new Scanner(System.in)) {}
    }
}`;
    assert.deepEqual(findNewerSyntax(source, 8), []);
});

test('Java 21 문법: switch 패턴과 record 패턴', () => {
    const source = `class Main { static String f(Object o) {
        switch (o) { case Integer i: return "i"; case null: return "n"; default: return "d"; }
    }
    static boolean g(Object o) { return o instanceof Point(int x, int y); } }`;
    assert.deepEqual(firstLines(source, 15), [
        'patterns in switch statements are not supported in -source 15',
        'record patterns are not supported in -source 15',
    ]);
});
