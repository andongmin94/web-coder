# 기술 구조

## 런타임 구성

- `manifest.ts`: MV3 매니페스트 정의
- `main.ts`: content script 진입점
- `baekjoon/scripts/main.tsx`: `/submit` 페이지 판별
- `baekjoon/scripts/submit.tsx`: React SolveView 마운트
- `background.ts`: 실행 요청 처리 및 언어별 백엔드 라우팅
- `popup.tsx`: 실행 방식 안내 UI (외부 API 키 불필요)

## 핵심 흐름

### 1) 페이지 주입

1. content script가 BOJ 도메인에서 실행
2. `/submit` 경로면 `customSubmitPage()` 호출
3. `#submit_form` 존재를 확인한 뒤 커스텀 루트(`#webcoder-solve-root`) 렌더링
4. 원래 폼은 DOM에 유지하되 CSS로 숨김 처리

### 2) 실행

1. SolveView에서 언어 ID/코드/입력값으로 컴파일 요청 생성
2. `chrome.runtime.sendMessage({ action: 'compile' })` 전송
3. background service worker가 언어별 실행 백엔드를 선택
   - `cpp17`, `python3`: 로컬 WebAssembly 런타임 실행
   - `rust`, `java`: Piston API(`<https://emkc.org/api/v2/piston/execute>`) 호출
4. 실행 결과를 후처리 후 테스트 패널에 반영

### 3) 제출

1. 현재 코드/언어/공개 설정/토큰을 조합
2. 원본 hidden 필드를 최대한 보존한 분리 form(detached form) 생성
3. BOJ 제출 endpoint로 POST

## 저장 키(`chrome.storage.local`)

| 키 | 설명 |
| --- | --- |
| `andongmin-web-coder-editor-save-<suffix>` | 코드 + 언어 |
| `andongmin-web-coder-test-case-<problemId>` | 커스텀 테스트 케이스 |
| `andongmin-web-coder-editor-theme-` | 에디터 테마 |
| `andongmin-web-coder-default-language-` | 기본 언어 ID |
| `andongmin-web-coder-problem-save` | 문제 HTML 캐시 |
| `andongmin-web-coder-problem-style-save` | MathJax 스타일 캐시 |

## 코드 기준 주요 파일

- `packages/src/manifest.ts`
- `packages/src/main.ts`
- `packages/src/background.ts`
- `packages/src/popup.tsx`
- `packages/src/baekjoon/scripts/submit.tsx`
- `packages/src/baekjoon/containers/SolveView/SolveView.tsx`
- `packages/src/baekjoon/utils/storage/editor.ts`
