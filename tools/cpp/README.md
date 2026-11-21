# C++ 예외 지원 라이브러리

`@yowasp/clang`에 들어 있는 libc++는 예외 없이 빌드된 것이라 `try`/`catch`/`throw`를 쓸 수 없습니다.
그래서 예외를 쓰는 코드만 [wasi-sdk](https://github.com/WebAssembly/wasi-sdk)의 예외 지원 libc++로 링크합니다.

| 파일                          | 내용                  |
| ----------------------------- | --------------------- |
| `public/clang-eh/libc++.a`    | 예외 지원 libc++      |
| `public/clang-eh/libc++abi.a` | 예외 지원 libc++abi   |
| `public/clang-eh/libunwind.a` | wasm 예외용 libunwind |

## 출처

wasi-sdk 33 릴리스의 `wasi-sysroot-33.0+m.tar.gz` (LLVM 22.1.0, YoWASP clang과 같은 LLVM 22) 안의
`lib/wasm32-wasip1/eh/`에서 세 파일을 그대로 가져왔습니다.

```bash
curl -LO "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-33/wasi-sysroot-33.0%2Bm.tar.gz"
tar xzf "wasi-sysroot-33.0+m.tar.gz" "wasi-sysroot-33.0+m/lib/wasm32-wasip1/eh"
cp wasi-sysroot-33.0+m/lib/wasm32-wasip1/eh/{libc++.a,libc++abi.a,libunwind.a} public/clang-eh/
```

`@yowasp/clang`의 LLVM 주 버전을 올릴 때는 같은 주 버전의 wasi-sdk에서 다시 가져와야 합니다.

## 컴파일 옵션

`src/runner/compiler-worker.ts`가 소스에 `try`/`catch`/`throw`가 있으면 다음을 붙입니다.

- 컴파일: `-fwasm-exceptions -mllvm -wasm-use-legacy-eh=false` (라이브러리와 같은 새 방식의 예외 명령)
- 링크: `-L./eh -lunwind`, LTO 코드 생성용 `-Wl,-mllvm,-wasm-enable-eh` `-Wl,-mllvm,-exception-model=wasm`
  `-Wl,-mllvm,-wasm-use-legacy-eh=false`, 잡히지 않은 예외를 알리는 `-Wl,--wrap=__main_void`

## 라이선스

libc++, libc++abi, libunwind: Apache License 2.0 with LLVM Exceptions
