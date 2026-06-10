"""PeroPixComfy — ComfyUI-powered dedicated frontend for Anima workflows.

Registers no graph nodes; everything lives behind HTTP routes on ComfyUI's
own aiohttp server (see server/routes.py).
"""

NODE_CLASS_MAPPINGS = {}
NODE_CLASS_DISPLAY_NAME_MAPPINGS = {}

from .server import routes as _routes  # noqa: E402,F401  (route registration side effect)
