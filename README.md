# 웹 코더

백준(BOJ) 제출 페이지에서 코드 작성, 테스트 실행, 제출을 더 편하게 하기 위한 크롬 확장입니다.

## 핵심 기능

- BOJ 제출 페이지(`/submit`) 자동 감지 후 커스텀 에디터 UI 렌더링
- C++ / Java / Python / Rust 코드 작성 및 테스트 실행
- BOJ 기본 제출 흐름 유지 (`제출` 버튼 연동)
- 팝업에서 JDoodle API 키 저장/변경/초기화
- 사용자 설정(`기본 언어`, `코드`, `테스트 케이스`, `테마`) 로컬 저장

## 지원 언어

| BOJ 언어 ID | 언어 | 실행 API 매핑 |
| --- | --- | --- |
| `95` | C++20 | `cpp17` (`versionIndex: 2`) |
| `93` | Java 11 | `java` (`versionIndex: 3`) |
| `28` | Python 3 | `python3` (`versionIndex: 5`) |
| `116` | Rust 2024 | `rust` (`versionIndex: 5`) |

## JDoodle API 키 발급

1. JDoodle 계정에 가입/로그인합니다.
2. API 대시보드에서 API 사용 플랜을 선택합니다.
3. Client ID / Client Secret을 발급받아 팝업에 입력합니다.

- 발급 가이드: `https://www.jdoodle.com/docs/compiler-apis/client-id-secret-key/`
- API 대시보드: `https://www.jdoodle.com/subscribe-api`
- API 시작 문서: `https://www.jdoodle.com/docs/compiler-apis/jdoodle-api-quickstart/`

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

## 팝업 설정

1. 확장 아이콘 클릭
2. `Client ID`, `Client Secret` 입력
3. `저장` 버튼 클릭
4. BOJ 제출 페이지에서 `실행` 버튼 사용

## 개발 스크립트

| 스크립트 | 설명 |
| --- | --- |
| `npm run watch` | 빌드 watch 모드 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run style` | 소스 포맷팅 |
