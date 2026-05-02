# 시작하기

웹 코더는 백준(BOJ) 제출 페이지(`/submit`)에 커스텀 문제 풀이 화면을 주입하는 Chrome 확장입니다.

한 화면에서 아래 작업을 처리할 수 있습니다.

- 문제 본문 확인
- 코드 작성 및 문법 하이라이팅
- 샘플/사용자 테스트 케이스 실행
- BOJ 제출

## 빠른 이동

- [설치 및 빌드](./install.md)
- [사용 가이드](./usage.md)
- [기술 구조](./architecture.md)
- [문제 해결](./troubleshooting.md)

## 지원 환경

- 브라우저: Chrome (Manifest V3)
- 대상 페이지: `https://www.acmicpc.net/*`, `https://boj.kr/*`
- 동작 경로: `/submit` 경로에서만 커스텀 UI 활성화

## 지원 언어

| BOJ 언어 ID | 언어 | 내부 실행 키 | 실행 백엔드 |
| --- | --- | --- | --- |
| `95` | C++20 | `cpp17` | 로컬 WebAssembly |
| `93` | Java 11 | `java` | Piston API |
| `28` | Python 3 | `python3` | 로컬 WebAssembly |
| `116` | Rust 2024 | `rust` | Piston API |

언어 매핑 상세는 `packages/src/baekjoon/utils/language.ts`에서 관리합니다.
