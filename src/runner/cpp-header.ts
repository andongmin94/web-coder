// GCC 전용 <bits/stdc++.h> 호환 헤더. 표준 버전에 맞는 헤더만 포함합니다.
const BASE = [
    'algorithm',
    'array',
    'bitset',
    'cassert',
    'cctype',
    'chrono',
    'climits',
    'cmath',
    'complex',
    'cstdint',
    'cstdio',
    'cstdlib',
    'cstring',
    'deque',
    'functional',
    'iomanip',
    'iostream',
    'iterator',
    'limits',
    'list',
    'map',
    'memory',
    'numeric',
    'optional',
    'queue',
    'random',
    'set',
    'sstream',
    'stack',
    'string',
    'string_view',
    'tuple',
    'unordered_map',
    'unordered_set',
    'utility',
    'variant',
    'vector',
];
const CXX20 = ['bit', 'compare', 'concepts', 'numbers', 'ranges', 'span', 'format'];
const CXX23 = ['expected', 'print'];

const optional = (h: string) => `#if __has_include(<${h}>)\n#include <${h}>\n#endif`;

export const BITS_STDCXX = [
    '#pragma once',
    ...BASE.map((h) => `#include <${h}>`),
    '#if __cplusplus >= 202002L',
    ...CXX20.map(optional),
    '#endif',
    '#if __cplusplus > 202002L',
    ...CXX23.map(optional),
    '#endif',
    '',
].join('\n');

/** 소스가 bits/stdc++.h를 쓰는지 (PCH를 쓸지 판단) */
export const usesBitsStdcxx = (source: string) => /#\s*include\s*<bits\/stdc\+\+\.h>/.test(source);

/**
 * 이 sysroot의 libc++ iostream은 wasm에서 매우 느립니다. (정수 100만 개 읽기: cin 2.1초, scanf 0.19초)
 * 대부분은 로케일 기반 숫자 파싱(num_get) 비용이고, 나머지는 stdio를 거친 한 글자 단위 입출력입니다.
 * - 정수 파서(FastNumGet)는 동작이 같고 stdio와 섞어 써도 안전하므로 모든 C++ 코드에 넣습니다.
 * - cin/cout 64KB 버퍼는 stdio와 섞어 쓰면 순서가 깨지므로, 사용자가 sync_with_stdio(false)를
 *   쓴 경우에만 WEBCODER_UNSYNCED_STDIO 매크로로 켭니다. (libc++에서는 이 호출이 실제로 아무것도 하지 않음)
 */
export const FAST_IO_HEADER = `#pragma once
#include <iostream>
#include <limits>
#include <locale>
#include <streambuf>
#include <cstdio>
namespace webcoder_fastio {
struct InBuf : std::streambuf {
    char buf[1 << 16];
    int_type underflow() override {
        if (gptr() < egptr()) return traits_type::to_int_type(*gptr());
        std::size_t n = std::fread(buf, 1, sizeof buf, stdin);
        if (n == 0) return traits_type::eof();
        setg(buf, buf, buf + n);
        return traits_type::to_int_type(*gptr());
    }
};
struct OutBuf : std::streambuf {
    char buf[1 << 16];
    OutBuf() { setp(buf, buf + sizeof buf); }
    int sync() override {
        std::fwrite(pbase(), 1, std::size_t(pptr() - pbase()), stdout);
        std::fflush(stdout);
        setp(buf, buf + sizeof buf);
        return 0;
    }
    int_type overflow(int_type c) override {
        sync();
        if (!traits_type::eq_int_type(c, traits_type::eof())) {
            *pptr() = traits_type::to_char_type(c);
            pbump(1);
        }
        return traits_type::not_eof(c);
    }
};
// 10진 정수 파싱을 직접 처리합니다. (그 외 진법·실수는 원래 구현으로)
struct FastNumGet : std::num_get<char> {
    using iter = std::istreambuf_iterator<char>;
    template <class T>
    iter parse(iter in, iter end, std::ios_base &io, std::ios_base::iostate &err, T &v) const {
        if ((io.flags() & std::ios_base::basefield) != std::ios_base::dec)
            return std::num_get<char>::do_get(in, end, io, err, v);
        bool neg = false;
        if (in != end && (*in == '-' || *in == '+')) {
            neg = *in == '-';
            ++in;
        }
        if (in == end || *in < '0' || *in > '9') {
            v = 0;
            err = std::ios_base::failbit;
            if (in == end) err |= std::ios_base::eofbit;
            return in;
        }
        using U = unsigned long long;
        constexpr bool is_signed = std::numeric_limits<T>::is_signed;
        const U limit = is_signed && neg ? U(std::numeric_limits<T>::max()) + 1 : U(std::numeric_limits<T>::max());
        U acc = 0;
        bool overflow = false;
        for (; in != end && *in >= '0' && *in <= '9'; ++in) {
            unsigned d = unsigned(*in - '0');
            if (acc > (limit - d) / 10) overflow = true;
            else acc = acc * 10 + d;
        }
        err = std::ios_base::goodbit;
        if (overflow) {
            err = std::ios_base::failbit;
            v = is_signed && neg ? std::numeric_limits<T>::min() : std::numeric_limits<T>::max();
        } else if (neg) {
            v = T(U(0) - acc);
        } else {
            v = T(acc);
        }
        if (in == end) err |= std::ios_base::eofbit;
        return in;
    }
    iter do_get(iter i, iter e, std::ios_base &io, std::ios_base::iostate &er, long &v) const override { return parse(i, e, io, er, v); }
    iter do_get(iter i, iter e, std::ios_base &io, std::ios_base::iostate &er, long long &v) const override { return parse(i, e, io, er, v); }
    iter do_get(iter i, iter e, std::ios_base &io, std::ios_base::iostate &er, unsigned short &v) const override { return parse(i, e, io, er, v); }
    iter do_get(iter i, iter e, std::ios_base &io, std::ios_base::iostate &er, unsigned int &v) const override { return parse(i, e, io, er, v); }
    iter do_get(iter i, iter e, std::ios_base &io, std::ios_base::iostate &er, unsigned long &v) const override { return parse(i, e, io, er, v); }
    iter do_get(iter i, iter e, std::ios_base &io, std::ios_base::iostate &er, unsigned long long &v) const override { return parse(i, e, io, er, v); }
};
inline InBuf in_buf;
inline OutBuf out_buf;
struct Init {
#ifdef WEBCODER_UNSYNCED_STDIO
    std::streambuf *orig_in, *orig_out;
    Init() : orig_in(std::cin.rdbuf(&in_buf)), orig_out(std::cout.rdbuf(&out_buf)) {
        std::cin.imbue(std::locale(std::cin.getloc(), new FastNumGet));
    }
    ~Init() {
        std::cout.flush();
        std::cin.rdbuf(orig_in);
        std::cout.rdbuf(orig_out);
    }
#else
    Init() { std::cin.imbue(std::locale(std::cin.getloc(), new FastNumGet)); }
#endif
};
inline Init init;
}
`;

export const usesUnsyncedStdio = (source: string) =>
    /sync_with_stdio\s*\(\s*(false|0)\s*\)/.test(source);
