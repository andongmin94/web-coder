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
- BOJ(Java 11)와 결과가 달랐던 TeaVM 클래스들. 진짜 Java 11과 출력을 줄 단위로 비교하며 고쳤습니다.
    - `java/util/THashMap.java`, `THashSet.java`, `TLinkedHashMap.java`: HashMap/HashSet의 순회 순서.
      해시 섞기(`h ^ h >>> 16`), 칸의 맨 뒤에 넣기(`computeIfAbsent`/`compute`/`merge`는 맨 앞), 크기를 늘릴 때 순서 유지,
      처음 크기(복사 생성자, `putAll`, `HashSet(Collection)`), 한 칸이 8개를 넘을 때 표 키우기를 OpenJDK 11처럼 합니다.
      (작은 `Integer` 키가 오름차순으로 나오는 것에 기대는 풀이가 많습니다.)
    - `java/util/TRandom.java`: 같은 seed면 같은 수열 (`nextInt(bound)`, `nextBoolean`, `nextBytes`, `nextGaussian`, `Collections.shuffle`)
    - `java/lang/TAbstractStringBuilder.java`: float/double 출력. 원본은 float을 3분의 2쯤 틀리게 썼습니다(`16777216f` → `1.6777218E7`).
      Java 11처럼 long에 들어가는 정수는 정수 자릿수 그대로(`4.56131744E8`), 그 밖에는 다시 읽으면 같은 값이 되는 가장 짧은 표기를 씁니다.
    - `java/lang/TDouble.java`, `TFloat.java`: `parseDouble`/`parseFloat`이 가끔 1ulp 틀리던 것(정확한 방법으로 다시 계산)과 실패 메시지
    - `java/lang/TInteger.java`, `TLong.java`: 실패 메시지를 `For input string: "12a"`로
    - `java/util/regex/TPattern.java`: Java 8부터의 `split` 규칙 (`"abc".split("")` → `[a, b, c]`)
    - `java/io/TStreamTokenizer.java`: `nval`을 Java처럼 자릿수를 쌓아 계산 (긴 수에서 값이 달랐음)
    - `java/util/TAbstractList.java`: 다 쓴 반복자의 `next()`는 `NoSuchElementException`
    - `java/lang/TEnum.java`: `compareTo`는 순서 번호의 차이
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
- javac 자체도 TeaVM으로 만든 것이라, 컴파일할 때 처리되는 실수 상수는 위 패치가 적용되지 않습니다.
  9자리 이상 float 리터럴(`16777217f`), 비정규수 double 리터럴(`2.5e-310`), `Double.MIN_NORMAL`, 문자열 `+`에 그대로 붙은
  실수 상수(`"" + Double.MIN_VALUE`)는 Java와 다를 수 있습니다. (런타임에 만든 값은 같음. 고치려면 `compiler.wasm`을 다시 빌드해야 함)
- Java 11의 `Double.toString`은 일부 큰 수에서 필요보다 긴 자릿수를 씁니다(`5.950000000000001E21`). 이 경우는 가장 짧은 표기(`5.95E21`)가 나옵니다.
- HashMap의 한 칸이 트리로 바뀐 경우(같은 칸에 8개 넘게, 표 크기 64 이상)의 순서는 흉내 내지 않습니다.
- 쓰지 않는 형 변환(`(Integer) o;`)은 TeaVM이 없애서 `ClassCastException`이 나지 않습니다.
- `Scanner`는 `useDelimiter`, `findInLine`, `skip`이 없습니다.

## 라이선스

- teavm-javac, TeaVM: Apache License 2.0
- javac (OpenJDK): GPL v2 with the Classpath Exception. 소스는 <https://github.com/openjdk/jdk25u>
  (teavm-javac 빌드가 `gradle.properties`의 `jdk.revision` 커밋을 받아 씁니다.)
