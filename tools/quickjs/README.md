# node.js 깊은 재귀 모드 (QuickJS)

node.js 코드는 sandbox 페이지의 V8 워커에서 실행합니다. 그런데 브라우저 워커의 호출 스택은 크기를
바꿀 수 없어서 재귀 깊이가 2,000~4,000쯤에서 `RangeError: Maximum call stack size exceeded`가 납니다.
백준은 node.js를 `node --stack-size=65536`으로 실행하므로 훨씬 깊은 재귀도 통과합니다.

그래서 스택이 넘치면 실행 워커에서 QuickJS로 다시 실행합니다. (`src/runner/node-deep.ts`)

- C 스택(선형 메모리)을 256MB로 잡아 직접 빌드한 QuickJS-ng를 씁니다.
  공식 `qjs-wasi.wasm`은 C 스택이 작아서 깊이 1만도 버티지 못합니다.
- 브라우저의 wasm 호출 스택 한계는 C++, Python과 같은 깊은 재귀 계측(`deep-stack.ts`, JSPI)으로 넘깁니다.
- 사용자 코드는 V8 실행과 같은 node.js shim(`src/runner/node-prelude.js.txt`)으로 돌립니다.
  QuickJS에 없는 `TextEncoder`, `TextDecoder`, 타이머는 `src/runner/node-deep-boot.js.txt`가 채웁니다.
- 깊이 약 60만까지 됩니다. 단순 재귀 30만이 0.15초쯤 걸립니다. (V8보다 수십 배 느림)

| 파일                              | 내용                                       |
| --------------------------------- | ------------------------------------------ |
| `public/wasm/quickjs-0.18.0.wasm` | QuickJS-ng 0.18.0 + `main.c` (WASI 실행기) |
| `public/wasm/quickjs-LICENSE.txt` | QuickJS 라이선스 (MIT)                     |
| `tools/quickjs/main.c`            | 실행기: std, os를 전역에 올리고 boot.js 실행 |
| `tools/quickjs/build.mjs`         | 빌드 스크립트                              |

## 다시 만들기

QuickJS-ng [v0.18.0 릴리스](https://github.com/quickjs-ng/quickjs/releases/tag/v0.18.0)의
`quickjs-amalgam.zip`(SHA-256 `6c05066a6b62b483e2ba0f83d7a16688c6958182b214bfd693529434cef84a9e`)을 풉니다.

```bash
curl -LO https://github.com/quickjs-ng/quickjs/releases/download/v0.18.0/quickjs-amalgam.zip
unzip -q quickjs-amalgam.zip -d quickjs-src
node tools/quickjs/build.mjs quickjs-src public/wasm/quickjs-0.18.0.wasm
```

컴파일러는 확장이 쓰는 YoWASP clang(`node_modules/@yowasp/clang`)을 node에서 실행하므로 따로 설치할 것이 없습니다.
(1분쯤 걸림) 버전을 바꾸면 `src/runner/node-deep.ts`의 파일 이름을 같이 고칩니다.

## 알려진 차이

- 에러 메시지 문구가 V8과 조금 다릅니다. (예: `cannot read property 'x' of null`)
- 메모리 사용량은 보여 주지 않습니다. (선형 메모리 대부분이 미리 잡은 C 스택이라 비교할 수 없음)
