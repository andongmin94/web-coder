/*
 * 웹 코더 패치: TeaVM의 System.in은 항상 EOF를 던집니다.
 * 이 버전은 wasm-gc import(webcoderStdin.read / available)로 호스트가 넣어 준 입력을 바이트 단위로 읽습니다.
 * 원본: org.teavm.classlib.java.lang.TConsoleInputStream (Apache License 2.0, Alexey Andreev)
 */
package org.teavm.classlib.java.lang;

import java.io.IOException;
import org.teavm.classlib.java.io.TInputStream;
import org.teavm.interop.Import;

class TConsoleInputStream extends TInputStream {
    /** 다음 바이트(0~255), 입력 끝이면 -1 */
    @Import(module = "webcoderStdin", name = "read")
    private static native int readByte();

    /** 남은 바이트 수 */
    @Import(module = "webcoderStdin", name = "available")
    private static native int availableBytes();

    @Override
    public int read() throws IOException {
        return readByte();
    }

    @Override
    public int read(byte[] b) throws IOException {
        return read(b, 0, b.length);
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (len == 0) {
            return 0;
        }
        int first = readByte();
        if (first < 0) {
            return -1;
        }
        b[off] = (byte) first;
        int count = 1;
        int limit = Math.min(len, 1 + availableBytes());
        while (count < limit) {
            int c = readByte();
            if (c < 0) {
                break;
            }
            b[off + count++] = (byte) c;
        }
        return count;
    }

    @Override
    public int available() throws IOException {
        return availableBytes();
    }
}
