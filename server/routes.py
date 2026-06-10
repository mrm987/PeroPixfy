"""HTTP routes wired into ComfyUI's aiohttp server.

Only this module imports ComfyUI internals (server), so the rest of the
plugin stays testable in isolation.
"""

import os

from aiohttp import web
from server import PromptServer

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(PLUGIN_DIR, "web")

routes = PromptServer.instance.routes


@routes.get("/peropix")
async def index(request):
    return web.FileResponse(os.path.join(WEB_DIR, "index.html"))


@routes.get("/peropix/assets/{path:.*}")
async def assets(request):
    base = os.path.normpath(os.path.join(WEB_DIR, "assets"))
    full = os.path.normpath(os.path.join(base, request.match_info["path"]))
    if not full.startswith(base + os.sep) or not os.path.isfile(full):
        raise web.HTTPNotFound()
    return web.FileResponse(full)
