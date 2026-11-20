import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readArchive } from '../../tools/java/classlib-archive.mjs';
import { buildJavaIndex, parseClassSignature, parseMethodSignature } from './classfile.ts';

test('제네릭 시그니처 해석', () => {
    assert.deepEqual(parseMethodSignature('(ILjava/lang/Object;)Z'), {
        tp: [],
        params: ['int', 'java.lang.Object'],
        ret: 'boolean',
    });
    assert.deepEqual(parseMethodSignature('<T:Ljava/lang/Object;>([TT;)Ljava/util/List<TT;>;'), {
        tp: ['T'],
        params: ['T[]'],
        ret: 'java.util.List<T>',
    });
    assert.deepEqual(
        parseClassSignature(
            '<E:Ljava/lang/Object;>Ljava/util/AbstractList<TE;>;Ljava/util/List<TE;>;Ljava/util/RandomAccess;'
        ),
        {
            tp: ['E'],
            sup: 'java.util.AbstractList<E>',
            itf: ['java.util.List<E>', 'java.util.RandomAccess'],
        }
    );
    assert.equal(
        parseMethodSignature('(Ljava/util/Comparator<-TE;>;)V').params[0],
        'java.util.Comparator<? super E>'
    );
});

test('SDK에서 색인 만들기 (Scanner 패치 포함)', () => {
    const { entries } = readArchive(readFileSync('public/java/compile-classlib.bin'));
    const index = buildJavaIndex(entries);
    const list = index.classes['java.util.ArrayList'];
    assert.ok(list, 'ArrayList');
    assert.deepEqual(list.tp, ['E']);
    assert.ok(list.m.some((m) => m.n === 'get' && m.t === 'E'));
    const scanner = index.classes['java.util.Scanner'];
    assert.ok(scanner.m.some((m) => m.n === 'nextInt'));
    const system = index.classes['java.lang.System'];
    assert.equal(system.f.find((f) => f.n === 'out')?.t, 'java.io.PrintStream');
    const map = index.classes['java.util.Map'];
    assert.ok(map.iface);
    assert.ok(index.classes['java.util.Map.Entry'], 'nested Map.Entry');
});
