# Python 런타임

웹 코더의 Python 3 실행은 CPython의 WASI 빌드를 씁니다.

| 파일                                | 내용                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `public/wasm/python-3.13.17.wasm`   | CPython 3.13.17 인터프리터 (디버그 정보를 뺀 것)            |
| `public/wasm/python-3.13.17.tar.gz` | 표준 라이브러리 (`/usr/local/lib/python3.13`, `.py` 그대로) |
| `public/wasm/python-LICENSE.txt`    | CPython 라이선스 (PSF License)                              |

## 출처

CPython 코어 개발자 Brett Cannon이 CPython 릴리스마다 공식 빌드 스크립트로 만들어 올리는
[cpython-wasi-build](https://github.com/brettcannon/cpython-wasi-build)의 `v3.13.17` 릴리스,
`python-3.13.17-wasi_sdk-24.zip`입니다. 압축을 풀면 `python.wasm`과 `lib/python3.13/`이 나옵니다.

## 다시 만들기

```bash
curl -LO https://github.com/brettcannon/cpython-wasi-build/releases/download/v3.13.17/python-3.13.17-wasi_sdk-24.zip
unzip -q python-3.13.17-wasi_sdk-24.zip -d py
```

1. **인터프리터**: `py/python.wasm`(약 28MB)에서 이름이 `.debug`로 시작하는 custom 섹션을 지웁니다. (약 7.5MB)
   코드와 데이터 섹션은 그대로입니다.
2. **표준 라이브러리**: `py/lib/python3.13`을 `usr/local/lib/python3.13`으로 옮기고(빌드의 prefix가 `/usr/local`),
   풀이에 쓰지 않는 `pydoc_data`, `turtle.py`를 지운 뒤, 빈 파일 `lib-dynload/.empty`를 만듭니다.
   (이 폴더가 없으면 시작할 때마다 stderr에 경고가 찍힙니다)
3. `tar czf python-3.13.17.tar.gz usr`

버전을 바꾸면 `src/runner/python.ts`의 파일 이름과 `src/runner/tar.test.ts`를 같이 고칩니다.

## 알려진 한계

- `zlib` 모듈이 없습니다. (이 빌드에 포함되지 않음)
- `lru_cache`를 붙인 함수처럼 C 코드를 거치는 재귀는 깊이 약 1,600에서 `RecursionError`가 납니다.
  WASI 빌드에 고정된 C 재귀 제한이라 `sys.setrecursionlimit`으로 늘릴 수 없습니다. (네이티브 CPython은 약 10,000)
  순수 Python 함수의 재귀는 `sys.setrecursionlimit`만큼 됩니다. (70만까지 확인)
- 네이티브 CPython보다 느립니다.
