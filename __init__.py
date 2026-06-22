"""PeroPixComfy — ComfyUI-powered dedicated frontend for Anima workflows.

Registers no graph nodes; everything lives behind HTTP routes on ComfyUI's
own aiohttp server (see server/routes.py).
"""

from .nodes import NODE_CLASS_DISPLAY_NAME_MAPPINGS, NODE_CLASS_MAPPINGS  # noqa: F401

# Spectrum(가속+Mod Guidance+SMC-CFG) 노드를 외부 의존이 아니라 벤더링(고정 버전)으로
# 내장한다 — 업스트림 버전업이 사용자 환경을 예고 없이 깨뜨리는 일을 막고, 단일 플러그인
# 배포가 가능하다. 갱신은 scripts/update_spectrum.py로 우리가 원할 때만. (MIT, vendor/spectrum/LICENSE)
SPECTRUM_VERSION = "2.5.2"
try:
    from .vendor.spectrum import NODE_CLASS_MAPPINGS as _SPECTRUM_NODES
    from .vendor.spectrum import NODE_DISPLAY_NAME_MAPPINGS as _SPECTRUM_DISPLAY
    NODE_CLASS_MAPPINGS.update(_SPECTRUM_NODES)
    NODE_CLASS_DISPLAY_NAME_MAPPINGS.update(_SPECTRUM_DISPLAY)
except Exception as e:  # 벤더 노드가 깨져도 플러그인 본체(UI/생성)는 계속 동작.
    print(f"[PeroPixComfy] vendored Spectrum nodes unavailable: {e}")

# ComfyUI는 NODE_DISPLAY_NAME_MAPPINGS 이름으로 읽으므로 별칭으로 노출.
NODE_DISPLAY_NAME_MAPPINGS = NODE_CLASS_DISPLAY_NAME_MAPPINGS  # noqa: F401

WEB_DIRECTORY = "./web_extension"  # ComfyUI 사이드바 런처 (web/은 SPA라서 분리)

from .server import routes as _routes  # noqa: E402,F401  (route registration side effect)
