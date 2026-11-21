#!/usr/bin/env bash
# public/java/의 Java 컴파일러 wasm과 클래스 라이브러리를 소스에서 다시 만듭니다.
#
# 필요: JDK 25 (JAVA_HOME), git, node, bash
# 사용: JAVA_HOME=/path/to/jdk-25 WORK_DIR=/tmp/webcoder-java tools/java/build.sh
#
# 1) teavm-javac(OpenJDK javac + TeaVM을 wasm-gc로 빌드한 것)를 고정 커밋으로 빌드
# 2) 웹 코더 패치 적용
#    - System.in: TeaVM 원본은 항상 EOF → webcoderStdin import로 입력을 읽도록 교체
#    - java.util.Scanner / InputMismatchException 추가 (TeaVM에 없음)
#    - Thread(ThreadGroup, Runnable, String, long) 생성자 추가 (patch-thread.mjs)
# 3) public/java/에 복사
set -euo pipefail

TEAVM_JAVAC_REPO="https://github.com/konsoletyper/teavm-javac.git"
TEAVM_JAVAC_COMMIT="0340fab28da146d283ba94df8a36d66a4c635084"
# 이 커밋은 로컬 빌드한 TeaVM 0.17.0-SNAPSHOT을 기대하므로, 공개된 개발 릴리스로 고정합니다.
TEAVM_VERSION="0.17.0-dev-7"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK_DIR="${WORK_DIR:-$ROOT/.cache/java-build}"
: "${JAVA_HOME:?JDK 25 경로를 JAVA_HOME으로 지정하세요}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$WORK_DIR/gradle-home}"

# Windows(Git Bash)에서는 JDK 도구에 Windows 경로를 넘겨야 합니다.
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
exe() { if [ -x "$JAVA_HOME/bin/$1.exe" ]; then echo "$JAVA_HOME/bin/$1.exe"; else echo "$JAVA_HOME/bin/$1"; fi; }
SEP=":"; command -v cygpath >/dev/null && SEP=";"

mkdir -p "$WORK_DIR"
SRC="$WORK_DIR/teavm-javac"
if [ ! -d "$SRC/.git" ]; then
    git clone "$TEAVM_JAVAC_REPO" "$SRC"
fi
git -C "$SRC" fetch --depth 1 origin "$TEAVM_JAVAC_COMMIT" 2>/dev/null || true
git -C "$SRC" checkout -q "$TEAVM_JAVAC_COMMIT"
sed -i "s/^teavm = \".*\"/teavm = \"$TEAVM_VERSION\"/" "$SRC/gradle/libs.versions.toml"

(cd "$SRC" && ./gradlew --no-daemon :compiler:createDist -x test)

DIST="$WORK_DIR/dist"
rm -rf "$DIST" && mkdir -p "$DIST"
unzip -q -o "$SRC/compiler/build/distributions/dist.zip" -d "$DIST"

# ── 패치 ─────────────────────────────────────────────────────────────
CL=$(find "$GRADLE_USER_HOME/caches" -name "teavm-classlib-$TEAVM_VERSION.jar" | head -1)
IO=$(find "$GRADLE_USER_HOME/caches" -name "teavm-interop-$TEAVM_VERSION.jar" | head -1)
GEN="$WORK_DIR/patch-gen"
OUT="$WORK_DIR/patch-out"
rm -rf "$GEN" "$OUT"
mkdir -p "$GEN/rt/org/teavm/classlib/java/util" "$GEN/sdk/java/util" "$OUT/rt" "$OUT/sdk"

gen() { # template package scanner exception out
    sed -e "s/__PACKAGE__/$2/g" -e "s/__SCANNER__/$3/g" -e "s/__EXCEPTION__/$4/g" "$HERE/patch/templates/$1.java.tmpl" >"$5"
}
gen Scanner org.teavm.classlib.java.util TScanner TInputMismatchException "$GEN/rt/org/teavm/classlib/java/util/TScanner.java"
gen InputMismatchException org.teavm.classlib.java.util TScanner TInputMismatchException "$GEN/rt/org/teavm/classlib/java/util/TInputMismatchException.java"
gen Scanner java.util Scanner InputMismatchException "$GEN/sdk/java/util/Scanner.java"
gen InputMismatchException java.util Scanner InputMismatchException "$GEN/sdk/java/util/InputMismatchException.java"

# TeaVM 런타임용: java.* 참조는 TeaVM이 T* 클래스로 바꿔 연결합니다. (원본과 같은 Java 17 바이트코드)
"$(exe javac)" --release 17 -nowarn -cp "$(winpath "$CL")$SEP$(winpath "$IO")" -d "$(winpath "$OUT/rt")" \
    "$(winpath "$HERE/patch/org/teavm/classlib/java/lang/TConsoleInputStream.java")" \
    "$(winpath "$GEN/rt/org/teavm/classlib/java/util/TScanner.java")" \
    "$(winpath "$GEN/rt/org/teavm/classlib/java/util/TInputMismatchException.java")"

# javac SDK용: java.base 패치로 컴파일 (시그니처만 사용)
"$(exe javac)" -source 17 -target 17 -nowarn -Xlint:-options --patch-module "java.base=$(winpath "$GEN/sdk")" -d "$(winpath "$OUT/sdk")" \
    "$(winpath "$GEN/sdk/java/util/Scanner.java")" \
    "$(winpath "$GEN/sdk/java/util/InputMismatchException.java")"

node "$HERE/classlib-archive.mjs" put "$DIST/runtime-classlib-teavm.bin" "$ROOT/public/java/runtime-classlib.bin" \
    "org/teavm/classlib/java/lang/TConsoleInputStream.class=$OUT/rt/org/teavm/classlib/java/lang/TConsoleInputStream.class" \
    "org/teavm/classlib/java/util/TScanner.class=$OUT/rt/org/teavm/classlib/java/util/TScanner.class" \
    "org/teavm/classlib/java/util/TInputMismatchException.class=$OUT/rt/org/teavm/classlib/java/util/TInputMismatchException.class"
node "$HERE/classlib-archive.mjs" put "$DIST/compile-classlib-teavm.bin" "$ROOT/public/java/compile-classlib.bin" \
    "java/util/Scanner.class=$OUT/sdk/java/util/Scanner.class" \
    "java/util/InputMismatchException.class=$OUT/sdk/java/util/InputMismatchException.class"

# ThreadGroup을 받는 Thread 생성자 추가 (클래스 파일을 직접 고침)
node "$HERE/patch-thread.mjs"

cp "$DIST/compiler.wasm" "$ROOT/public/java/compiler.wasm"
cp "$DIST/compiler.wasm-runtime.js" "$ROOT/vendor/teavm/wasm-runtime.js"
echo "완료: public/java/, vendor/teavm/wasm-runtime.js"
