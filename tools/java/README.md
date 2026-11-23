# Java 런타임 빌드

웹 코더의 Java 지원은 [teavm-javac](https://github.com/konsoletyper/teavm-javac)를 소스에서 빌드해 씁니다.
OpenJDK의 javac와 [TeaVM](https://teavm.org)(Java 바이트코드 → WebAssembly 컴파일러)을
하나의 wasm-gc 모듈로 만든 것으로, 브라우저 안에서 `Main.java → .class → .wasm` 컴파일을 합니다.

| 파일                                 | 내용                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `public/java/compiler.wasm`          | javac + TeaVM (wasm-gc)                                                           |
| `public/java/compile-classlib.bin`   | javac가 참조하는 표준 라이브러리 시그니처 (+ `Scanner`, `InputMismatchException`) |
| `public/java/compile-classlib-N.bin` | 위 SDK에서 Java N(8, 11, 15)에 없는 API를 뺀 것 (`release-sdk.mjs`)               |
| `public/java/runtime-classlib.bin`   | TeaVM 표준 라이브러리 구현 (+ stdin 패치, `Scanner`, `Formatter`)                 |
| `vendor/teavm/wasm-runtime.js`       | TeaVM wasm-gc JS 런타임                                                           |

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
- `patch/org/teavm/classlib/java/util/TFormatter.java`
  TeaVM의 `String.format`/`printf`는 `%f`를 `DecimalFormat`(HALF_EVEN)으로 반올림하고 `%e`, `%g`가 없습니다.
  OpenJDK처럼 `Double.toString`의 가장 짧은 10진 표기를 HALF_UP으로 반올림하고 `%e`, `%g`를 지원하게 고칩니다.
  (`String.format("%.2f", 1.005)`: TeaVM 원본 `1.00`, OpenJDK `1.01`)
- `patch-thread.mjs`
  TeaVM의 `Thread`에 없는 `Thread(ThreadGroup, Runnable, String, long)` 계열 생성자와 `ThreadGroup`을 추가합니다.
  (`new Thread(null, r, "", 1 << 26).start()` 관용구용. 스레드 그룹과 스택 크기는 무시)
  JDK 없이 `public/java/`의 클래스 파일을 직접 고치며, `build.sh`가 마지막에 실행합니다.
- `release-sdk.mjs`
  BOJ는 Java 8/11/15를 `javac -release N`으로 컴파일해서, 그 버전에 없는 API(`stream().toList()`, `"".formatted()` 등)는 컴파일 에러입니다.
  JDK의 `lib/ct.sym`(javac `--release`가 쓰는 버전별 공개 API)과 비교해 SDK에서 그 버전에 없는 클래스와 멤버를 뺀
  `compile-classlib-8.bin`, `-11.bin`, `-15.bin`을 만듭니다. 실행기는 BOJ 언어의 버전에 맞는 것을 javac에 올립니다.
  문법(record, switch 식, text block 등)은 javac의 문법 수준을 바꿀 수 없어서 `src/sandbox/java-syntax.ts`가 따로 검사합니다.
- `classlib-archive.mjs`: TeaVM 클래스 라이브러리 아카이브(gzip + 길이 접두 항목) 읽기/쓰기

## 알려진 한계

- 브라우저의 호출 스택 한계는 깊은 재귀 모드(`src/runner/deep-stack.ts`)로 넘깁니다. JSPI가 없는 브라우저(Chrome 136 이하)에서는 재귀 깊이가 약 4천~9천을 넘으면 `StackOverflowError`가 납니다.
- 스레드는 TeaVM이 타이머로 이어 붙여 실행합니다. (한 번에 하나씩 실행되고, 스택 크기 지정은 의미가 없음)
- TeaVM이 지원하지 않는 API(리플렉션 일부 등)는 컴파일되지 않을 수 있습니다.
- 런타임이 직접 만드는 예외(`ArrayIndexOutOfBoundsException`, `NullPointerException`, `ArithmeticException`)와
  클래스 라이브러리 일부(`ArrayList.get` 등)는 메시지가 없어서 `getMessage()`가 `null`입니다.
  (JVM은 `Index 5 out of bounds for length 3`, `/ by zero` 등을 줌) 어디서 났는지는 스택 트레이스의 줄 번호로 알 수 있습니다.
- 스택 트레이스의 클래스 라이브러리 프레임은 TeaVM 소스 기준이라 파일 이름이 `TArrayList.java`처럼 나옵니다.

## 라이선스

- teavm-javac, TeaVM: Apache License 2.0
- javac (OpenJDK): GPL v2 with the Classpath Exception. 소스는 <https://github.com/openjdk/jdk25u>
  (teavm-javac 빌드가 `gradle.properties`의 `jdk.revision` 커밋을 받아 씁니다.)
