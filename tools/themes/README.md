# 에디터 테마 추출

`src/solver/theme-data.ts`는 이 PC에 설치된 편집기의 테마 파일에서 색을 뽑아 만든 파일입니다.

```bash
node tools/themes/extract.mjs
# 설치 위치가 기본값(%LOCALAPPDATA%\Programs)과 다르면
node tools/themes/extract.mjs --vscode <폴더> --idea <폴더> --rider <폴더>
```

| 묶음              | 읽는 곳                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| VS Code           | `resources/app/extensions/theme-*/` 의 내장 테마 (JSON)                            |
| JetBrains         | IntelliJ IDEA의 `lib/intellij.platform.resources.jar` 안 색 구성 (XML)             |
| Rider · ReSharper | Rider의 `plugins/rider-theme-pack` 안 색 구성 (XML)                                |
| Visual Studio     | 같은 Rider 테마 팩의 "Visual Studio Dark/Light" (JetBrains가 VS의 색을 옮겨 둔 것) |

테마 파일 자체는 저장소에 넣지 않고, 에디터에 필요한 색(배경, 글자, 선택 영역, 키워드, 문자열 등 십여 개)만 뽑습니다.

## 알아둘 것

- Visual Studio 묶음은 Visual Studio의 테마 파일을 직접 읽은 것이 아닙니다. (VS는 색을 `.pkgdef` 안에 이진 형식으로 담아 둠)
- 테마가 정하지 않은 값은 그 편집기의 기본값이나 배경·글자색을 섞은 값으로 채웁니다.
- 선택 영역 색이 배경과 반대 밝기면(진한 파랑에 흰 글자를 쓰는 테마) 옅게 바꿉니다. 이 에디터는 선택한 글자의 색을 바꾸지 않기 때문입니다.
- 색 값이 같아도 원본 편집기와 똑같이 보이지는 않습니다. 어떤 글자에 어떤 색을 입힐지는 문법 분석기가 정하는데, 이 에디터의 분석기가 더 단순합니다.
- 편집기를 업데이트한 뒤 다시 실행하면 테마가 늘거나 색이 바뀔 수 있습니다. 처음부터 있던 테마의 id는 `FIXED_IDS`로 고정해 저장된 설정이 깨지지 않게 합니다.
- GitHub, Dracula, Nord, One Dark는 여기서 뽑지 않고 `src/solver/themes.ts`에 직접 들어 있습니다.
