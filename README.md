# PeroPixComfy

ComfyUI 엔진을 그대로 사용하는 Anima 전용 경량 프론트엔드 플러그인.

노드 그래프 UI 대신 단순한 3탭 웹앱(`http://127.0.0.1:8188/peropix`)으로 작업하며,
생성은 같은 서버의 큐·그래프 실행기를 거치므로 **결과물이 ComfyUI와 픽셀 단위로 동일**하다
(t2i / 로라 체인+bypass / i2i 세 케이스 모두 픽셀 비교로 검증됨 — `ui/scripts/verify_*.ts`).

## 실행

**기본**: 평소 쓰던 bat(예: run_nvidia_gpu_SageAttention.bat)으로 ComfyUI를 띄우고,
사이드바의 **PeroPix 탭**을 누르면 전체화면으로 전환된다 (`← ComfyUI` 버튼 또는 ESC로 복귀).
ComfyUI ↔ PeroPix를 오가도 양쪽 상태(노드 그래프·생성 진행)는 유지된다.
`http://127.0.0.1:8188/peropix` 직접 접속도 가능 (런처는 web_extension/, 본체와 독립).

**옵션**: `scripts\run_peropix.bat` — 린 프로파일(`--disable-all-custom-nodes
--whitelist-custom-nodes PeroPixComfy comfyui-spectrum-ksampler comfyui-spectrum-sdxl
ComfyUI_UltimateSDUpscale` + SageAttention 플래그). 커스텀노드 임포트만 줄이는 것이라
시작 시간 이득은 제한적 (대부분 로라 로딩 시간).

## 탭 구성

- **라이브러리** — 로라/스타일 관리. ComfyUI-Style-Manager의 백엔드 모듈을 `server/library/`로
  이식(vendoring)했고, 첫 실행 시 기존 Style-Manager의 data/(loras.db·썸네일·스타일)를 1회 임포트한다.
  스타일 클릭 → 작업대에 프롬프트·로라 스택·해상도 적용.
- **작업대** — 한 장씩 디테일 깎기. 로라 스택(on/off·강도·순서), 시드 고정/랜덤, 해상도 프리셋,
  고급 설정 접기, 세션 히스토리(영속), i2i / 인페인트(브러시 마스크) / hires fix(2-pass 또는 USDU),
  Spectrum 가속 토글(~2-3x).
- **배치** — 작업대 설정 기반 변형 목록 × 수량 대량 생성. 동시 2개 슬라이딩 윈도우 제출,
  슬롯 그리드, 클릭 확정(갤러리 별표 연동), 중단.

## 구조

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
scripts/               run_peropix.bat, compare.py (픽셀 비교)
```

## 개발

```
cd ui
npm install
npm run dev        # Vite dev 서버 (8188로 프록시) — ComfyUI가 떠 있어야 함
npm run build      # 타입체크 + web/ 빌드
npm run verify:m1  # 동일성 검증 (t2i) — m2(로라 체인), m6(i2i/inpaint/hires), m7(spectrum)
```

핵심 설계: 생성 파라미터의 단일 진실 공급원은 `GenerationParams`(`ui/src/workflow/types.ts`).
그래프는 항상 `buildGraph()`(`ui/src/workflow/builder.ts`)로 재생성하며, bypass 로라는
노드 생략 + MODEL 링크 직결로 표현한다. 기록·재현은 그래프가 아닌 params를 저장한다.

W:\ ComfyUI custom_nodes에는 디렉터리 정션으로 연결되어 있다:
`W:\...\ComfyUI\custom_nodes\PeroPixComfy → D:\ClaudeCode\PeroPixComfy`
