<div align="center">

<a href="https://web-coder.andongmin.com">
<img src="https://web-coder.andongmin.com/logo.svg" alt="logo" height="200" />
</a>

</div>

# 웹 코더

백준(BOJ) 제출 페이지에서 코드 작성, 테스트 실행, 제출을 더 편하게 하기 위한 크롬 확장입니다.

## 핵심 기능

- BOJ 제출 페이지(`/submit`) 자동 감지 후 커스텀 에디터 UI 렌더링
- C++ / Java / Python / Rust 코드 작성 및 테스트 실행
- 언어별 실행 백엔드 자동 라우팅
  - C++ / Python: 로컬 WebAssembly 실행
  - Rust / Java: Piston 실행 API 호출
- BOJ 기본 제출 흐름 유지 (`제출` 버튼 연동)
- 외부 API 키 설정 없이 즉시 사용
- 사용자 설정(`기본 언어`, `코드`, `테스트 케이스`, `테마`) 로컬 저장

## 지원 언어

| BOJ 언어 ID | 언어 | 내부 실행 키 | 실행 백엔드 |
| --- | --- | --- | --- |
| `84` | C++17 | `cpp17` | 로컬 WebAssembly |
| `93` | Java 11 | `java` | Piston API |
| `28` | Python 3 | `python3` | 로컬 WebAssembly |
| `116` | Rust 2024 | `rust` | Piston API |

## 실행 방식

- C++ / Python은 확장 내부 WASM 런타임에서 실행됩니다.
- Rust / Java는 Piston API(`<https://emkc.org/api/v2/piston/execute>`)를 사용합니다.
- 실행 결과는 background service worker에서 후처리되어 테스트 패널에 표시됩니다.

## 시작하기

```bash
npm install
npm run build
```

Chrome에서
1. `chrome://extensions` 접속
2. 개발자 모드 ON
3. `압축해제된 확장 프로그램 로드` 선택
4. 이 프로젝트의 `dist` 폴더 선택

## 팝업 안내

1. 확장 아이콘 클릭
2. 실행 방식 안내 문구 확인 (추가 키 입력 불필요)
3. BOJ 제출 페이지에서 `실행` 버튼 사용
4. 동작이 이전 상태로 보이면 확장 프로그램을 다시 로드하고 BOJ 탭을 새로고침

## 개발 스크립트

| 스크립트 | 설명 |
| --- | --- |
| `npm run watch` | 빌드 watch 모드 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run style` | 소스 포맷팅 |
