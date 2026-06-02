# 기술 구조

이 문서에서는 웹 코더가 내부적으로 어떻게 동작하는지 살펴보겠습니다.

확장 개발에 기여하거나, 동작 원리를 이해하고 싶은 분들을 위한 페이지입니다.

## 런타임 구성

웹 코더는 Chrome Manifest V3 확장으로, 크게 content script · background service worker · popup의 세 부분으로 구성됩니다.

| 파일 | 역할 |
| --- | --- |
| `manifest.ts` | MV3 매니페스트 정의 |
| `main.ts` | content script 진입점 — BOJ 페이지에 주입되는 코드의 시작점입니다 |
| `baekjoon/scripts/main.tsx` | `/submit` 페이지인지 판별하고 커스텀 UI 진입을 결정합니다 |
| `baekjoon/scripts/submit.tsx` | React 기반 SolveView 컴포넌트를 DOM에 마운트합니다 |
| `background.ts` | 코드 실행 요청을 받아 언어별 백엔드로 라우팅합니다 |
| `popup.tsx` | 확장 아이콘 클릭 시 나타나는 팝업 UI입니다 (외부 API 키 불필요) |

## 핵심 흐름

웹 코더의 동작은 크게 **페이지 주입 → 코드 실행 → 제출**의 세 단계로 나눌 수 있습니다.

### 1) 페이지 주입

BOJ 제출 페이지에 커스텀 UI가 어떻게 나타나는지 단계별로 살펴보겠습니다.

1. content script가 BOJ 도메인(`acmicpc.net`, `boj.kr`)에서 자동 실행됩니다.
2. 현재 경로가 `/submit`이면 `customSubmitPage()` 함수를 호출합니다.
3. 기존 `#submit_form`이 DOM에 존재하는지 확인한 뒤, 커스텀 루트 요소(`#webcoder-solve-root`)를 렌더링합니다.
4. 원래 폼은 DOM에서 제거하지 않고 CSS로 숨김 처리합니다 — 제출 시 원본 폼의 hidden 필드를 활용하기 위해서입니다.

### 2) 실행

**실행** 버튼을 누르면 다음과 같은 흐름으로 코드가 실행됩니다.

1. SolveView 컴포넌트가 언어 ID·코드·입력값을 모아 컴파일 요청을 생성합니다.
2. `chrome.runtime.sendMessage({ action: 'compile' })`로 background에 메시지를 전송합니다.
3. background service worker가 언어에 따라 적절한 실행 백엔드를 선택합니다.
   - `cpp17`, `python3` → **로컬 WebAssembly** 런타임에서 실행
   - `rust`, `java` → **Piston API**(`<https://emkc.org/api/v2/piston/execute>`)를 호출
4. 실행 결과를 후처리한 뒤 테스트 패널에 반영합니다.

### 3) 제출

**제출** 버튼을 누르면 BOJ에 코드가 전송됩니다.

1. 현재 코드·언어·공개 설정·CSRF 토큰 등을 조합합니다.
2. 원본 hidden 필드를 최대한 보존한 **분리 form(detached form)**을 생성해서 BOJ에 제출합니다.
3. 분리 form 제출이 불가능한 경우에는 axios POST로 fallback 처리합니다.

## 저장 키 (`chrome.storage.local`)

웹 코더는 사용자 데이터를 `chrome.storage.local`에 저장합니다. 아래 표는 사용되는 주요 키 목록입니다.

| 키 | 설명 |
| --- | --- |
| `andongmin-web-coder-editor-save-<suffix>` | 코드 + 언어 (문제/수정 제출 단위로 저장) |
| `andongmin-web-coder-test-case-<problemId>` | 커스텀 테스트 케이스 |
| `andongmin-web-coder-editor-theme-` | 에디터 테마 설정 |
| `andongmin-web-coder-default-language-` | 기본 언어 ID |

문제별로 어떤 언어가 제출 가능한지는 실제 `#submit_form`의 언어 필드를 주기적으로 동기화해서 판단합니다.

## 코드 기준 주요 파일

소스 코드를 탐색할 때 아래 파일들을 중심으로 살펴보면 전체 구조를 빠르게 파악할 수 있습니다.

- `packages/src/manifest.ts`
- `packages/src/main.ts`
- `packages/src/background.ts`
- `packages/src/popup.tsx`
- `packages/src/baekjoon/scripts/submit.tsx`
- `packages/src/baekjoon/containers/SolveView/SolveView.tsx`
- `packages/src/baekjoon/utils/language.ts`
- `packages/src/baekjoon/utils/storage/editor.ts`
