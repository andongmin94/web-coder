// GCC 전용 <bits/stdc++.h> 호환 헤더. 표준 버전에 맞는 헤더만 포함합니다.
const BASE = [
    'algorithm',
    'any',
    'array',
    'atomic',
    'bitset',
    'cassert',
    'cctype',
    'cerrno',
    'cfloat',
    'charconv',
    'chrono',
    'cinttypes',
    'climits',
    'cmath',
    'complex',
    'cstdarg',
    'cstddef',
    'cstdint',
    'cstdio',
    'cstdlib',
    'cstring',
    'ctime',
    'deque',
    'exception',
    'forward_list',
    'fstream',
    'functional',
    'initializer_list',
    'iomanip',
    'ios',
    'iosfwd',
    'iostream',
    'istream',
    'iterator',
    'limits',
    'list',
    'locale',
    'map',
    'memory',
    'new',
    'numeric',
    'optional',
    'ostream',
    'queue',
    'random',
    'ratio',
    'regex',
    'set',
    'sstream',
    'stack',
    'stdexcept',
    'streambuf',
    'string',
    'string_view',
    'tuple',
    'type_traits',
    'typeindex',
    'typeinfo',
    'unordered_map',
    'unordered_set',
    'utility',
    'valarray',
    'variant',
    'vector',
];
const CXX20 = [
    'bit',
    'compare',
    'concepts',
    'numbers',
    'ranges',
    'span',
    'format',
    'source_location',
];
const CXX23 = ['expected', 'print'];

/**
 * libstdc++(GCC)에만 있는 내부 함수 중 풀이에서 흔히 쓰는 것. (libc++에는 없음)
 */
const GCC_COMPAT = `// C++11의 constexpr 함수에는 반복문을 쓸 수 없고, C++03에는 constexpr이 없습니다.
#if __cplusplus >= 201402L
#define __WEBCODER_CONSTEXPR constexpr
#else
#define __WEBCODER_CONSTEXPR inline
#endif
namespace std {
template <class _Tp> __WEBCODER_CONSTEXPR _Tp __gcd(_Tp __m, _Tp __n) {
    while (__n != 0) { _Tp __t = __m % __n; __m = __n; __n = __t; }
    return __m;
}
__WEBCODER_CONSTEXPR int __lg(int __n) { return (int)sizeof(int) * 8 - 1 - __builtin_clz(__n); }
__WEBCODER_CONSTEXPR unsigned __lg(unsigned __n) { return (unsigned)sizeof(int) * 8 - 1 - __builtin_clz(__n); }
__WEBCODER_CONSTEXPR long __lg(long __n) { return (long)sizeof(long) * 8 - 1 - __builtin_clzl(__n); }
__WEBCODER_CONSTEXPR unsigned long __lg(unsigned long __n) { return (unsigned long)sizeof(long) * 8 - 1 - __builtin_clzl(__n); }
__WEBCODER_CONSTEXPR long long __lg(long long __n) { return (long long)sizeof(long long) * 8 - 1 - __builtin_clzll(__n); }
__WEBCODER_CONSTEXPR unsigned long long __lg(unsigned long long __n) { return (unsigned long long)sizeof(long long) * 8 - 1 - __builtin_clzll(__n); }
}`;

const optional = (h: string) => `#if __has_include(<${h}>)\n#include <${h}>\n#endif`;

export const BITS_STDCXX = [
    '#pragma once',
    '#pragma GCC system_header',
    ...BASE.map((h) => `#include <${h}>`),
    '#if __cplusplus >= 202002L',
    ...CXX20.map(optional),
    '#endif',
    '#if __cplusplus > 202002L',
    ...CXX23.map(optional),
    '#endif',
    GCC_COMPAT,
    '',
].join('\n');

/** 소스가 bits/stdc++.h를 쓰는지 (PCH를 쓸지 판단) */
export const usesBitsStdcxx = (source: string) =>
    /#\s*include\s*[<"]bits\/(stdc|extc)\+\+\.h[>"]/.test(source);

/**
 * 이 sysroot의 libc++ iostream은 wasm에서 매우 느립니다. (정수 100만 개 읽기: cin 2.1초, scanf 0.19초)
 * 대부분은 로케일 기반 숫자 파싱(num_get) 비용이고, 나머지는 stdio를 거친 한 글자 단위 입출력입니다.
 * - 정수 파서(FastNumGet)는 동작이 같고 stdio와 섞어 써도 안전하므로 모든 C++ 코드에 넣습니다.
 * - cin/cout 64KB 버퍼는 stdio와 섞어 쓰면 순서가 깨지므로, 사용자가 sync_with_stdio(false)를
 *   쓴 경우에만 WEBCODER_UNSYNCED_STDIO 매크로로 켭니다. (libc++에서는 이 호출이 실제로 아무것도 하지 않음)
 */
export const FAST_IO_HEADER = `#pragma once
// 이 헤더가 내는 경고(C++17 이전 표준에서의 확장 문법 등)는 사용자 코드의 경고가 아니므로 숨깁니다.
#pragma GCC system_header
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
        const bool is_signed = std::numeric_limits<T>::is_signed;
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
// 잡히지 않은 예외로 끝날 때 GCC처럼 예외 타입과 what()을 stderr에 남깁니다.
// (wasm 예외는 받는 곳이 없으면 그대로 JS로 빠져나가서 std::terminate가 불리지 않음)
// 링크 옵션 --wrap=__main_void로 main 대신 이 함수가 불립니다.
#if defined(__cpp_exceptions)
#include <cstdlib>
#include <exception>
#include <typeinfo>
extern "C" {
char *__cxa_demangle(const char *, char *, std::size_t *, int *);
std::type_info *__cxa_current_exception_type();
int __real___main_void();
__attribute__((used)) int __wrap___main_void() {
    try {
        return __real___main_void();
    } catch (...) {
        std::cout.flush();
        std::fflush(stdout);
        const std::type_info *type = __cxa_current_exception_type();
        int status = 0;
        char *name = type ? __cxa_demangle(type->name(), 0, 0, &status) : 0;
        std::fprintf(stderr, "terminate called after throwing an instance of '%s'\\n",
                     name && status == 0 ? name : type ? type->name() : "?");
        try {
            throw;
        } catch (const std::exception &e) {
            std::fprintf(stderr, "  what():  %s\\n", e.what());
        } catch (...) {
        }
    }
    std::abort();
}
}
#endif
// 깊은 재귀 모드(src/runner/deep-stack.ts)가 새 스택으로 넘어갈 때 부르는 import. 링크에서 지워지지 않게 export로 붙잡아 둡니다.
extern "C" {
__attribute__((import_module("webcoder"), import_name("grow"))) void __webcoder_grow(int);
__attribute__((export_name("__webcoder_keep"))) void __webcoder_keep(int id) { __webcoder_grow(id); }
}
`;

/**
 * 예외를 쓰는 코드인지. 예외 지원은 코드가 커지고 느려져서 필요한 코드만 그 모드로 컴파일합니다.
 * (주석·문자열 안의 단어에도 반응하지만, 그때는 조금 느린 모드로 컴파일될 뿐입니다)
 */
export const usesExceptions = (source: string) => /\b(try|catch|throw)\b/.test(source);

export const usesUnsyncedStdio = (source: string) =>
    /sync_with_stdio\s*\(\s*(false|0)\s*\)/.test(source);
