/*
 * 웹 코더 패치: TeaVM 0.17.0-dev-7의 원본에서 parseDouble을 정확하게, 실패 메시지를 Java 11과 같게 고쳤습니다.
 * (tools/java/README.md 참고) 원본 저작권과 라이선스는 아래와 같습니다.
 */
/*
 *  Copyright 2013 Alexey Andreev.
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
package org.teavm.classlib.java.lang;

import org.teavm.backend.javascript.spi.InjectedBy;
import org.teavm.classlib.PlatformDetector;
import org.teavm.classlib.impl.text.DoubleSynthesizer;
import org.teavm.interop.Import;
import org.teavm.interop.NoSideEffects;
import org.teavm.interop.Unmanaged;
import org.teavm.jso.JSBody;

@NoSideEffects
public class TDouble extends TNumber implements TComparable<TDouble> {
    static class Constants {
        static final long[] longPowersOfTen = {
            1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000L,
            100000000000L, 1000000000000L, 10000000000000L, 100000000000000L, 1000000000000000L,
            10000000000000000L, 100000000000000000L, 1000000000000000000L
        };
    }

    public static final double POSITIVE_INFINITY = 1 / 0.0;
    public static final double NEGATIVE_INFINITY = -POSITIVE_INFINITY;
    public static final double NaN = 0 / 0.0;
    public static final double MAX_VALUE = 0x1.FFFFFFFFFFFFFP+1023;
    public static final double MIN_NORMAL = 0x1.0P+1022;
    public static final double MIN_VALUE = 0x0.0000000000001P-1022;
    public static final int MAX_EXPONENT = 1023;
    public static final int MIN_EXPONENT = -1022;
    public static final int SIZE = 64;
    public static final int BYTES = SIZE / Byte.SIZE;
    public static final Class<Double> TYPE = double.class;
    public static final int PRECISION = 53;
    private final double value;

    public TDouble(double value) {
        this.value = value;
    }

    public TDouble(String value) throws TNumberFormatException {
        this.value = parseDouble(value);
    }

    @Override
    public double doubleValue() {
        return value;
    }

    @Override
    public int intValue() {
        return (int) value;
    }

    @Override
    public long longValue() {
        return (long) value;
    }

    @Override
    public float floatValue() {
        return (float) value;
    }

    public static TDouble valueOf(double d) {
        return new TDouble(d);
    }

    public static String toString(double d) {
        return new TStringBuilder().append(d).toString();
    }

    public static TDouble valueOf(String string) {
        return valueOf(parseDouble(string));
    }

    // 웹 코더 패치: Java 11과 같은 메시지 (원본은 메시지 없음)
    private static NumberFormatException invalidNumber(String string) {
        String trimmed = string.trim();
        return new NumberFormatException(trimmed.isEmpty() ? "empty String" : "For input string: \"" + trimmed + "\"");
    }

    // 웹 코더 패치: 원본 DoubleSynthesizer는 가끔 1ulp 틀리게 읽습니다. (무작위 3000개 중 45개, 15자리 이하도 있음)
    // 원본으로 형식을 검사한 뒤, 값은 정확히 다시 구합니다.
    //  - 유효 숫자 15자리 이하이고 10의 지수가 ±22 이내: (정확한 정수) × 또는 ÷ (정확한 10의 거듭제곱) 한 번이라 정확히 반올림됨
    //  - 그 밖: BigDecimal로 정확히 (느리지만 드묾)
    private static final double[] EXACT_POW10 = {
        1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11,
        1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22
    };

    public static double parseDouble(String string) throws NumberFormatException {
        double approx = parseDoubleImpl(string);
        if (approx == 0 || Double.isNaN(approx) || Double.isInfinite(approx)) {
            return approx;
        }
        String t = string.trim();
        char last = t.charAt(t.length() - 1);
        if (last == 'd' || last == 'D' || last == 'f' || last == 'F') {
            t = t.substring(0, t.length() - 1);
        }
        boolean negative = false;
        int i = 0;
        if (t.charAt(0) == '-' || t.charAt(0) == '+') {
            negative = t.charAt(0) == '-';
            i = 1;
        }
        long mantissa = 0;
        int significant = 0;
        int fractionDigits = 0;
        boolean afterPoint = false;
        boolean fits = true;
        int end = t.length();
        for (; i < end; i++) {
            char c = t.charAt(i);
            if (c == '.') {
                afterPoint = true;
            } else if (c >= '0' && c <= '9') {
                if (afterPoint) {
                    fractionDigits++;
                }
                if (significant > 0 || c != '0') {
                    if (++significant > 15) {
                        fits = false;
                    } else {
                        mantissa = mantissa * 10 + (c - '0');
                    }
                }
            } else {
                break; // 'e' 또는 'E'
            }
        }
        int exp10 = 0;
        if (i < end) {
            String e = t.substring(i + 1);
            if (e.length() > 9) {
                fits = false;
            } else {
                exp10 = Integer.parseInt(e.startsWith("+") ? e.substring(1) : e);
            }
        }
        if (fits) {
            int scale = exp10 - fractionDigits;
            if (scale >= -22 && scale <= 22) {
                double v = scale >= 0 ? mantissa * EXACT_POW10[scale] : mantissa / EXACT_POW10[-scale];
                return negative ? -v : v;
            }
        }
        return new java.math.BigDecimal(t).doubleValue();
    }

    private static double parseDoubleImpl(String string) throws NumberFormatException {
        // TODO: parse different radix

        if (string.isEmpty()) {
            throw invalidNumber(string);
        }
        int start = 0;
        int end = string.length();
        while (string.charAt(start) <= ' ') {
            if (++start == end) {
                throw invalidNumber(string);
            }
        }
        while (string.charAt(end - 1) <= ' ') {
            --end;
        }
        int endForNamedDouble = end; // InfinityF/f/D/d, NaNF/f/D/d cannot be parsed
        if (string.charAt(end - 1) == 'f' || string.charAt(end - 1) == 'F'
                || string.charAt(end - 1) == 'd' || string.charAt(end - 1) == 'D') {
            --end;
        }

        boolean negative = false;
        int index = start;
        if (string.charAt(index) == '-') {
            ++index;
            negative = true;
        } else if (string.charAt(index) == '+') {
            ++index;
        }
        if (index == end) {
            throw invalidNumber(string);
        }
        char c = string.charAt(index);

        // Up to 19 significant digits are collected. Digits are accumulated in int chunks of 9 digits,
        // which are then added to long mantissa, since long arithmetic is much slower on JS.
        long mantissa = 0;
        int chunk = 0;
        int chunkSize = 0;
        int digitCount = 0;
        int exp = -1;
        boolean hasOneDigit = false;
        if (c != '.') {
            hasOneDigit = true;
            if (c < '0' || c > '9') {
                if (c == 'I') {
                    if (endForNamedDouble - index == 8 && string.regionMatches(false, index, "Infinity", 0, 8)) {
                        return negative ? NEGATIVE_INFINITY : POSITIVE_INFINITY;
                    }
                }
                if (c == 'N') {
                    if (endForNamedDouble - index == 3 && string.regionMatches(false, index, "NaN", 0, 3)) {
                        return NaN;
                    }
                }
                throw invalidNumber(string);
            }
            while (index < end && string.charAt(index) == '0') {
                ++index;
            }
            while (index < end) {
                c = string.charAt(index);
                if (c < '0' || c > '9') {
                    break;
                }
                if (digitCount < 19) {
                    chunk = chunk * 10 + (c - '0');
                    if (++chunkSize == 9) {
                        mantissa = mantissa * 1000000000L + chunk;
                        chunk = 0;
                        chunkSize = 0;
                    }
                    ++digitCount;
                }
                ++exp;
                ++index;
            }
        }
        if (index < end && string.charAt(index) == '.') {
            ++index;
            while (index < end) {
                c = string.charAt(index);
                if (c < '0' || c > '9') {
                    break;
                }
                if (digitCount == 0 && c == '0') {
                    exp--;
                } else if (digitCount < 19) {
                    chunk = chunk * 10 + (c - '0');
                    if (++chunkSize == 9) {
                        mantissa = mantissa * 1000000000L + chunk;
                        chunk = 0;
                        chunkSize = 0;
                    }
                    ++digitCount;
                }
                ++index;
                hasOneDigit = true;
            }
            if (!hasOneDigit) {
                throw invalidNumber(string);
            }
        }
        if (index < end) {
            c = string.charAt(index);
            if (c != 'e' && c != 'E') {
                throw invalidNumber(string);
            }
            ++index;
            boolean negativeExp = false;
            if (index == end) {
                throw invalidNumber(string);
            }
            if (string.charAt(index) == '-') {
                ++index;
                negativeExp = true;
            } else if (string.charAt(index) == '+') {
                ++index;
            }
            int numExp = 0;
            hasOneDigit = false;
            while (index < end) {
                c = string.charAt(index);
                if (c < '0' || c > '9') {
                    break;
                }
                numExp = 10 * numExp + (c - '0');
                hasOneDigit = true;
                ++index;
            }
            if (!hasOneDigit) {
                throw invalidNumber(string);
            }
            if (negativeExp) {
                numExp = -numExp;
            }
            exp += numExp;
        }

        // Add remaining digits and align them, so that the first digit corresponds to 10^18
        if (digitCount > 0) {
            mantissa = mantissa * Constants.longPowersOfTen[chunkSize] + chunk;
            mantissa *= Constants.longPowersOfTen[19 - digitCount];
        }

        return DoubleSynthesizer.synthesizeDouble(mantissa, exp, negative);
    }

    @Override
    public String toString() {
        return toString(value);
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        return other instanceof TDouble && equals(value, ((TDouble) other).value);
    }

    private static boolean equals(double a, double b) {
        return PlatformDetector.isJavaScript() ? doubleEqualsJs(a, b) : equalsWithBits(a, b);
    }

    @InjectedBy(DoubleGenerator.class)
    private static native boolean doubleEqualsJs(double a, double b);

    private static boolean equalsWithBits(double a, double b) {
        return a != a ? b != b : doubleToRawLongBits(a) == doubleToRawLongBits(b);
    }

    @Override
    public int hashCode() {
        return hashCode(value);
    }

    public static int hashCode(double d) {
        long h = doubleToLongBits(d);
        return (int) (h >>> 32) ^ (int) h;
    }

    @NoSideEffects
    public static int compare(double a, double b) {
        var diff = (a > b ? 1 : 0) - (b > a ? 1 : 0);
        return diff != 0 ? diff : (1 / a > 1 / b ? 1 : 0) - (1 / b > 1 / a ? 1 : 0)
                + (b == b ? 1 : 0) - (a == a ? 1 : 0);
    }

    @Override
    public int compareTo(TDouble other) {
        return compare(value, other.value);
    }

    public boolean isNaN() {
        return isNaN(value);
    }

    public boolean isInfinite() {
        return isInfinite(value);
    }

    @JSBody(params = "v", script = "return isNaN(v);")
    @Import(module = "teavm", name = "isnan")
    @NoSideEffects
    @Unmanaged
    public static native boolean isNaN(double v);

    public static boolean isInfinite(double v) {
        return !isFinite(v) && !isNaN(v);
    }

    @JSBody(params = "v", script = "return isFinite(v);")
    @Import(module = "teavm", name = "isfinite")
    @NoSideEffects
    @Unmanaged
    public static native boolean isFinite(double v);

    @InjectedBy(DoubleGenerator.class)
    @Import(name = "teavm_reinterpretDoubleToLong")
    @NoSideEffects
    @Unmanaged
    public static native long doubleToRawLongBits(double value);

    public static long doubleToLongBits(double value) {
        if (isNaN(value)) {
            return 0x7ff8000000000000L;
        }
        return doubleToRawLongBits(value);
    }

    @InjectedBy(DoubleGenerator.class)
    @Import(name = "teavm_reinterpretLongToDouble")
    @NoSideEffects
    @Unmanaged
    public static native double longBitsToDouble(long bits);

    public static String toHexString(double d) {
        if (isNaN(d)) {
            return "NaN";
        } else if (isInfinite(d)) {
            return d > 0 ? "Infinity" : "-Infinity";
        }
        char[] buffer = new char[30];
        int sz = 0;
        long bits = doubleToLongBits(d);
        boolean subNormal = false;
        boolean negative = (bits & (1L << 63)) != 0;
        int exp = (int) ((bits >>> 52) & 0x7FF) - 1023;
        long mantissa = bits & 0xFFFFFFFFFFFFFL;
        if (exp == -1023) {
            if (mantissa == 0) {
                return negative ? "-0x0.0p0" : "0x0.0p0";
            }
            ++exp;
            subNormal = true;
        }
        for (int i = 0; i < 13; ++i) {
            int digit = (int) (mantissa & 0xF);
            if (digit > 0 || sz > 0) {
                buffer[sz++] = TCharacter.forDigit(digit, 16);
            }
            mantissa >>>= 4;
        }
        if (sz == 0) {
            buffer[sz++] = '0';
        }
        buffer[sz++] = '.';

        buffer[sz++] = subNormal ? '0' : '1';
        buffer[sz++] = 'x';
        buffer[sz++] = '0';
        if (negative) {
            buffer[sz++] = '-';
        }
        int half = sz / 2;
        for (int i = 0; i < half; ++i) {
            char tmp = buffer[i];
            buffer[i] = buffer[sz - i - 1];
            buffer[sz - i - 1] = tmp;
        }

        buffer[sz++] = 'p';
        if (exp < 0) {
            exp = -exp;
            buffer[sz++] = '-';
        }
        int pos = 1000;
        boolean first = true;
        for (int i = 0; i < 4; ++i) {
            int digit = exp / pos;
            if (digit > 0 || !first) {
                buffer[sz++] = TCharacter.forDigit(digit, 10);
                first = false;
            }
            exp %= pos;
            pos /= 10;
        }
        if (first) {
            buffer[sz++] = '0';
        }

        return new String(buffer, 0, sz);
    }

    public static double sum(double a, double b) {
        return a + b;
    }

    public static double min(double a, double b) {
        return Math.min(a, b);
    }

    public static double max(double a, double b) {
        return Math.max(a, b);
    }
}
