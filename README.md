# PeroPixfy

> A simple, no-node-graph way to make images with the **Anima** model in ComfyUI.

**[English](#english)** · **[한국어](#한국어)**

---

## English

A simple, clean way to generate images with the **Anima** model in ComfyUI — without touching node graphs. Write a prompt, hit **Generate**.

### Install (Windows portable)

1. Download **[`peropixfy_install.bat`](https://github.com/mrm987/PeroPixfy/releases/latest/download/peropixfy_install.bat)** (from the [latest release](https://github.com/mrm987/PeroPixfy/releases/latest)).
2. Put it in your ComfyUI folder — the one that contains `ComfyUI` and `python_embeded`.
3. Double-click it and wait; it installs everything for you. *(Needs [Git for Windows](https://git-scm.com/download/win).)*
4. Restart ComfyUI.

### First run

Open the **PeroPixfy** tab in the ComfyUI sidebar — it switches to fullscreen (`← ComfyUI` or `ESC` to go back).

**No models yet?** On first run PeroPixfy offers to download the Anima models for you with one click, so even a brand-new, empty install works.

### What you can do

- **Single** — make one image at a time: pick a model, write your prompt, fine-tune it, redo details, and upscale for sharper results.
- **Multi** — generate a whole batch at once (a list of variations × how many each), then quickly keep the ones you like.
- **Library** — browse and organize your LoRAs and styles.

### Updating

Put **[`peropixfy_update.bat`](https://github.com/mrm987/PeroPixfy/releases/latest/download/peropixfy_update.bat)** in the same folder, double-click it, then restart ComfyUI. *(Re-running the installer also updates.)*

*Building from source, project layout, and internals → [Development](#development) below.*

## Development

PeroPixfy runs on the ComfyUI engine itself. Instead of the node graph you work in a web app served by ComfyUI's own server — normally opened from the **sidebar tab** (a fullscreen overlay; the address bar stays on the ComfyUI page), or reached directly at `http://127.0.0.1:8188/peropix`. Generation goes through the **same server's queue and graph executor**, so output is **pixel-identical to ComfyUI** (verified across t2i / LoRA chain + bypass / i2i).

### Manual install

```
cd ComfyUI/custom_nodes
git clone https://github.com/mrm987/PeroPixfy.git
<ComfyUI>/python_embeded/python.exe -m pip install -r PeroPixfy/requirements.txt   # color-matcher
```

The built `web/` is bundled, so it runs without a build step. `data/` (presets, gallery, settings) is created on first run.

> For development you can link a working folder into `custom_nodes` with a junction: `mklink /J ...\custom_nodes\PeroPixfy <work folder>`.

### Running

- **Default** — launch ComfyUI with your usual bat; the launcher (`web_extension/`) adds the sidebar tab. `http://127.0.0.1:8188/peropix` also works directly.
- **Lean (optional)** — `scripts\run_peropix.bat`: `--disable-all-custom-nodes --whitelist-custom-nodes PeroPixfy` (+ SageAttention). Spectrum is vendored, so it loads too. The gain is limited (most startup time is LoRA loading).

### Build from source

```
cd ui
npm install
npm run dev     # Vite dev server (proxies to 8188) — ComfyUI must be running
npm run build   # type-check + build web/
```

### Project structure

```
__init__.py   ComfyUI plugin entry (routes only — no graph nodes)
server/
  routes.py   serves the /peropix SPA + gallery/settings API (ComfyUI deps isolated here)
  library/    vendored Style-Manager — /peropix/api/library/*
  gallery.py  generations table (generation records)
  migrate.py  one-time import of existing Style-Manager data
ui/           React + TS + Vite source → npm run build → web/
web/          build output (served statically by routes.py)
data/         loras.db, thumbs/, styles/, settings.json (git-ignored)
scripts/      run_peropix.bat (lean launcher)
```

### Core design

The single source of truth for generation parameters is `GenerationParams` (`ui/src/workflow/types.ts`). The graph is always rebuilt via `buildGraph()` (`ui/src/workflow/builder.ts`); a bypassed LoRA is expressed by omitting the node and linking MODEL through directly. Records and reproduction store the params, not the graph.

---

## 한국어

ComfyUI에서 **Anima** 모델로 이미지를 만드는 가장 간단한 방법 — 복잡한 노드 그래프 없이, 프롬프트 쓰고 **생성**만 누르면 됩니다.

### 설치 (Windows 포터블)

1. **[`peropixfy_install.bat`](https://github.com/mrm987/PeroPixfy/releases/latest/download/peropixfy_install.bat)** 를 받습니다 ([최신 릴리즈](https://github.com/mrm987/PeroPixfy/releases/latest)).
2. ComfyUI 폴더(`ComfyUI`와 `python_embeded`가 들어있는 폴더)에 둡니다.
3. 더블클릭하고 기다리면 알아서 설치됩니다. *([Git for Windows](https://git-scm.com/download/win) 필요)*
4. ComfyUI를 재시작합니다.

### 첫 실행

ComfyUI 사이드바의 **PeroPixfy 탭**을 엽니다 — 전체화면으로 전환됩니다(`← ComfyUI` 또는 `ESC`로 복귀).

**모델이 하나도 없어도 됩니다.** 첫 실행 때 Anima 모델을 원클릭으로 받아줘서, 완전히 빈 새 설치에서도 바로 시작할 수 있어요.

### 할 수 있는 것

- **싱글** — 한 장씩 작업: 모델 고르고, 프롬프트 쓰고, 다듬고, 디테일 다시 뽑고, 더 선명하게 업스케일.
- **멀티** — 한 번에 여러 장 생성(변형 목록 × 장수), 마음에 드는 것만 골라 남기기.
- **라이브러리** — 내 로라·스타일을 둘러보고 정리.

### 업데이트

같은 폴더에 **[`peropixfy_update.bat`](https://github.com/mrm987/PeroPixfy/releases/latest/download/peropixfy_update.bat)** 을 두고 더블클릭한 뒤 ComfyUI를 재시작하면 됩니다. *(설치 bat을 재실행해도 업데이트됩니다.)*

*소스 빌드·프로젝트 구조·내부 동작 등 기술 내용은 위 [Development](#development) 섹션(영문) 참고.*
