"""HTTP routes wired into ComfyUI's aiohttp server.

Only this module imports ComfyUI internals (server), so the rest of the
plugin stays testable in isolation.
"""

import json
import os

from aiohttp import web
from server import PromptServer

from . import gallery
from .library import api as _library_api  # noqa: F401  (registers /peropix/api/library/*)

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(PLUGIN_DIR, "web")

gallery.init(os.path.join(PLUGIN_DIR, "data", "loras.db"))

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


@routes.post("/peropix/api/gallery/record")
async def gallery_record(request):
    data = await request.json()
    gallery.record(data["prompt_id"], json.dumps(data["params"], ensure_ascii=False))
    return web.json_response({"ok": True})


@routes.post("/peropix/api/gallery/complete")
async def gallery_complete(request):
    data = await request.json()
    gallery.complete(data["prompt_id"], data.get("files", []))
    return web.json_response({"ok": True})


@routes.post("/peropix/api/gallery/fail")
async def gallery_fail(request):
    data = await request.json()
    gallery.fail(data["prompt_id"])
    return web.json_response({"ok": True})


@routes.post("/peropix/api/gallery/star")
async def gallery_star(request):
    data = await request.json()
    gallery.set_starred(data["prompt_id"], bool(data.get("starred")))
    return web.json_response({"ok": True})


@routes.post("/peropix/api/gallery/delete")
async def gallery_delete(request):
    data = await request.json()
    gallery.delete(data["prompt_id"])
    return web.json_response({"ok": True})


@routes.get("/peropix/api/gallery/list")
async def gallery_list(request):
    limit = int(request.query.get("limit", "100"))
    offset = int(request.query.get("offset", "0"))
    return web.json_response({"generations": gallery.list_recent(limit, offset)})
