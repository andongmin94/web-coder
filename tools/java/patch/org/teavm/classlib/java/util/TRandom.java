/*
 * 웹 코더 패치: TeaVM 0.17.0-dev-7의 원본에서 같은 seed에서 OpenJDK와 같은 수가 나오게 고쳤습니다.
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

import org.teavm.classlib.java.io.TSerializable;
import org.teavm.classlib.java.lang.TObject;
import org.teavm.classlib.java.util.random.TRandomGenerator;

public class TRandom extends TObject implements TRandomGenerator, TSerializable {
    /** A stored gaussian value for nextGaussian() */
    private double storedGaussian;

    /** Whether storedGuassian value is valid */
    private boolean haveStoredGaussian;

    // Could be improved more efficiently for JS backend
    private long seed;

    public TRandom() {
        this((long) (Math.random() * ((1L << 48)) - 1));
    }

    public TRandom(@SuppressWarnings("unused") long seed) {
        setSeed(seed);
    }

    public void setSeed(@SuppressWarnings("unused") long seed) {
        this.seed = (seed ^ 0x5DEECE66DL) & ((1L << 48) - 1);
    }

    @Override
    public int nextInt() {
        return next(32);
    }

    protected int next(int bits) {
        var newSeed = (seed * 0x5DEECE66DL + 0xBL) & ((1L << 48) - 1);
        seed = newSeed;
        return (int) (newSeed >> (48 - bits));
    }

    // ── 웹 코더 패치: 같은 seed면 OpenJDK와 같은 수열 ──
    // next()는 원본도 같고, 범위가 있는 nextInt, nextBoolean, nextBytes, nextGaussian을 OpenJDK 알고리즘으로 합니다.
    // (원본은 RandomGenerator의 기본 구현이라 Collections.shuffle 등의 결과가 달랐음)
    @Override
    public int nextInt(int bound) {
        if (bound <= 0) {
            throw new IllegalArgumentException("bound must be positive");
        }
        int r = next(31);
        int m = bound - 1;
        if ((bound & m) == 0) {
            r = (int) ((bound * (long) r) >> 31);
        } else {
            for (int u = r; u - (r = u % bound) + m < 0; u = next(31)) {
                // 고르게 나오도록 다시 뽑음
            }
        }
        return r;
    }

    @Override
    public boolean nextBoolean() {
        return next(1) != 0;
    }

    @Override
    public void nextBytes(byte[] bytes) {
        for (int i = 0, len = bytes.length; i < len;) {
            for (int rnd = nextInt(), n = Math.min(len - i, 4); n-- > 0; rnd >>= 8) {
                bytes[i++] = (byte) rnd;
            }
        }
    }

    @Override
    public long nextLong() {
        return ((long) nextInt() << 32) + nextInt();
    }

    @Override
    public float nextFloat() {
        return next(24) * 0x1p-24f;
    }

    @Override
    public double nextDouble() {
        return (((long) next(26) << 27) + next(27)) * 0x1p-53;
    }

    /**
     * Generate a random number with Gaussian distribution:
     * centered around 0 with a standard deviation of 1.0.
     */
    @Override
    public double nextGaussian() {
        /*
         * This implementation uses the polar method to generate two gaussian
         * values at a time. One is returned, and the other is stored to be returned
         * next time.
         */
        if (haveStoredGaussian) {
            haveStoredGaussian = false;
            return storedGaussian;
        }

        // OpenJDK와 같은 극좌표 방법
        double v1;
        double v2;
        double s;
        do {
            v1 = 2 * nextDouble() - 1;
            v2 = 2 * nextDouble() - 1;
            s = v1 * v1 + v2 * v2;
        } while (s >= 1 || s == 0);
        double multiplier = StrictMath.sqrt(-2 * StrictMath.log(s) / s);
        haveStoredGaussian = true;
        storedGaussian = v2 * multiplier;
        return v1 * multiplier;
    }
}
