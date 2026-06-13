# 로컬 개발 및 빌드

이 문서는 웹 코더를 직접 수정하거나 테스트하려는 개발자를 위한 안내입니다.

일반 사용자는 Chrome 웹 스토어 설치만으로 충분합니다.

## 1) 의존성 설치

레포 루트에서 `packages` 폴더로 이동한 뒤 패키지를 설치합니다.

```bash
cd packages
npm install
```

## 2) 확장 빌드

개발 중에는 아래 명령으로 타입 검사와 빌드를 확인하면 됩니다.

```bash
npm run typecheck
npx vite build
```

배포용 빌드는 버전 스크립트까지 포함된 아래 명령을 사용합니다.

```bash
npm run build
```

빌드 결과물은 `packages/dist`에 생성됩니다.

## 3) Chrome에 로드

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 우측 상단의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드**를 클릭합니다.
4. `packages/dist` 폴더를 선택합니다.

## 4) 변경 사항 반영

소스를 수정했다면 다시 빌드한 뒤 다음 순서로 확인합니다.

1. 확장 관리 페이지에서 웹 코더를 새로고침합니다.
2. BOJ 탭을 새로고침합니다.
3. `/submit` 페이지에서 UI와 실행 흐름을 다시 확인합니다.

## 5) 문서 사이트 빌드

문서 프로젝트는 `docs` 폴더의 VitePress 사이트입니다.

```bash
cd ../docs
npm install
npm run docs-build
```

로컬 미리보기 개발 서버는 아래 명령으로 실행할 수 있습니다.

```bash
npm run docs
```
