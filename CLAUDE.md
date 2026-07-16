# PeroPixfy

ComfyUI 커스텀 노드. 노드 그래프 없이 Anima 모델로 이미지를 생성하는 UI(React/TS, `ui/`) + Python 백엔드(`server/`).

## 개발·테스트 — H 드라이브 설치본에 반영

로컬 테스트는 **H 드라이브의 실제 ComfyUI 설치본**에서 한다. dev 저장소(`D:\ClaudeCode\PeroPixComfy`)만 고치면 반영되지 않으므로, 수정 후 **항상 설치본에도 복사한다**:

```
H:\ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\PeroPixfy
```

- **UI 빌드:** `ui/`에서 `npm run build` → `web/`으로 산출.
- **`web/`은 통째로 미러할 것.** 자산 파일명이 해시(`index-<hash>.js`)라 `index.html`과 짝이 맞아야 한다. 개별 파일만 복사하면 index.html이 없는 번들을 가리켜 **검은 화면**이 된다.
- 변경한 소스 파일도 같은 상대경로로 함께 복사(설치본이 dev와 동일 트리 구조).
- 반영 후 브라우저는 강력 새로고침(Ctrl+Shift+R) — 이전 번들이 캐시될 수 있다.

### 노드 스키마 확인

ComfyUI 서버는 보통 `127.0.0.1:8188`. 그래프를 만들 땐 노드 스키마를 실제 서버에서 확인한다:

```
GET /object_info/<NodeName>
```

주의: **없는 노드도 HTTP 200 + 빈 `{}`를 반환**한다. 설치 여부는 상태코드가 아니라 **본문이 비었는지**로 판정할 것.

## 배포 — ComfyUI 레지스트리

실제 배포처는 ComfyUI 레지스트리(PyPI 아님):

https://registry.comfy.org/publishers/mrm987/nodes/peropixfy

현재 **1.3.0** (네 번째 게시).

### 릴리스 절차

1. 버전을 **두 곳 같은 값으로** 올린다 — `pyproject.toml`의 `version`, `__init__.py`의 `__version__`.
2. `main`에 push.
3. [.github/workflows/publish.yml](.github/workflows/publish.yml)이 `pyproject.toml` 변경을 감지해 자동 게시(`Comfy-Org/publish-node-action`). Actions 탭에서 수동 실행(`workflow_dispatch`)도 가능.

- **인증:** 저장소 Secret `REGISTRY_ACCESS_TOKEN` (registry.comfy.org에서 발급한 `pat-***`). 1회 설정이며 이미 되어 있음.
- `pyproject.toml`의 `[tool.comfy] PublisherId = "mrm987"`가 레지스트리 퍼블리셔와 일치해야 한다.
- 수동 대안: `comfy node publish` — https://docs.comfy.org/registry/publishing
