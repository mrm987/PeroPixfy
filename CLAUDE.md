# PeroPixfy

ComfyUI 커스텀 노드. 노드 그래프 없이 Anima 모델로 이미지를 생성하는 UI(React/TS, `ui/`) + Python 백엔드(`server/`).

## 개발·테스트 — H 드라이브 설치본에 반영

로컬 테스트는 **H 드라이브의 실제 ComfyUI 설치본**에서 한다. dev 저장소(`D:\ClaudeCode\PeroPixfy`)만 고치면 반영되지 않으므로, 수정 후 **항상 설치본에도 복사한다**:

```
H:\ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\PeroPixfy
```

- **UI 빌드:** `ui/`에서 `npm run build` → `web/`으로 산출.
- **`web/`은 통째로 미러할 것.** 자산 파일명이 해시(`index-<hash>.js`)라 `index.html`과 짝이 맞아야 한다. 개별 파일만 복사하면 index.html이 없는 번들을 가리켜 **검은 화면**이 된다.
- 변경한 소스 파일도 같은 상대경로로 함께 복사(설치본이 dev와 동일 트리 구조).
- 반영 후 브라우저는 강력 새로고침(Ctrl+Shift+R) — 이전 번들이 캐시될 수 있다.

### ★`libraryEngine.js`의 CSS는 템플릿 리터럴 안이다

라이브러리 패널의 스타일 전체가 `const STYLE = ` 로 시작하는 **백틱 문자열 한 덩어리**다
(`ui/src/library/libraryEngine.js`, 약 27,000자). 그래서 그 안에서는 **주석까지 포함해
백틱과 `${` 를 쓸 수 없다.** 하나라도 들어가면 문자열이 그 자리에서 끊긴다.

- 증상이 CSS 오류로 안 나온다. 끊긴 뒤의 CSS가 JS로 파싱되면서 **엉뚱한 문법 오류**가 뜬다
  (실제: `error TS1005: ',' expected`). 원인을 CSS에서 찾으면 시간을 버린다.
- 주석에서 셀렉터나 속성을 인용할 땐 백틱 대신 그냥 적는다 — `.lm-card + .lm-card` (X)
  → .lm-card 인접 형제 (O).
- 의심되면 빌드 전에 확인: `const STYLE` 다음 백틱부터 다음 백틱까지 잘라 길이와
  `${` 개수(0이어야 정상)를 찍어 본다.

### 노드 스키마 확인

ComfyUI 서버는 보통 `127.0.0.1:8188`. 그래프를 만들 땐 노드 스키마를 실제 서버에서 확인한다:

```
GET /object_info/<NodeName>
```

주의: **없는 노드도 HTTP 200 + 빈 `{}`를 반환**한다. 설치 여부는 상태코드가 아니라 **본문이 비었는지**로 판정할 것.

## 배포 — ComfyUI 레지스트리

실제 배포처는 ComfyUI 레지스트리(PyPI 아님):

https://registry.comfy.org/publishers/mrm987/nodes/peropixfy

현재 버전은 `pyproject.toml`의 `version`이 기준값이다 — 이 문서에 숫자를 적어 두지 말 것(릴리스마다 어긋난다).
게시 이력은 위 레지스트리 페이지와 Actions 탭에서 본다.

### 릴리스 절차

1. 버전을 **두 곳 같은 값으로** 올린다 — `pyproject.toml`의 `version`, `__init__.py`의 `__version__`.
2. `main`에 push.
3. [.github/workflows/publish.yml](.github/workflows/publish.yml)이 `pyproject.toml` 변경을 감지해 자동 게시(`Comfy-Org/publish-node-action`). Actions 탭에서 수동 실행(`workflow_dispatch`)도 가능.

- **인증:** 저장소 Secret `REGISTRY_ACCESS_TOKEN` (registry.comfy.org에서 발급한 `pat-***`). 1회 설정이며 이미 되어 있음.
- `pyproject.toml`의 `[tool.comfy] PublisherId = "mrm987"`가 레지스트리 퍼블리셔와 일치해야 한다.
- 수동 대안: `comfy node publish` — https://docs.comfy.org/registry/publishing
