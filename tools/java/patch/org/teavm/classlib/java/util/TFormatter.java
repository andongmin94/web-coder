/*
 * 웹 코더 패치: TeaVM 0.17.0-dev-7의 TFormatter에서 실수 형식(%f, %e, %g)만 OpenJDK와 같게 고쳤습니다.
 * (tools/java/README.md 참고) 원본 저작권과 라이선스는 아래와 같습니다.
 */
/*
 *  Copyright 2017 Alexey Andreev.
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

import java.io.Closeable;
import java.io.Flushable;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.NumberFormat;
import java.util.DuplicateFormatFlagsException;
import java.util.FormatFlagsConversionMismatchException;
import java.util.IllegalFormatConversionException;
import java.util.Locale;
import java.util.UnknownFormatConversionException;
import org.teavm.classlib.impl.IntegerUtil;
import org.teavm.classlib.java.text.TDecimalFormat;

public final class TFormatter implements Closeable, Flushable {
    private Locale locale;
    private Appendable out;
    private IOException ioException;

    public TFormatter() {
        this(Locale.getDefault());
    }

    public TFormatter(Appendable a) {
        this(a, Locale.getDefault());
    }

    public TFormatter(Locale l) {
        this(new StringBuilder(), l);
    }

    public TFormatter(Appendable a, Locale l) {
        out = a;
        locale = l;
    }

    public TFormatter(PrintStream ps) {
        this(new OutputStreamWriter(ps));
    }

    public TFormatter(OutputStream os) {
        this(new OutputStreamWriter(os));
    }

    public TFormatter(OutputStream os, String csn) throws UnsupportedEncodingException {
        this(new OutputStreamWriter(os, csn));
    }

    public TFormatter(OutputStream os, String csn, Locale l) throws UnsupportedEncodingException {
        this(new OutputStreamWriter(os, csn), l);
    }

    public Locale locale() {
        requireOpen();
        return locale;
    }

    public Appendable out() {
        requireOpen();
        return out;
    }

    private void requireOpen() {
        if (out == null) {
            throw new TFormatterClosedException();
        }
    }

    @Override
    public String toString() {
        requireOpen();
        return out.toString();
    }

    @Override
    public void flush() {
        requireOpen();
        if (out instanceof Flushable) {
            try {
                ((Flushable) out).flush();
            } catch (IOException e) {
                ioException = e;
            }
        }
    }

    @Override
    public void close() {
        requireOpen();
        try {
            if (out instanceof Closeable) {
                ((Closeable) out).close();
            }
        } catch (IOException e) {
            ioException = e;
        } finally {
            out = null;
        }
    }

    public IOException ioException() {
        return ioException;
    }

    public TFormatter format(String format, Object... args) {
        return format(locale, format, args);
    }

    public TFormatter format(Locale l, String format, Object... args) {
        requireOpen();
        try {
            if (args == null) {
                args = new Object[1];
            }
            new FormatWriter(this, out, l, format, args).write();
        } catch (IOException e) {
            ioException = e;
        }
        return this;
    }

    static class FormatWriter {
        private static final String FORMAT_FLAGS = "--#+ 0,(<";
        private static final int MASK_FOR_GENERAL_FORMAT =
                TFormattableFlags.LEFT_JUSTIFY | TFormattableFlags.ALTERNATE
                        | TFormattableFlags.UPPERCASE | TFormattableFlags.PREVIOUS_ARGUMENT;
        private static final int MASK_FOR_CHAR_FORMAT =
                TFormattableFlags.LEFT_JUSTIFY | TFormattableFlags.UPPERCASE | TFormattableFlags.PREVIOUS_ARGUMENT;
        private static final int MASK_FOR_INT_DECIMAL_FORMAT = MASK_FOR_GENERAL_FORMAT ^ TFormattableFlags.ALTERNATE
                | TFormattableFlags.LEADING_SPACE | TFormattableFlags.ZERO_PADDED
                | TFormattableFlags.PARENTHESIZED_NEGATIVE | TFormattableFlags.SIGNED
                | TFormattableFlags.GROUPING_SEPARATOR;
        private static final int MASK_FOR_INT_RADIX_FORMAT = MASK_FOR_GENERAL_FORMAT
                | TFormattableFlags.ZERO_PADDED | TFormattableFlags.PARENTHESIZED_NEGATIVE;
        private TFormatter formatter;
        Appendable out;
        Locale locale;
        String format;
        Object[] args;
        int index;
        int formatSpecifierStart;
        int defaultArgumentIndex;
        int argumentIndex;
        int previousArgumentIndex;
        int width;
        int precision;
        int flags;

        FormatWriter(TFormatter formatter, Appendable out, Locale locale, String format, Object[] args) {
            this.formatter = formatter;
            this.out = out;
            this.locale = locale;
            this.format = format;
            this.args = args;
        }

        void write() throws IOException {
            while (true) {
                int next = format.indexOf('%', index);
                if (next < 0) {
                    out.append(format.substring(index));
                    break;
                }
                out.append(format.substring(index, next));
                index = next + 1;

                formatSpecifierStart = index;
                char specifier = parseFormatSpecifier();
                // %n and %% do not correspond to any argument
                if (specifier == 'n') {
                    formatLineSeparator();
                    continue;
                }
                if (specifier == '%') {
                    formatPercent();
                    continue;
                }
                configureFormat();
                formatValue(specifier);
            }
        }

        private void formatValue(char specifier) throws IOException {
            switch (specifier) {
                case 'b':
                    formatBoolean(specifier, false);
                    break;
                case 'B':
                    formatBoolean(specifier, true);
                    break;
                case 'h':
                    formatHex(specifier, false);
                    break;
                case 'H':
                    formatHex(specifier, true);
                    break;
                case 's':
                    formatString(specifier, false);
                    break;
                case 'S':
                    formatString(specifier, true);
                    break;

                case 'c':
                    formatChar(specifier, false);
                    break;
                case 'C':
                    formatChar(specifier, true);
                    break;

                case 'd':
                    formatDecimalInt(specifier, false);
                    break;
                case 'D':
                    formatDecimalInt(specifier, true);
                    break;

                case 'o':
                    formatRadixInt(specifier, 3, false);
                    break;
                case 'O':
                    formatRadixInt(specifier, 3, true);
                    break;

                case 'x':
                    formatRadixInt(specifier, 4, false);
                    break;
                case 'X':
                    formatRadixInt(specifier, 4, true);
                    break;

                case 'f':
                    formatFloat(specifier, false);
                    break;
                // 웹 코더 패치: %e, %g (TeaVM 원본에는 없음)
                case 'e':
                case 'g':
                    formatFloat(specifier, false);
                    break;
                case 'E':
                case 'G':
                    formatFloat(specifier, true);
                    break;

                default:
                    throw new UnknownFormatConversionException(String.valueOf(specifier));
            }
        }

        private void formatLineSeparator() throws IOException {
            if (flags != 0) {
                throw new TIllegalFormatFlagsException(allFlagsToString());
            }
            if (width != -1) {
                throw new TIllegalFormatWidthException(width);
            }
            if (precision != -1) {
                throw new TIllegalFormatPrecisionException(precision);
            }
            out.append(System.lineSeparator());
        }

        private void formatPercent() throws IOException {
            if ((flags & ~TFormattableFlags.LEFT_JUSTIFY) != 0) {
                throw new TIllegalFormatFlagsException(allFlagsToString());
            }
            if (precision != -1) {
                throw new TIllegalFormatPrecisionException(precision);
            }
            if ((flags & TFormattableFlags.LEFT_JUSTIFY) != 0 && width == -1) {
                throw new TMissingFormatWidthException("%-%");
            }
            formatGivenString(false, "%");
        }

        private String allFlagsToString() {
            StringBuilder result = new StringBuilder();
            for (int i = 0; i < FORMAT_FLAGS.length(); ++i) {
                if ((flags & (1 << i)) != 0) {
                    result.append(FORMAT_FLAGS.charAt(i));
                }
            }
            return result.toString();
        }

        // ── 웹 코더 패치: 실수 형식을 OpenJDK와 같게 ──
        // OpenJDK의 %f, %e, %g는 Double.toString과 같은 가장 짧은 10진 표기를 HALF_UP으로 반올림합니다.
        // TeaVM 원본은 DecimalFormat(HALF_EVEN)을 써서 String.format("%.2f", 1.005)가 "1.00"(OpenJDK는 "1.01")이고,
        // %e, %g는 지원하지 않습니다. float은 OpenJDK처럼 double로 바꿔 다룹니다.
        private void formatFloat(char specifier, boolean upperCase) throws IOException {
            verifyFlags(specifier, MASK_FOR_INT_DECIMAL_FORMAT);
            verifyFloatFlags();

            Object arg = args[argumentIndex];
            boolean negative;
            BigDecimal value;
            if (arg instanceof Double || arg instanceof Float) {
                double d = ((Number) arg).doubleValue();
                if (Double.isNaN(d) || Double.isInfinite(d)) {
                    String str;
                    if (Double.isNaN(d)) {
                        str = "NaN";
                    } else if (d < 0) {
                        str = (flags & TFormattableFlags.PARENTHESIZED_NEGATIVE) != 0 ? "(Infinity)" : "-Infinity";
                    } else if ((flags & TFormattableFlags.SIGNED) != 0) {
                        str = "+Infinity";
                    } else if ((flags & TFormattableFlags.LEADING_SPACE) != 0) {
                        str = " Infinity";
                    } else {
                        str = "Infinity";
                    }
                    precision = -1;
                    formatGivenString(upperCase, str);
                    return;
                }
                negative = d < 0 || (d == 0 && 1 / d < 0);
                value = new BigDecimal(Double.toString(Math.abs(d)));
            } else if (arg instanceof BigDecimal) {
                negative = ((BigDecimal) arg).signum() < 0;
                value = ((BigDecimal) arg).abs();
            } else {
                throw new IllegalFormatConversionException(specifier, arg == null ? null : arg.getClass());
            }

            DecimalFormatSymbols symbols = new DecimalFormatSymbols(locale);
            String body;
            switch (specifier) {
                case 'e':
                case 'E':
                    body = scientific(value, precision == -1 ? 6 : precision, symbols);
                    break;
                case 'g':
                case 'G':
                    body = general(value, precision == -1 ? 6 : precision == 0 ? 1 : precision, symbols);
                    break;
                default:
                    body = fixed(value, precision == -1 ? 6 : precision, symbols);
                    break;
            }
            appendSignedNumber(negative, body, upperCase);
        }

        private String fixed(BigDecimal value, int digits, DecimalFormatSymbols symbols) {
            String plain = value.setScale(digits, RoundingMode.HALF_UP).toPlainString();
            int dot = plain.indexOf('.');
            String intPart = dot < 0 ? plain : plain.substring(0, dot);
            String fraction = dot < 0 ? "" : plain.substring(dot + 1);
            if ((flags & TFormattableFlags.GROUPING_SEPARATOR) != 0) {
                StringBuilder grouped = new StringBuilder();
                int n = intPart.length();
                for (int i = 0; i < n; ++i) {
                    if (i > 0 && (n - i) % 3 == 0) {
                        grouped.append(symbols.getGroupingSeparator());
                    }
                    grouped.append(intPart.charAt(i));
                }
                intPart = grouped.toString();
            }
            return fraction.isEmpty() ? intPart : intPart + symbols.getDecimalSeparator() + fraction;
        }

        private String scientific(BigDecimal value, int digits, DecimalFormatSymbols symbols) {
            int exponent = 0;
            BigDecimal mantissa = value;
            if (value.signum() != 0) {
                BigDecimal rounded = value.round(new MathContext(digits + 1, RoundingMode.HALF_UP));
                exponent = rounded.precision() - rounded.scale() - 1;
                mantissa = rounded.movePointLeft(exponent);
            }
            String m = mantissa.setScale(digits, RoundingMode.HALF_UP).toPlainString()
                    .replace('.', symbols.getDecimalSeparator());
            int abs = Math.abs(exponent);
            return m + "e" + (exponent < 0 ? "-" : "+") + (abs < 10 ? "0" : "") + abs;
        }

        private String general(BigDecimal value, int digits, DecimalFormatSymbols symbols) {
            if (value.signum() == 0) {
                return fixed(value, digits - 1, symbols);
            }
            BigDecimal rounded = value.round(new MathContext(digits, RoundingMode.HALF_UP));
            int exponent = rounded.precision() - rounded.scale() - 1;
            if (rounded.compareTo(new BigDecimal("0.0001")) >= 0 && exponent < digits) {
                return fixed(value, digits - exponent - 1, symbols);
            }
            return scientific(value, digits - 1, symbols);
        }

        private void appendSignedNumber(boolean negative, String body, boolean upperCase) throws IOException {
            String prefix = "";
            String suffix = "";
            if (negative) {
                if ((flags & TFormattableFlags.PARENTHESIZED_NEGATIVE) != 0) {
                    prefix = "(";
                    suffix = ")";
                } else {
                    prefix = "-";
                }
            } else if ((flags & TFormattableFlags.SIGNED) != 0) {
                prefix = "+";
            } else if ((flags & TFormattableFlags.LEADING_SPACE) != 0) {
                prefix = " ";
            }
            if ((flags & TFormattableFlags.ZERO_PADDED) != 0 && width > 0) {
                int pad = width - prefix.length() - suffix.length() - body.length();
                StringBuilder zeros = new StringBuilder();
                for (int i = 0; i < pad; ++i) {
                    zeros.append('0');
                }
                body = zeros + body;
            }
            precision = -1; // formatGivenString이 자르지 않도록
            formatGivenString(upperCase, prefix + body + suffix);
        }

        private int predictDecimalSize(boolean negative, TDecimalFormat format) {
            int decimalSize = width;
            if (precision > 0) {
                decimalSize -= precision + 1; // width also includes decimal places. Subtract them!
            }
            // signs take up space as well. Also subtract them!
            if (negative) {
                if ((flags & TFormattableFlags.PARENTHESIZED_NEGATIVE) != 0) {
                    decimalSize -= 2;
                } else {
                    decimalSize--;
                }
            } else if ((flags & (TFormattableFlags.SIGNED | TFormattableFlags.LEADING_SPACE)) != 0) {
                decimalSize--;
            }
            // the grouping separator also takes up space. You know the drill.
            if ((flags & TFormattableFlags.GROUPING_SEPARATOR) != 0) {
                decimalSize -= decimalSize / (format.getGroupingSize() + 1);
            }
            return decimalSize;
        }

        private void verifyFloatFlags() {
            if ((flags & TFormattableFlags.SIGNED) != 0 && (flags & TFormattableFlags.LEADING_SPACE) != 0) {
                throw new TIllegalFormatFlagsException("+ ");
            }
            if ((flags & TFormattableFlags.ZERO_PADDED) != 0 && (flags & TFormattableFlags.LEFT_JUSTIFY) != 0) {
                throw new TIllegalFormatFlagsException("0-");
            }
            if ((flags & TFormattableFlags.LEFT_JUSTIFY) != 0 && width < 0) {
                throw new TMissingFormatWidthException(format.substring(formatSpecifierStart, index));
            }
        }

        private void formatBoolean(char specifier, boolean upperCase) throws IOException {
            verifyFlagsForGeneralFormat(specifier);
            Object arg = args[argumentIndex];
            String s = Boolean.toString(arg instanceof Boolean ? (Boolean) arg : arg != null);
            formatGivenString(upperCase, s);
        }

        private void formatHex(char specifier, boolean upperCase) throws IOException {
            verifyFlagsForGeneralFormat(specifier);
            Object arg = args[argumentIndex];
            String s = arg != null ? Integer.toHexString(arg.hashCode()) : "null";
            formatGivenString(upperCase, s);
        }

        private void formatString(char specifier, boolean upperCase) throws IOException {
            verifyFlagsForGeneralFormat(specifier);
            Object arg = args[argumentIndex];
            if (arg instanceof TFormattable) {
                int flagsToPass = flags & 7;
                if (upperCase) {
                    flagsToPass |= TFormattableFlags.UPPERCASE;
                }
                ((TFormattable) arg).formatTo(formatter, flagsToPass, width, precision);
            } else {
                formatGivenString(upperCase, String.valueOf(arg));
            }
        }

        private void formatChar(char specifier, boolean upperCase) throws IOException {
            verifyFlags(specifier, MASK_FOR_CHAR_FORMAT);
            Object arg = args[argumentIndex];

            if (precision >= 0) {
                throw new TIllegalFormatPrecisionException(precision);
            }

            int c;
            if (arg instanceof Character) {
                c = (Character) arg;
            } else if (arg instanceof Byte) {
                c = (char) (byte) arg;
            } else if (arg instanceof Short) {
                c = (char) (short) arg;
            } else if (arg instanceof Integer) {
                c = (int) arg;
                if (!Character.isValidCodePoint(c)) {
                    throw new TIllegalFormatCodePointException(c);
                }
            } else if (arg == null) {
                formatGivenString(upperCase, "null");
                return;
            } else {
                throw new IllegalFormatConversionException(specifier, arg.getClass());
            }

            formatGivenString(upperCase, new String(Character.toChars(c)));
        }

        private void formatDecimalInt(char specifier, boolean upperCase) throws IOException {
            verifyFlags(specifier, MASK_FOR_INT_DECIMAL_FORMAT);
            verifyIntFlags();

            String str;
            Object arg = args[argumentIndex];
            boolean negative;
            if (arg instanceof Long) {
                long value = (Long) arg;
                str = Long.toString(Math.abs(value));
                negative = value < 0;
            } else if (arg instanceof Integer || arg instanceof Byte || arg instanceof Short) {
                int value = ((Number) arg).intValue();
                str = Integer.toString(Math.abs(value));
                negative = value < 0;
            } else {
                throw new IllegalFormatConversionException(specifier, arg != null ? arg.getClass() : null);
            }

            int additionalSymbols = 0;
            StringBuilder sb = new StringBuilder();
            if (negative) {
                if ((flags & TFormattableFlags.PARENTHESIZED_NEGATIVE) != 0) {
                    sb.append('(');
                    additionalSymbols += 2;
                } else {
                    sb.append('-');
                    additionalSymbols++;
                }
            } else {
                if ((flags & TFormattableFlags.SIGNED) != 0) {
                    sb.append('+');
                    additionalSymbols++;
                } else if ((flags & TFormattableFlags.LEADING_SPACE) != 0) {
                    sb.append(' ');
                    additionalSymbols++;
                }
            }

            StringBuilder valueSb = new StringBuilder();
            if ((flags & TFormattableFlags.GROUPING_SEPARATOR) != 0) {
                char separator = new DecimalFormatSymbols(locale).getGroupingSeparator();
                int size = ((DecimalFormat) NumberFormat.getNumberInstance(locale)).getGroupingSize();
                int offset = str.length() % size;
                if (offset == 0) {
                    offset = size;
                }

                int prev = 0;
                for (int i = offset; i < str.length(); i += size) {
                    valueSb.append(str.substring(prev, i));
                    valueSb.append(separator);
                    prev = i;
                }
                valueSb.append(str.substring(prev));
            } else {
                valueSb.append(str);
            }

            if ((flags & TFormattableFlags.ZERO_PADDED) != 0) {
                int actual = valueSb.length() + additionalSymbols;
                for (int i = actual; i < width; ++i) {
                    sb.append(Character.forDigit(0, 10));
                }
            }
            sb.append(valueSb);

            if (negative && (flags & TFormattableFlags.PARENTHESIZED_NEGATIVE) != 0) {
                sb.append(')');
            }

            formatGivenString(upperCase, sb.toString());
        }

        private void formatRadixInt(char specifier, int radixLog2, boolean upperCase) throws IOException {
            verifyFlags(specifier, MASK_FOR_INT_RADIX_FORMAT);
            verifyIntFlags();

            String str;
            Object arg = args[argumentIndex];
            if (arg instanceof Long) {
                str = IntegerUtil.toUnsignedLogRadixString((Long) arg, radixLog2);
            } else if (arg instanceof Integer) {
                str = IntegerUtil.toUnsignedLogRadixString((Integer) arg, radixLog2);
            } else if (arg instanceof Short) {
                str = IntegerUtil.toUnsignedLogRadixString((Short) arg & 0xFFFF, radixLog2);
            } else if (arg instanceof Byte) {
                str = IntegerUtil.toUnsignedLogRadixString((Byte) arg & 0xFF, radixLog2);
            } else {
                throw new IllegalFormatConversionException(specifier, arg != null ? arg.getClass() : null);
            }

            StringBuilder sb = new StringBuilder();
            if ((flags & TFormattableFlags.ALTERNATE) != 0) {
                String prefix = radixLog2 == 4 ? "0x" : "0";
                str = prefix + str;
            }

            if ((flags & TFormattableFlags.ZERO_PADDED) != 0) {
                for (int i = str.length(); i < width; ++i) {
                    sb.append(Character.forDigit(0, 10));
                }
            }
            sb.append(str);

            formatGivenString(upperCase, sb.toString());
        }

        private void verifyIntFlags() {
            if ((flags & TFormattableFlags.SIGNED) != 0 && (flags & TFormattableFlags.LEADING_SPACE) != 0) {
                throw new TIllegalFormatFlagsException("+ ");
            }
            if ((flags & TFormattableFlags.ZERO_PADDED) != 0 && (flags & TFormattableFlags.LEFT_JUSTIFY) != 0) {
                throw new TIllegalFormatFlagsException("0-");
            }
            if (precision >= 0) {
                throw new TIllegalFormatPrecisionException(precision);
            }
            if ((flags & TFormattableFlags.LEFT_JUSTIFY) != 0 && width < 0) {
                throw new TMissingFormatWidthException(format.substring(formatSpecifierStart, index));
            }
        }

        private void formatGivenString(boolean upperCase, String str) throws IOException {
            if (precision > 0 && precision < str.length()) {
                str = str.substring(0, precision);
            }

            if (upperCase) {
                str = str.toUpperCase();
            }

            if ((flags & TFormattableFlags.LEFT_JUSTIFY) != 0) {
                out.append(str);
                mayBeAppendSpaces(str);
            } else {
                mayBeAppendSpaces(str);
                out.append(str);
            }
        }

        private void verifyFlagsForGeneralFormat(char conversion) {
            verifyFlags(conversion, MASK_FOR_GENERAL_FORMAT);
        }

        private void verifyFlags(char conversion, int mask) {
            if ((flags | mask) != mask) {
                throw new FormatFlagsConversionMismatchException(flagsToString(flags & ~mask), conversion);
            }
        }

        private String flagsToString(int flags) {
            int flagIndex = Integer.numberOfTrailingZeros(flags);
            return String.valueOf(FORMAT_FLAGS.charAt(flagIndex));
        }

        private void mayBeAppendSpaces(String str) throws IOException {
            if (width > str.length()) {
                int diff = width - str.length();
                StringBuilder sb = new StringBuilder(diff);
                for (int i = 0; i < diff; ++i) {
                    sb.append(' ');
                }
                out.append(sb);
            }
        }

        private void configureFormat() {
            if ((flags & TFormattableFlags.PREVIOUS_ARGUMENT) != 0) {
                argumentIndex = Math.max(0, previousArgumentIndex);
            }

            if (argumentIndex == -1) {
                argumentIndex = defaultArgumentIndex++;
            }
            previousArgumentIndex = argumentIndex;
        }

        private char parseFormatSpecifier() {
            flags = 0;
            argumentIndex = -1;
            width = -1;
            precision = -1;

            char c = format.charAt(index);

            if (c != '0' && isDigit(c)) {
                int n = readInt();
                if (index < format.length() && format.charAt(index) == '$') {
                    index++;
                    argumentIndex = n - 1;
                } else {
                    width = n;
                }
            }
            parseFlags();

            if (width < 0 && index < format.length() && isDigit(format.charAt(index))) {
                width = readInt();
            }

            if (index < format.length() && format.charAt(index) == '.') {
                index++;
                if (index >= format.length() || !isDigit(format.charAt(index))) {
                    throw new UnknownFormatConversionException(String.valueOf(format.charAt(index - 1)));
                }
                precision = readInt();
            }

            if (index >= format.length()) {
                throw new UnknownFormatConversionException(String.valueOf(format.charAt(format.length() - 1)));
            }
            return format.charAt(index++);
        }

        private void parseFlags() {
            while (index < format.length()) {
                char c = format.charAt(index);
                int flag;
                switch (c) {
                    case '-':
                        flag = TFormattableFlags.LEFT_JUSTIFY;
                        break;
                    case '#':
                        flag = TFormattableFlags.ALTERNATE;
                        break;
                    case '+':
                        flag = TFormattableFlags.SIGNED;
                        break;
                    case ' ':
                        flag = TFormattableFlags.LEADING_SPACE;
                        break;
                    case '0':
                        flag = TFormattableFlags.ZERO_PADDED;
                        break;
                    case ',':
                        flag = TFormattableFlags.GROUPING_SEPARATOR;
                        break;
                    case '(':
                        flag = TFormattableFlags.PARENTHESIZED_NEGATIVE;
                        break;
                    case '<':
                        flag = TFormattableFlags.PREVIOUS_ARGUMENT;
                        break;
                    default:
                        return;
                }
                if ((flags & flag) != 0) {
                    throw new DuplicateFormatFlagsException(String.valueOf(c));
                }
                flags |= flag;
                index++;
            }
        }

        private int readInt() {
            int result = 0;
            while (index < format.length() && isDigit(format.charAt(index))) {
                result = result * 10 + (format.charAt(index++) - '0');
            }
            return result;
        }

        private static boolean isDigit(char c) {
            return c >= '0' && c <= '9';
        }
    }
}
