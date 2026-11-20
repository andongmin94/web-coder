# Java 런타임 빌드

웹 코더의 Java 지원은 [teavm-javac](https://github.com/konsoletyper/teavm-javac)를 소스에서 빌드해 씁니다.
OpenJDK의 javac와 [TeaVM](https://teavm.org)(Java 바이트코드 → WebAssembly 컴파일러)을
하나의 wasm-gc 모듈로 만든 것으로, 브라우저 안에서 `Main.java → .class → .wasm` 컴파일을 합니다.

| 파일 | 내용 |
| --- | --- |
| `public/java/compiler.wasm` | javac + TeaVM (wasm-gc) |
| `public/java/compile-classlib.bin` | javac가 참조하는 표준 라이브러리 시그니처 (+ `Scanner`, `InputMismatchException`) |
| `public/java/runtime-classlib.bin` | TeaVM 표준 라이브러리 구현 (+ stdin 패치, `Scanner`) |
| `vendor/teavm/wasm-runtime.js` | TeaVM wasm-gc JS 런타임 |

## 다시 만들기

```bash
JAVA_HOME=/path/to/jdk-25 tools/java/build.sh
```

- teavm-javac 커밋 `0340fab`과 TeaVM `0.17.0-dev-7`로 고정되어 있습니다.
- 작업 파일은 `.cache/java-build/`(git 제외)에 생깁니다. 끝나면 지워도 됩니다.

## 패치

- `patch/org/teavm/classlib/java/lang/TConsoleInputStream.java`
  TeaVM의 `System.in`은 항상 EOF를 던집니다. wasm import `webcoderStdin.read/available`로 입력을 읽게 바꿉니다.
- `patch/templates/Scanner.java.tmpl`, `InputMismatchException.java.tmpl`
  TeaVM에 없는 `java.util.Scanner`를 BOJ 풀이에서 쓰는 범위로 구현합니다.
  같은 소스로 TeaVM 런타임용(`TScanner`)과 javac SDK용(`java.util.Scanner`)을 만듭니다.
- `classlib-archive.mjs`: TeaVM 클래스 라이브러리 아카이브(gzip + 길이 접두 항목) 읽기/쓰기

## 알려진 한계

- 브라우저 Worker의 스택 크기 때문에 재귀 깊이가 약 4천~9천을 넘으면 `StackOverflowError`가 납니다.
- TeaVM이 지원하지 않는 API(리플렉션 일부 등)는 컴파일되지 않을 수 있습니다.

## 라이선스

- teavm-javac, TeaVM: Apache License 2.0
- javac (OpenJDK): GPL v2 with the Classpath Exception. 소스는 <https://github.com/openjdk/jdk25u>
  (teavm-javac 빌드가 `gradle.properties`의 `jdk.revision` 커밋을 받아 씁니다.)
