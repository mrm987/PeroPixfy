# PeroPixfy

[English](#english) | [한국어](#한국어)

A lightweight, Anima-only frontend plugin that runs on the ComfyUI engine itself.

---

## English

Instead of the node-graph UI, you work in a simple 3-tab web app (`http://127.0.0.1:8188/peropix`). Generation goes through the **same server's queue and graph executor**, so output is **pixel-identical to ComfyUI** (verified by pixel comparison for t2i / LoRA chain + bypass / i2i).

### Install

**One-click (Windows portable):** download [`peropixfy_install.bat`](peropixfy_install.bat), drop it in your ComfyUI portable root (the folder that contains `ComfyUI\` and `python_embeded\`), and double-click — it clones + installs the dependency. To update later, put [`peropixfy_update.bat`](peropixfy_update.bat) in the same folder and run it (it does `git pull` + deps), then restart ComfyUI.

Or manually:

```
cd ComfyUI/custom_nodes
git clone https://github.com/mrm987/PeroPixfy.git
<ComfyUI>/python_embeded/python.exe -m pip install -r PeroPixfy/requirements.txt   # color-matcher
```

The built `web/` is bundled, so it runs without a separate build step. `data/` (presets, gallery, settings) is created on first run. Restart ComfyUI, then open the **PeroPixfy tab** in the sidebar.

> For development you can link a separate working folder into `custom_nodes` with a directory junction (`mklink /J ...\custom_nodes\PeroPixfy  <work folder>`).

### Run

**Default**: launch ComfyUI with your usual bat, then click the **PeroPixfy tab** in the sidebar to switch to fullscreen (`← ComfyUI` button or ESC to return). Direct access at `http://127.0.0.1:8188/peropix` also works (the launcher lives in `web_extension/`, independent of the app).

**Lean (optional)**: `scripts\run_peropix.bat` — a lean profile (`--disable-all-custom-nodes --whitelist-custom-nodes PeroPixfy` + SageAttention flags). Spectrum is vendored into PeroPixfy and loads with it. This only trims custom-node imports, so the startup gain is limited (most of the time is LoRA loading).

### Tabs

- **Library** — LoRA/style management. The ComfyUI-Style-Manager backend modules are vendored into `server/library/`; on first run it imports your existing Style-Manager data (loras.db, thumbnails, styles) once. Click a style → applies its prompt, LoRA stack, and resolution to the workbench.
- **Workbench** — single-image detailing. LoRA stack (on/off · strength · order), fixed/random seed, resolution presets, collapsible advanced settings, persistent session history, i2i / inpaint (brush mask) / hires fix (2-pass or USDU), Spectrum acceleration toggle (~2-3x).
- **Batch** — bulk generation of a variation list × count from the workbench settings. Two-at-a-time sliding-window submission, slot grid, click-to-curate (synced with gallery stars), cancel.

### Structure

```
__init__.py            ComfyUI plugin entry (no graph nodes — routes only)
server/
  routes.py            serves the /peropix SPA + gallery/settings API (ComfyUI deps isolated here)
  library/             vendored Style-Manager py/ — prefix /peropix/api/library/*
  gallery.py           generations table (generation records)
  migrate.py           one-time import of Style-Manager data/
ui/                    React+TS+Vite source → `npm run build` → web/
web/                   build output (served statically by routes.py)
data/                  loras.db, thumbs/, styles/, settings.json (git-ignored)
scripts/               run_peropix.bat (lean launcher)
```

### Development

```
cd ui
npm install
npm run dev        # Vite dev server (proxies to 8188) — ComfyUI must be running
npm run build      # type-check + build web/
```

Core design: the single source of truth for generation parameters is `GenerationParams` (`ui/src/workflow/types.ts`). The graph is always rebuilt via `buildGraph()` (`ui/src/workflow/builder.ts`); a bypassed LoRA is expressed by omitting the node and linking MODEL through directly. Records/reproduction store the params, not the graph.

---

## 한국어

ComfyUI 엔진을 그대로 사용하는 Anima 전용 경량 프론트엔드 플러그인.

노드 그래프 UI 대신 단순한 3탭 웹앱(`http://127.0.0.1:8188/peropix`)으로 작업하며,
생성은 같은 서버의 큐·그래프 실행기를 거치므로 **결과물이 ComfyUI와 픽셀 단위로 동일**하다
(t2i / 로라 체인+bypass / i2i 세 케이스 모두 픽셀 비교로 검증됨).

### 설치

**원클릭(Windows 포터블):** [`peropixfy_install.bat`](peropixfy_install.bat)를 받아 ComfyUI 포터블 루트(`ComfyUI\`·`python_embeded\`가 있는 폴더)에 두고 더블클릭 — clone + 의존성 설치. 이후 업데이트는 같은 폴더에 [`peropixfy_update.bat`](peropixfy_update.bat)을 두고 실행(`git pull` + 의존성)한 뒤 ComfyUI를 재시작.

또는 수동으로:

```
cd ComfyUI/custom_nodes
git clone https://github.com/mrm987/PeroPixfy.git
<ComfyUI>/python_embeded/python.exe -m pip install -r PeroPixfy/requirements.txt   # color-matcher
```

`web/`가 빌드 산출물로 함께 들어있어 별도 빌드 없이 동작한다. `data/`(프리셋·갤러리·설정)는
첫 실행 시 자동 생성된다. ComfyUI 재시작 후 사이드바 **PeroPixfy 탭**.

> 개발 시에는 별도 작업 폴더를 custom_nodes에 디렉터리 정션으로 연결해 쓰기도 한다
> (`mklink /J ...\custom_nodes\PeroPixfy  <작업폴더>`).

### 실행

**기본**: 평소 쓰던 bat(예: run_nvidia_gpu_SageAttention.bat)으로 ComfyUI를 띄우고,
사이드바의 **PeroPixfy 탭**을 누르면 전체화면으로 전환된다 (`← ComfyUI` 버튼 또는 ESC로 복귀).
`http://127.0.0.1:8188/peropix` 직접 접속도 가능 (런처는 web_extension/, 본체와 독립).

**린(옵션)**: `scripts\run_peropix.bat` — 린 프로파일(`--disable-all-custom-nodes
--whitelist-custom-nodes PeroPixfy` + SageAttention 플래그). Spectrum은 PeroPixfy에 벤더링돼
함께 로드된다. 커스텀노드 임포트만 줄이는 것이라 시작 시간 이득은 제한적 (대부분 로라 로딩 시간).

### 탭 구성

- **라이브러리** — 로라/스타일 관리. ComfyUI-Style-Manager의 백엔드 모듈을 `server/library/`로
  이식(vendoring)했고, 첫 실행 시 기존 Style-Manager의 data/(loras.db·썸네일·스타일)를 1회 임포트한다.
  스타일 클릭 → 작업대에 프롬프트·로라 스택·해상도 적용.
- **작업대** — 한 장씩 디테일 깎기. 로라 스택(on/off·강도·순서), 시드 고정/랜덤, 해상도 프리셋,
  고급 설정 접기, 세션 히스토리(영속), i2i / 인페인트(브러시 마스크) / hires fix(2-pass 또는 USDU),
  Spectrum 가속 토글(~2-3x).
- **배치** — 작업대 설정 기반 변형 목록 × 수량 대량 생성. 동시 2개 슬라이딩 윈도우 제출,
  슬롯 그리드, 클릭 확정(갤러리 별표 연동), 중단.

### 구조

```
__init__.py            ComfyUI 플러그인 진입점 (노드 등록 없음, 라우트만)
server/
  routes.py            /peropix SPA 서빙 + 갤러리·설정 API (ComfyUI 의존은 여기로 격리)
  library/             Style-Manager py/ 이식본 — prefix /peropix/api/library/*
  gallery.py           generations 테이블 (생성 기록)
  migrate.py           Style-Manager data/ 1회 임포트
ui/                    React+TS+Vite 소스 → `npm run build` → web/
web/                   빌드 산출물 (routes.py가 정적 서빙)
data/                  loras.db, thumbs/, styles/, settings.json (git 제외)
scripts/               run_peropix.bat (린 실행 런처)
```

### 개발

```
cd ui
npm install
npm run dev        # Vite dev 서버 (8188로 프록시) — ComfyUI가 떠 있어야 함
npm run build      # 타입체크 + web/ 빌드
```

핵심 설계: 생성 파라미터의 단일 진실 공급원은 `GenerationParams`(`ui/src/workflow/types.ts`).
그래프는 항상 `buildGraph()`(`ui/src/workflow/builder.ts`)로 재생성하며, bypass 로라는
노드 생략 + MODEL 링크 직결로 표현한다. 기록·재현은 그래프가 아닌 params를 저장한다.
