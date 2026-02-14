# 설치 및 빌드

## 1) 의존성 설치

레포 루트에서 `packages`로 이동한 뒤 설치합니다.

```bash
cd packages
npm install
```

## 2) 확장 빌드

```bash
npm run build
```

빌드 결과물은 `packages/dist`에 생성됩니다.

## 3) Chrome에 로드

1. Chrome에서 `chrome://extensions` 접속
2. 우측 상단 `개발자 모드` 활성화
3. `압축해제된 확장 프로그램을 로드` 클릭
4. `packages/dist` 디렉터리 선택

코드를 수정한 뒤에는 `npm run build`를 다시 실행하고 확장 목록에서 새로고침하면 됩니다.

## 4) 팝업 확인 (선택)

별도 API 키 설정은 필요하지 않습니다.

팝업에서는 현재 실행 방식 안내만 확인하면 됩니다.

동작이 이전 상태로 보이면 확장 프로그램을 다시 로드하고 BOJ 탭을 새로고침하세요.
