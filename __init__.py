"""PeroPixComfy — ComfyUI-powered dedicated frontend for Anima workflows.

Registers no graph nodes; everything lives behind HTTP routes on ComfyUI's
own aiohttp server (see server/routes.py).
"""

NODE_CLASS_MAPPINGS = {}
NODE_CLASS_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web_extension"  # ComfyUI 사이드바 런처 (web/은 SPA라서 분리)

from .server import routes as _routes  # noqa: E402,F401  (route registration side effect)
