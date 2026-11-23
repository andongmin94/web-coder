/*
 * 웹 코더 패치: TeaVM 0.17.0-dev-7의 원본에서 HashMap의 순회 순서를 OpenJDK 11과 같게 고쳤습니다.
 * (tools/java/README.md 참고) 원본 저작권과 라이선스는 아래와 같습니다.
 */
/*
 *  Copyright 2014 Alexey Andreev.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
package org.teavm.classlib.java.util;

import java.util.Arrays;
import java.util.function.BiConsumer;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import org.teavm.classlib.java.io.TSerializable;
import org.teavm.classlib.java.lang.TCloneNotSupportedException;
import org.teavm.classlib.java.lang.TCloneable;
import org.teavm.classlib.java.lang.TIllegalArgumentException;
import org.teavm.classlib.java.lang.TIllegalStateException;
import org.teavm.classlib.java.lang.TObject;
import org.teavm.interop.Rename;

public class THashMap<K, V> extends TAbstractMap<K, V> implements TCloneable, TSerializable {
    transient int elementCount;
    transient HashEntry<K, V>[] elementData;
    transient int modCount;
    private static final int DEFAULT_SIZE = 16;
    private static final float DEFAULT_LOAD_FACTOR = 0.75f;
    final float loadFactor;
    int threshold;

    // ── 웹 코더 패치: 순회 순서를 OpenJDK 11의 HashMap과 같게 ──
    // 해시를 섞는 방법(h ^ h >>> 16), 칸 안에서 뒤에 붙이기, 크기를 늘릴 때 순서 유지,
    // putAll/복사 생성자의 처음 크기, 한 칸이 8개를 넘을 때(표가 64 미만) 크기 늘리기를 OpenJDK처럼 합니다.
    // (TreeNode로 바뀐 칸의 순서는 흉내 내지 않습니다.)

    /** 키 해시 → 칸 번호 (OpenJDK의 HashMap.hash()와 같은 섞기) */
    static int slot(int hash, int length) {
        return (hash ^ (hash >>> 16)) & (length - 1);
    }

    /** OpenJDK의 tableSizeFor */
    static int tableSizeFor(int cap) {
        int n = -1 >>> Integer.numberOfLeadingZeros(cap - 1);
        return n < 0 ? 1 : n >= 1 << 30 ? 1 << 30 : n + 1;
    }

    /** OpenJDK에서 표가 아직 만들어지지 않은 상태(아무것도 넣지 않음)인지 */
    transient boolean fresh = true;
    /** 그때의 OpenJDK threshold (기본 생성자는 0, 용량을 준 생성자는 tableSizeFor(용량)) */
    transient int lazyThreshold;

    static class HashEntry<K, V> extends TMapEntry<K, V> {
        final int origKeyHash;

        HashEntry<K, V> next;

        HashEntry(K theKey, int hash) {
            super(theKey, null);
            this.origKeyHash = hash;
        }

        HashEntry(K theKey, V theValue) {
            super(theKey, theValue);
            origKeyHash = TObjects.hashCode(theKey);
        }

        @Override
        @SuppressWarnings("unchecked")
        public Object clone() {
            HashEntry<K, V> entry = (HashEntry<K, V>) super.clone();
            if (next != null) {
                entry.next = (HashEntry<K, V>) next.clone();
            }
            return entry;
        }
    }

    private static class AbstractMapIterator<K, V>  {
        private int position;
        int expectedModCount;
        HashEntry<K, V> futureEntry;
        HashEntry<K, V> currentEntry;
        HashEntry<K, V> prevEntry;

        final THashMap<K, V> associatedMap;

        AbstractMapIterator(THashMap<K, V> hm) {
            associatedMap = hm;
            expectedModCount = hm.modCount;
            futureEntry = null;
        }

        public boolean hasNext() {
            if (futureEntry != null) {
                return true;
            }
            while (position < associatedMap.elementData.length) {
                if (associatedMap.elementData[position] == null) {
                    position++;
                } else {
                    return true;
                }
            }
            return false;
        }

        final void checkConcurrentMod() throws TConcurrentModificationException {
            if (expectedModCount != associatedMap.modCount) {
                throw new TConcurrentModificationException();
            }
        }

        final void makeNext() {
            checkConcurrentMod();
            if (!hasNext()) {
                throw new TNoSuchElementException();
            }
            if (futureEntry == null) {
                currentEntry = associatedMap.elementData[position++];
                futureEntry = currentEntry.next;
                prevEntry = null;
            } else {
                if (currentEntry != null) {
                    prevEntry = currentEntry;
                }
                currentEntry = futureEntry;
                futureEntry = futureEntry.next;
            }
        }

        public final void remove() {
            checkConcurrentMod();
            if (currentEntry == null) {
                throw new TIllegalStateException();
            }
            if (prevEntry == null) {
                int index = slot(currentEntry.origKeyHash, associatedMap.elementData.length);
                associatedMap.elementData[index] = associatedMap.elementData[index].next;
            } else {
                prevEntry.next = currentEntry.next;
            }
            currentEntry = null;
            expectedModCount++;
            associatedMap.modCount++;
            associatedMap.elementCount--;

        }
    }


    private static class EntryIterator<K, V> extends AbstractMapIterator<K, V>
            implements TIterator<TMap.Entry<K, V>> {
        EntryIterator(THashMap<K, V> map) {
            super(map);
        }

        @Override
        public TMap.Entry<K, V> next() {
            makeNext();
            return currentEntry;
        }
    }

    private static class KeyIterator<K, V> extends AbstractMapIterator<K, V> implements TIterator<K> {
        KeyIterator(THashMap<K, V> map) {
            super(map);
        }

        @Override
        public K next() {
            makeNext();
            return currentEntry.key;
        }
    }

    private static class ValueIterator<K, V> extends AbstractMapIterator<K, V> implements TIterator<V> {
        ValueIterator(THashMap<K, V> map) {
            super(map);
        }

        @Override
        public V next() {
            makeNext();
            return currentEntry.value;
        }
    }

    static class HashMapEntrySet<K, V> extends TAbstractSet<TMap.Entry<K, V>> {
        private final THashMap<K, V> associatedMap;

        public HashMapEntrySet(THashMap<K, V> hm) {
            associatedMap = hm;
        }

        THashMap<K, V> hashMap() {
            return associatedMap;
        }

        @Override
        public int size() {
            return associatedMap.elementCount;
        }

        @Override
        public void clear() {
            associatedMap.clear();
        }

        @Override
        public boolean remove(Object object) {
            if (object instanceof TMap.Entry) {
                var oEntry = (TMap.Entry<?, ?>) object;
                var entry = associatedMap.entryByKey(oEntry.getKey());
                if (entry != null && TObjects.equals(entry.getValue(), oEntry.getValue())) {
                    associatedMap.removeEntry(entry);
                    return true;
                }
            }
            return false;
        }

        @Override
        public boolean contains(Object object) {
            if (object instanceof TMap.Entry) {
                TMap.Entry<?, ?> oEntry = (TMap.Entry<?, ?>) object;
                TMap.Entry<K, V> entry = associatedMap.entryByKey(oEntry.getKey());
                return entry != null && TObjects.equals(entry.getValue(), oEntry.getValue());
            }
            return false;
        }

        @Override
        public TIterator<TMap.Entry<K, V>> iterator() {
            return new EntryIterator<>(associatedMap);
        }

        @Override
        public void forEach(Consumer<? super Entry<K, V>> action) {
            if (associatedMap.elementCount > 0) {
                int prevModCount = associatedMap.modCount;
                for (int i = 0; i < associatedMap.elementData.length; i++) {
                    HashEntry<K, V> entry = associatedMap.elementData[i];
                    while (entry != null) {
                        action.accept(entry);
                        entry = entry.next;
                        if (prevModCount != associatedMap.modCount) {
                            throw new TConcurrentModificationException();
                        }
                    }
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    HashEntry<K, V>[] newElementArray(int s) {
        return new HashEntry[s];
    }

    public THashMap() {
        this(DEFAULT_SIZE);
        lazyThreshold = 0;
    }

    public THashMap(int capacity) {
        this(capacity, DEFAULT_LOAD_FACTOR);
    }

    private static int calculateCapacity(int x) {
        if (x >= 1 << 30) {
            return 1 << 30;
        }
        if (x == 0) {
            return 16;
        }
        x = x - 1;
        x |= x >> 1;
        x |= x >> 2;
        x |= x >> 4;
        x |= x >> 8;
        x |= x >> 16;
        return x + 1;
    }

    /**
     * Constructs a new {@code HashMap} instance with the specified capacity and
     * load factor.
     *
     * @param capacity
     *            the initial capacity of this hash map.
     * @param loadFactor
     *            the initial load factor.
     * @throws IllegalArgumentException
     *                when the capacity is less than zero or the load factor is
     *                less or equal to zero.
     */
    public THashMap(int capacity, float loadFactor) {
        if (capacity >= 0 && loadFactor > 0) {
            capacity = tableSizeFor(capacity);
            lazyThreshold = capacity;
            elementCount = 0;
            elementData = newElementArray(capacity);
            this.loadFactor = loadFactor;
            computeThreshold();
        } else {
            throw new TIllegalArgumentException();
        }
    }

    public THashMap(TMap<? extends K, ? extends V> map) {
        this();
        putAllImpl(map);
    }

    @Override
    public void clear() {
        if (elementCount > 0) {
            elementCount = 0;
            Arrays.fill(elementData, null);
            modCount++;
        }
    }

    @Rename("clone")
    @SuppressWarnings("unchecked")
    public TObject clone0() {
        try {
            THashMap<K, V> map = (THashMap<K, V>) super.clone();
            map.elementCount = 0;
            map.elementData = newElementArray(DEFAULT_SIZE);
            map.computeThreshold();
            map.fresh = true;
            map.lazyThreshold = 0;
            map.putAll(this);

            return map;
        } catch (TCloneNotSupportedException e) {
            return null;
        }
    }

    private void computeThreshold() {
        threshold = (int) (elementData.length * loadFactor);
    }

    @Override
    public boolean containsKey(Object key) {
        HashEntry<K, V> m = entryByKey(key);
        return m != null;
    }

    @Override
    public boolean containsValue(Object value) {
        if (value != null) {
            for (int i = 0; i < elementData.length; i++) {
                HashEntry<K, V> entry = elementData[i];
                while (entry != null) {
                    if (value.equals(entry.value)) {
                        return true;
                    }
                    entry = entry.next;
                }
            }
        } else {
            for (int i = 0; i < elementData.length; i++) {
                HashEntry<K, V> entry = elementData[i];
                while (entry != null) {
                    if (entry.value == null) {
                        return true;
                    }
                    entry = entry.next;
                }
            }
        }
        return false;
    }

    @Override
    public TSet<TMap.Entry<K, V>> entrySet() {
        return new HashMapEntrySet<>(this);
    }

    @Override
    public V get(Object key) {
        HashEntry<K, V> m = entryByKey(key);
        if (m != null) {
            return m.value;
        }
        return null;
    }

    final HashEntry<K, V> entryByKey(Object key) {
        HashEntry<K, V> m;
        if (key == null) {
            m = findNullKeyEntry();
        } else {
            int hash = key.hashCode();
            int index = slot(hash, elementData.length);
            m = findNonNullKeyEntry(key, index, hash);
        }
        return m;
    }

    final HashEntry<K, V> findNonNullKeyEntry(Object key, int index, int keyHash) {
        HashEntry<K, V> m = elementData[index];
        while (m != null && (m.origKeyHash != keyHash || !areEqualKeys(key, m.key))) {
            m = m.next;
        }
        return m;
    }

    final HashEntry<K, V> findNullKeyEntry() {
        HashEntry<K, V> m = elementData[0];
        while (m != null && m.key != null) {
            m = m.next;
        }
        return m;
    }

    @Override
    public boolean isEmpty() {
        return elementCount == 0;
    }

    @Override
    public TSet<K> keySet() {
        if (cachedKeySet == null) {
            cachedKeySet = new TAbstractSet<K>() {
                @Override public boolean contains(Object object) {
                    return containsKey(object);
                }
                @Override public int size() {
                    return THashMap.this.size();
                }
                @Override public void clear() {
                    THashMap.this.clear();
                }
                @Override public boolean remove(Object key) {
                    HashEntry<K, V> entry = THashMap.this.removeByKey(key);
                    return entry != null;
                }
                @Override public TIterator<K> iterator() {
                    return new KeyIterator<>(THashMap.this);
                }
                @Override public void forEach(Consumer<? super K> action) {
                    if (elementCount > 0) {
                        int prevModCount = modCount;
                        for (int i = 0; i < elementData.length; i++) {
                            HashEntry<K, V> entry = elementData[i];
                            while (entry != null) {
                                action.accept(entry.key);
                                entry = entry.next;
                                if (prevModCount != modCount) {
                                    throw new TConcurrentModificationException();
                                }
                            }
                        }
                    }
                }
            };
        }
        return cachedKeySet;
    }

    @Override
    public V put(K key, V value) {
        return putImpl(key, value);
    }

    private V putImpl(K key, V value) {
        HashEntry<K, V> entry;
        if (key == null) {
            entry = findNullKeyEntry();
            if (entry == null) {
                modCount++;
                entry = createHashedEntry(null, 0, 0);
                afterInsert();
            }
        } else {
            int hash = key.hashCode();
            int index = slot(hash, elementData.length);
            entry = findNonNullKeyEntry(key, index, hash);
            if (entry == null) {
                modCount++;
                entry = createHashedEntry(key, index, hash);
                afterInsert();
            }
        }

        V result = entry.value;
        entry.value = value;
        return result;
    }

    /** 방금 넣은 칸에 원래 있던 항목 수 */
    private transient int binCountBeforeInsert;

    private HashEntry<K, V> createHashedEntry(K key, int index, int hash) {
        HashEntry<K, V> entry = new HashEntry<>(key, hash);
        fresh = false;
        // OpenJDK처럼 칸의 맨 뒤에 붙입니다. (TeaVM 원본은 맨 앞)
        HashEntry<K, V> last = elementData[index];
        int count = 0;
        if (last == null) {
            elementData[index] = entry;
        } else {
            count = 1;
            while (last.next != null) {
                last = last.next;
                count++;
            }
            last.next = entry;
        }
        binCountBeforeInsert = count;
        return entry;
    }

    private void afterInsert() {
        // OpenJDK의 treeifyBin: 칸에 8개가 넘게 쌓였는데 표가 64보다 작으면 트리 대신 표를 키움
        if (binCountBeforeInsert >= 8 && elementData.length < 64) {
            rehash();
        }
        if (++elementCount > threshold) {
            rehash();
        }
    }

    @Override
    public void putAll(TMap<? extends K, ? extends V> map) {
        if (!map.isEmpty()) {
            putAllImpl(map);
        }
    }

    void putAllImpl(TMap<? extends K, ? extends V> map) {
        // OpenJDK 11의 putMapEntries
        int s = map.size();
        if (fresh) {
            int t = (int) ((float) s / loadFactor + 1.0F);
            int capacity = t > lazyThreshold ? tableSizeFor(t) : lazyThreshold > 0 ? lazyThreshold : DEFAULT_SIZE;
            if (capacity != elementData.length) {
                elementData = newElementArray(capacity);
                computeThreshold();
            }
        } else if (s > threshold) {
            rehash();
        }
        for (var it = map.entrySet().iterator(); it.hasNext();) {
            TMap.Entry<? extends K, ? extends V> entry = it.next();
            putImpl(entry.getKey(), entry.getValue());
        }
    }

    void rehash(int capacity) {
        int length = calculateCapacity(capacity == 0 ? 1 : capacity << 1);

        HashEntry<K, V>[] newData = newElementArray(length);
        // OpenJDK처럼 칸 안의 순서를 유지하며 옮깁니다. (TeaVM 원본은 뒤집힘)
        HashEntry<K, V>[] tails = newElementArray(length);
        for (int i = 0; i < elementData.length; i++) {
            HashEntry<K, V> entry = elementData[i];
            elementData[i] = null;
            while (entry != null) {
                int index = slot(entry.origKeyHash, length);
                HashEntry<K, V> next = entry.next;
                entry.next = null;
                if (tails[index] == null) {
                    newData[index] = entry;
                } else {
                    tails[index].next = entry;
                }
                tails[index] = entry;
                entry = next;
            }
        }
        fresh = false;
        elementData = newData;
        computeThreshold();
    }

    void rehash() {
        rehash(elementData.length);
    }

    @Override
    public V remove(Object key) {
        HashEntry<K, V> entry = removeByKey(key);
        if (entry != null) {
            return entry.value;
        }
        return null;
    }

    final void removeEntry(HashEntry<K, V> entry) {
        int index = slot(entry.origKeyHash, elementData.length);
        var m = elementData[index];
        if (m == entry) {
            elementData[index] = entry.next;
        } else {
            while (m.next != entry) {
                m = m.next;
            }
            m.next = entry.next;
        }
        modCount++;
        elementCount--;
    }

    final HashEntry<K, V> removeByKey(Object key) {
        int index = 0;
        HashEntry<K, V> entry;
        HashEntry<K, V> last = null;
        if (key != null) {
            int hash = key.hashCode();
            index = slot(hash, elementData.length);
            entry = elementData[index];
            while (entry != null && !(entry.origKeyHash == hash && areEqualKeys(key, entry.key))) {
                last = entry;
                entry = entry.next;
            }
        } else {
            entry = elementData[0];
            while (entry != null && entry.key != null) {
                last = entry;
                entry = entry.next;
            }
        }
        if (entry == null) {
            return null;
        }
        if (last == null) {
            elementData[index] = entry.next;
        } else {
            last.next = entry.next;
        }
        modCount++;
        elementCount--;
        return entry;
    }

    @Override
    public int size() {
        return elementCount;
    }

    @Override
    public TCollection<V> values() {
        if (cachedValues == null) {
            cachedValues = new TAbstractCollection<V>() {
                @Override public boolean contains(Object object) {
                    return containsValue(object);
                }
                @Override public int size() {
                    return THashMap.this.size();
                }
                @Override public void clear() {
                    THashMap.this.clear();
                }
                @Override public TIterator<V> iterator() {
                    return new ValueIterator<>(THashMap.this);
                }
                @Override public void forEach(Consumer<? super V> action) {
                    if (elementCount > 0) {
                        int prevModCount = modCount;
                        for (int i = 0; i < elementData.length; i++) {
                            HashEntry<K, V> entry = elementData[i];
                            while (entry != null) {
                                action.accept(entry.value);
                                entry = entry.next;
                                if (prevModCount != modCount) {
                                    throw new TConcurrentModificationException();
                                }
                            }
                        }
                    }
                }
            };
        }
        return cachedValues;
    }

    @Override
    public void forEach(BiConsumer<? super K, ? super V> action) {
        if (elementCount > 0) {
            int prevModCount = modCount;
            for (int i = 0; i < elementData.length; i++) {
                HashEntry<K, V> entry = elementData[i];
                while (entry != null) {
                    action.accept(entry.key, entry.value);
                    entry = entry.next;
                    if (prevModCount != modCount) {
                        throw new TConcurrentModificationException();
                    }
                }
            }
        }
    }

    @Override
    public void replaceAll(BiFunction<? super K, ? super V, ? extends V> function) {
        if (elementCount > 0) {
            int prevModCount = modCount;
            for (int i = 0; i < elementData.length; i++) {
                HashEntry<K, V> entry = elementData[i];
                while (entry != null) {
                    entry.value = function.apply(entry.key, entry.value);
                    entry = entry.next;
                    if (prevModCount != modCount) {
                        throw new TConcurrentModificationException();
                    }
                }
            }
        }
    }

    static boolean areEqualKeys(Object key1, Object key2) {
        return (key1 == key2) || key1.equals(key2);
    }

    static int capacity(int size) {
        return (int) Math.ceil(size / DEFAULT_LOAD_FACTOR);
    }

    public static <K, V> THashMap<K, V> newHashMap(int size) {
        if (size < 0) {
            throw new IllegalArgumentException();
        }
        return new THashMap<>(capacity(size));
    }

    // ── 웹 코더 패치: OpenJDK 11 HashMap의 computeIfAbsent, compute, merge ──
    // OpenJDK는 이 셋을 따로 구현해, 넣기 전에 크기를 확인하고 새 키를 칸의 맨 앞에 넣습니다. (put은 맨 뒤)
    // 순회 순서가 같아지도록 그대로 따릅니다. LinkedHashMap은 자기 순서가 있으므로 원래 방법(Map 기본 구현)을 씁니다.

    /** OpenJDK: size > threshold이면 넣기 전에 크기를 늘림 */
    private void resizeBeforeCompute() {
        if (!fresh && elementCount > threshold) {
            rehash();
        }
        fresh = false;
    }

    private transient int computeBinCount;

    /** 칸에서 키를 찾습니다. 못 찾으면 null이고, computeBinCount에 칸의 항목 수가 남습니다. */
    private HashEntry<K, V> findForCompute(Object key, int hash, int index) {
        int count = 0;
        for (HashEntry<K, V> e = elementData[index]; e != null; e = e.next) {
            if (key == null ? e.key == null : e.origKeyHash == hash && areEqualKeys(key, e.key)) {
                computeBinCount = count;
                return e;
            }
            count++;
        }
        computeBinCount = count;
        return null;
    }

    private void insertFirst(K key, int hash, int index, V value, int binCount) {
        HashEntry<K, V> entry = new HashEntry<>(key, hash);
        entry.value = value;
        entry.next = elementData[index];
        elementData[index] = entry;
        // OpenJDK의 treeifyBin(칸에 7개 이상 있었음): 표가 64보다 작으면 크기를 늘림
        if (binCount >= 7 && elementData.length < 64) {
            rehash();
        }
        modCount++;
        elementCount++;
    }

    @Override
    public V computeIfAbsent(K key, java.util.function.Function<? super K, ? extends V> mappingFunction) {
        if (this instanceof TLinkedHashMap) {
            return super.computeIfAbsent(key, mappingFunction);
        }
        TObjects.requireNonNull(mappingFunction);
        resizeBeforeCompute();
        int hash = key == null ? 0 : key.hashCode();
        int index = slot(hash, elementData.length);
        HashEntry<K, V> old = findForCompute(key, hash, index);
        int binCount = computeBinCount;
        if (old != null && old.value != null) {
            return old.value;
        }
        int mc = modCount;
        V v = mappingFunction.apply(key);
        if (mc != modCount) {
            throw new TConcurrentModificationException();
        }
        if (v == null) {
            return null;
        }
        if (old != null) {
            old.value = v;
            return v;
        }
        insertFirst(key, hash, index, v, binCount);
        return v;
    }

    @Override
    public V compute(K key, java.util.function.BiFunction<? super K, ? super V, ? extends V> remappingFunction) {
        if (this instanceof TLinkedHashMap) {
            return super.compute(key, remappingFunction);
        }
        TObjects.requireNonNull(remappingFunction);
        resizeBeforeCompute();
        int hash = key == null ? 0 : key.hashCode();
        int index = slot(hash, elementData.length);
        HashEntry<K, V> old = findForCompute(key, hash, index);
        int binCount = computeBinCount;
        V oldValue = old == null ? null : old.value;
        int mc = modCount;
        V v = remappingFunction.apply(key, oldValue);
        if (mc != modCount) {
            throw new TConcurrentModificationException();
        }
        if (old != null) {
            if (v != null) {
                old.value = v;
            } else {
                removeEntry(old);
            }
        } else if (v != null) {
            insertFirst(key, hash, index, v, binCount);
        }
        return v;
    }

    @Override
    public V merge(K key, V value, java.util.function.BiFunction<? super V, ? super V, ? extends V> remappingFunction) {
        if (this instanceof TLinkedHashMap) {
            return super.merge(key, value, remappingFunction);
        }
        if (value == null || remappingFunction == null) {
            throw new NullPointerException();
        }
        resizeBeforeCompute();
        int hash = key == null ? 0 : key.hashCode();
        int index = slot(hash, elementData.length);
        HashEntry<K, V> old = findForCompute(key, hash, index);
        int binCount = computeBinCount;
        if (old != null) {
            V v;
            if (old.value != null) {
                int mc = modCount;
                v = remappingFunction.apply(old.value, value);
                if (mc != modCount) {
                    throw new TConcurrentModificationException();
                }
            } else {
                v = value;
            }
            if (v != null) {
                old.value = v;
            } else {
                removeEntry(old);
            }
            return v;
        }
        insertFirst(key, hash, index, value, binCount);
        return value;
    }
}
