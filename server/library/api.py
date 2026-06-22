"""HTTP API + background scan, wired into ComfyUI's aiohttp server.

This is the only module that depends on ComfyUI (folder_paths, server), so the
scanning/metadata logic stays testable in isolation.
"""

import os
import re
import time
import threading

from aiohttp import web
import folder_paths
from server import PromptServer

from . import db, indexer, thumbs, civitai, scanner, styles
from ..migrate import import_style_manager_data

# vendored under server/library/ — plugin root is two levels up
PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_DIR = os.path.join(PLUGIN_DIR, "data")
THUMB_DIR = os.path.join(DATA_DIR, "thumbs")
import_style_manager_data(DATA_DIR)
os.makedirs(THUMB_DIR, exist_ok=True)

thumbs.init(THUMB_DIR)
styles.init(os.path.join(DATA_DIR, "styles"))
db.init(os.path.join(DATA_DIR, "loras.db"))


SCHEMA_VERSION = 4  # bump when a one-shot data migration must run


def _ctime_backfill():
    """Populate ctime for legacy rows from the file's creation time on disk."""
    dirs = folder_paths.get_folder_paths("loras")
    for r in db.get_all():
        if r.get("ctime") and r["ctime"] > 0:
            continue
        for d in dirs:
            cand = os.path.join(d, r["rel_path"])
            if os.path.isfile(cand):
                try:
                    db.set_ctime(r["rel_path"], os.path.getctime(cand))
                except OSError:
                    pass
                break


def _strict_base_model_pass():
    """One-time pass: re-derive base_model with the strict scanner rules,
    clearing legacy values that came from the dropped ss_base_model_version
    fallback. Guarded by PRAGMA user_version so it runs exactly once per DB.
    Respects user_edited."""
    dirs = folder_paths.get_folder_paths("loras")
    for r in db.get_all():
        if r.get("user_edited"):
            continue
        rel = r["rel_path"]
        abs_path = None
        for d in dirs:
            cand = os.path.join(d, rel)
            if os.path.isfile(cand):
                abs_path = cand
                break
        if not abs_path:
            continue
        meta = scanner.read_safetensors_metadata(abs_path)
        new_detail = scanner.best_base_model(meta)
        if (r.get("base_model") or "") != new_detail:
            db.set_base_model(rel, new_detail)


def _style_checkpoint_backfill():
    """Re-run checkpoint extraction on stored styles whose checkpoint slot is
    empty. Catches styles that were uploaded before split-model UNETLoader
    workflows (Flux/Qwen/SD3) were recognized by the parser. Idempotent."""
    import json as _json
    for r in db.get_styles_missing_checkpoint():
        try:
            wf = _json.loads(r.get("workflow_json") or "{}")
        except Exception:
            continue
        ckpt = styles.parse_checkpoint_from_workflow(wf)
        if ckpt:
            db.set_style_checkpoint(r["id"], ckpt)


def _migrate_bg():
    """Background migration on server startup. Mixes one-shot (version-guarded)
    and idempotent (every-startup-but-cheap-once-clean) passes."""
    try:
        time.sleep(2)

        # one-shot version-guarded migrations
        v = db.get_user_version()
        if v < 2:
            _strict_base_model_pass()
        if v < 3:
            _ctime_backfill()
        if v < 4:
            _style_checkpoint_backfill()
        if v < SCHEMA_VERSION:
            db.set_user_version(SCHEMA_VERSION)

        # idempotent per-row passes
        for r in db.get_all():
            sha = r.get("sha256") or ""
            if not sha:
                continue

            url = r.get("thumb_url") or ""
            if url.startswith("http"):
                local = thumbs.download(sha, url)
                if local:
                    db.set_thumb_url(r["rel_path"], local)
                time.sleep(0.2)

            if not (r.get("base_category") or "") and r.get("civitai_url"):
                info = civitai.lookup_by_hash(sha)
                if info and info.get("base_category"):
                    db.set_base_category(r["rel_path"], info["base_category"])
                time.sleep(0.2)

            # Backfill thumb_source_url for legacy rows so the large-thumb
            # cache below can pick them up. Only touch rows that previously
            # matched CivitAI (have civitai_url) — local-only rows have no
            # remote source URL to fetch from.
            if not (r.get("thumb_source_url") or "") and r.get("civitai_url"):
                info = civitai.lookup_by_hash(sha)
                if isinstance(info, dict) and info.get("thumb_url"):
                    db.write_internal(r["rel_path"], {
                        "thumb_source_url": info["thumb_url"],
                    })
                    # refresh local view so the next step reads the new URL
                    r["thumb_source_url"] = info["thumb_url"]
                time.sleep(0.3)

            # Eager-prefetch the width=720 cache so card display (which now
            # also hits /thumb-large) gets the cached file instead of paying
            # the lazy-fetch wait on first scroll.
            src = r.get("thumb_source_url") or ""
            if src:
                lg_path = thumbs.large_path(sha, src)
                if not (lg_path and os.path.isfile(lg_path)):
                    thumbs.download_large(sha, src)
                    time.sleep(0.3)
    except Exception as e:
        print(f"[Style-Manager] migration error: {e}")


threading.Thread(target=_migrate_bg, daemon=True).start()

_scan_state = {"scanning": False, "done": 0, "total": 0, "current": ""}
_scan_lock = threading.Lock()

_update_state = {"checking": False, "done": 0, "total": 0, "updates": 0, "errors": 0}
_update_lock = threading.Lock()


def _parse_civitai_ids(url):
    """Returns (model_id, version_id) parsed from a civitai_url, else (0, 0)."""
    if not url:
        return 0, 0
    mm = re.search(r"/models/(\d+)", url)
    mv = re.search(r"modelVersionId=(\d+)", url)
    return (int(mm.group(1)) if mm else 0,
            int(mv.group(1)) if mv else 0)


def _run_check_updates(targets=None):
    """If `targets` is a non-empty list of rel_paths, only those rows are
    checked. Otherwise all CivitAI-matched rows are checked. The frontend uses
    this to scope checks to favorites or in-workflow LoRAs."""
    try:
        rows = [r for r in db.get_all() if r.get("civitai_url")]
        if targets:
            ts = set(targets)
            rows = [r for r in rows if r["rel_path"] in ts]
        _update_state["total"] = len(rows)
        # Cache per model_id: same model can have multiple versions installed.
        seen = {}
        for r in rows:
            model_id, current_version_id = _parse_civitai_ids(r["civitai_url"])
            if not model_id:
                _update_state["done"] += 1
                continue
            if model_id not in seen:
                info = civitai.lookup_model(model_id)
                seen[model_id] = info
                if info is civitai.TRANSIENT:
                    _update_state["errors"] += 1
                time.sleep(0.2)
            else:
                info = seen[model_id]
            if isinstance(info, dict):
                latest_id = info["latest_version_id"]
                db.set_update_info(r["rel_path"], latest_id,
                                   info["latest_version_name"],
                                   info["latest_published_at"])
                if latest_id and current_version_id and latest_id != current_version_id:
                    _update_state["updates"] += 1
            _update_state["done"] += 1
    except Exception as e:
        print(f"[Style-Manager] check-updates error: {e}")
    finally:
        _update_state["checking"] = False

UPDATABLE = ("name", "trigger_words", "civitai_url",
             "thumb_url", "thumb_type", "nsfw", "base_model", "base_category")


def _lora_dirs():
    return folder_paths.get_folder_paths("loras")


def _safe_name(rel):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", rel or "thumb")


def _run_scan(force):
    def cb(done, total, name):
        _scan_state.update(done=done, total=total, current=name)
    try:
        indexer.scan(_lora_dirs(), progress_cb=cb, force=force)
    except Exception as e:
        print(f"[Style-Manager] scan error: {e}")
    finally:
        _scan_state["scanning"] = False


routes = PromptServer.instance.routes


@routes.get("/peropix/api/library/list")
async def api_list(request):
    loras = db.get_all()
    counts = db.get_style_counts_per_lora()
    for l in loras:
        l["style_count"] = counts.get(l["rel_path"], 0)
    return web.json_response({"loras": loras, "scan": _scan_state})


@routes.post("/peropix/api/library/scan")
async def api_scan(request):
    force = request.rel_url.query.get("force") == "1"
    with _scan_lock:
        if _scan_state["scanning"]:
            return web.json_response({"started": False, "reason": "running"})
        _scan_state.update(scanning=True, done=0, total=0, current="")
    threading.Thread(target=_run_scan, args=(force,), daemon=True).start()
    return web.json_response({"started": True})


@routes.get("/peropix/api/library/scan-status")
async def api_scan_status(request):
    return web.json_response(_scan_state)


@routes.post("/peropix/api/library/update")
async def api_update(request):
    data = await request.json()
    rel = data.get("rel_path")
    if not rel:
        return web.json_response({"ok": False, "error": "rel_path required"}, status=400)
    fields = {k: data[k] for k in UPDATABLE if k in data}
    db.update_user(rel, fields)
    return web.json_response({"ok": True, "lora": db.get_one(rel)})


@routes.post("/peropix/api/library/check-updates")
async def api_check_updates(request):
    targets = None
    if request.body_exists:
        try:
            data = await request.json()
            targets = data.get("rel_paths") or None
        except Exception:
            pass
    with _update_lock:
        if _update_state["checking"]:
            return web.json_response({"started": False, "reason": "already running"})
        _update_state.update(checking=True, done=0, total=0, updates=0, errors=0)
    threading.Thread(target=_run_check_updates, args=(targets,), daemon=True).start()
    return web.json_response({"started": True})


@routes.get("/peropix/api/library/check-updates/status")
async def api_check_updates_status(request):
    return web.json_response(_update_state)


@routes.post("/peropix/api/library/delete")
async def api_delete(request):
    """Permanently delete a LoRA file from disk and remove its DB row.
    No Recycle Bin — frontend must confirm before calling this. We deliberately
    avoid the `send2trash` dependency to keep distribution lightweight."""
    data = await request.json()
    rel = data.get("rel_path")
    if not rel:
        return web.json_response({"ok": False, "error": "rel_path required"}, status=400)
    abs_path = None
    for d in _lora_dirs():
        cand = os.path.join(d, rel)
        if os.path.isfile(cand):
            abs_path = cand
            break
    # If the file is already gone, we still want to clean up the DB row.
    if abs_path:
        try:
            os.remove(abs_path)
        except OSError as e:
            return web.json_response({"ok": False, "error": f"could not delete file: {e}"}, status=500)
    db.delete_row(rel)
    return web.json_response({"ok": True, "removed_file": bool(abs_path)})


@routes.post("/peropix/api/library/preview-rescan")
async def api_preview_rescan(request):
    """Re-fetch CivitAI + safetensors data WITHOUT writing to DB. Returns the
    fields the edit dialog should display so the user can review before Save.
    If they Cancel, original DB row is untouched."""
    data = await request.json()
    rel = data.get("rel_path")
    if not rel:
        return web.json_response({"ok": False, "error": "rel_path required"}, status=400)
    abs_path = None
    for d in _lora_dirs():
        cand = os.path.join(d, rel)
        if os.path.isfile(cand):
            abs_path = cand
            break
    if not abs_path:
        return web.json_response({"ok": False, "error": "file not found"}, status=404)
    row = db.get_one(rel) or {}
    sha = row.get("sha256") or scanner.file_sha256(abs_path)
    meta = scanner.read_safetensors_metadata(abs_path)
    info = civitai.lookup_by_hash(sha)
    if info is civitai.TRANSIENT:
        return web.json_response({"ok": False, "error": "CivitAI unreachable"}, status=503)
    detail = scanner.best_base_model(meta)
    if info:
        # Localize the thumb (idempotent: same sha -> same cached file).
        if info.get("thumb_url"):
            # Persist the raw CivitAI URL immediately — lightbox lazy-fetch
            # uses this. Even though preview-rescan is "preview-only" for
            # user-visible fields, this is an internal derivation with no
            # user-edit semantics, so storing it pre-Save is correct.
            db.write_internal(rel, {"thumb_source_url": info["thumb_url"]})
            local = thumbs.download(sha, info["thumb_url"])
            if local:
                info["thumb_url"] = local
        preview = {
            "name": info.get("name", ""),
            "base_category": info.get("base_category", ""),
            "base_model": detail,
            "trigger_words": info.get("trigger_words", ""),
            "civitai_url": info.get("civitai_url", ""),
            "thumb_url": info.get("thumb_url", ""),
            "thumb_type": info.get("thumb_type", "image"),
            "nsfw": info.get("nsfw", 0),
        }
    else:
        preview = {
            "name": os.path.splitext(os.path.basename(abs_path))[0],
            "base_category": "",
            "base_model": detail,
            "trigger_words": "",
            "civitai_url": "",
            "thumb_url": "",
            "thumb_type": "image",
            "nsfw": 0,
        }
    return web.json_response({"ok": True, "preview": preview})


@routes.post("/peropix/api/library/rescan")
async def api_rescan(request):
    """Re-process a single LoRA, overwriting existing auto-fetched data.
    Clears user_edited first so all USER_FIELDS get refreshed too — matches
    the 'rescan = overwrite' UX from the edit dialog."""
    data = await request.json()
    rel = data.get("rel_path")
    if not rel:
        return web.json_response({"ok": False, "error": "rel_path required"}, status=400)
    abs_path = None
    for d in _lora_dirs():
        cand = os.path.join(d, rel)
        if os.path.isfile(cand):
            abs_path = cand
            break
    if not abs_path:
        return web.json_response({"ok": False, "error": "file not found"}, status=404)
    db.clear_user_edited(rel)
    try:
        indexer.process_one(abs_path, rel, force=True)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
    return web.json_response({"ok": True, "lora": db.get_one(rel)})


@routes.post("/peropix/api/library/favorite")
async def api_favorite(request):
    data = await request.json()
    rel = data.get("rel_path")
    if not rel:
        return web.json_response({"ok": False, "error": "rel_path required"}, status=400)
    db.set_favorite(rel, bool(data.get("favorite")))
    return web.json_response({"ok": True})


@routes.post("/peropix/api/library/upload-thumb")
async def api_upload_thumb(request):
    reader = await request.multipart()
    rel, saved = None, None
    async for part in reader:
        if part.name == "rel_path":
            rel = await part.text()
        elif part.name == "file" and rel:
            ext = os.path.splitext(part.filename or "")[1].lower() or ".png"
            saved = _safe_name(rel) + ext
            with open(os.path.join(THUMB_DIR, saved), "wb") as f:
                while True:
                    chunk = await part.read_chunk()
                    if not chunk:
                        break
                    f.write(chunk)
    if rel and saved:
        url = f"/peropix/api/library/thumb?file={saved}"
        db.update_user(rel, {"thumb_url": url, "thumb_type": "image"})
        return web.json_response({"ok": True, "thumb_url": url})
    return web.json_response({"ok": False}, status=400)


@routes.get("/peropix/api/library/thumb")
async def api_thumb(request):
    fn = os.path.basename(request.rel_url.query.get("file", ""))
    path = os.path.join(THUMB_DIR, fn)
    if fn and os.path.isfile(path):
        return web.FileResponse(path)
    return web.Response(status=404)


@routes.get("/peropix/api/library/thumb-large")
async def api_thumb_large(request):
    """Serve the cached large (width=720) variant for the lightbox.
    Falls back transparently to the small thumb when:
      - the row has no source URL (legacy / user-uploaded thumb), OR
      - the large file isn't yet cached AND a live fetch fails (CivitAI down
        or the image was removed upstream).
    The lightbox always gets SOMETHING displayable as long as the small thumb
    exists, preserving the "works offline once cached" guarantee."""
    rel = request.rel_url.query.get("rel", "")
    if not rel:
        return web.Response(status=400)
    row = db.get_one(rel)
    if not row:
        return web.Response(status=404)
    sha = row.get("sha256") or ""
    source = row.get("thumb_source_url") or ""
    small_url = row.get("thumb_url") or ""

    # no-store on every response — the endpoint's behavior depends on DB
    # state (source URL may have been populated by a rescan), so a cached
    # earlier "fell back to small" response must not be reused.
    nocache = {"Cache-Control": "no-store"}

    def _serve_small():
        # small_url is "/peropix/api/library/thumb?file=<fname>" — extract <fname>
        # and serve directly to avoid a redirect round-trip.
        if small_url.startswith("/peropix/api/library/thumb?file="):
            fname = small_url.split("file=", 1)[1]
            p = os.path.join(THUMB_DIR, os.path.basename(fname))
            if os.path.isfile(p):
                return web.FileResponse(p, headers=nocache)
        return web.Response(status=404, headers=nocache)

    if not sha or not source:
        return _serve_small()

    cached = thumbs.large_path(sha, source)
    if cached and os.path.isfile(cached):
        return web.FileResponse(cached, headers=nocache)
    # Not cached yet: try a synchronous fetch. The user explicitly clicked
    # the thumbnail so a 1–3s wait is acceptable. If fetch fails, fall back.
    fetched = thumbs.download_large(sha, source)
    if fetched and os.path.isfile(fetched):
        return web.FileResponse(fetched, headers=nocache)
    return _serve_small()


# ---------------------------------------------------------------------------
# Styles gallery
# ---------------------------------------------------------------------------

def _match_lora_to_db(display_name, known_loras):
    """Best-effort match of a workflow's LoRA reference to a row in our DB.
    Returns rel_path if matched, else ''. Tries: exact, basename, then
    extension-stripped basename — CivitAI Lora Manager stores names without
    the .safetensors suffix, so basename match alone misses them."""
    if not display_name:
        return ""
    if display_name in known_loras:
        return display_name
    base = os.path.basename(display_name)
    base_no_ext = os.path.splitext(base)[0]
    for rel in known_loras:
        rel_base = os.path.basename(rel)
        if rel_base == base:
            return rel
        if os.path.splitext(rel_base)[0] == base_no_ext:
            return rel
    return ""


@routes.post("/peropix/api/library/styles/upload")
async def api_style_upload(request):
    """Multipart upload: save the image, extract its embedded ComfyUI workflow,
    parse out LoRAs/checkpoints, link to our LoRA DB. Returns the new style."""
    reader = await request.multipart()
    image_bytes = None
    original_name = None
    async for part in reader:
        if part.name == "file":
            original_name = part.filename or "image.png"
            image_bytes = await part.read(decode=False)
            break
    if not image_bytes:
        return web.json_response({"ok": False, "error": "no file"}, status=400)

    workflow = styles.extract_workflow_from_png(image_bytes)
    if workflow is None:
        return web.json_response({
            "ok": False,
            "error": "no ComfyUI workflow found in image metadata",
        }, status=400)

    fname = styles.save_image(image_bytes, original_name)
    fpath = os.path.join(styles.styles_dir(), fname)
    width, height = styles.get_image_size(fpath)

    lora_refs = styles.parse_loras_from_workflow(workflow)
    checkpoint = styles.parse_checkpoint_from_workflow(workflow)
    positive_prompt, negative_prompt = styles.parse_prompts_from_workflow(workflow)
    samp = styles.parse_sampler_from_workflow(workflow)

    known = {l["rel_path"] for l in db.get_all()}
    for lref in lora_refs:
        lref["lora_rel_path"] = _match_lora_to_db(lref["display_name"], known)

    name = os.path.splitext(original_name)[0]
    sid = db.create_style(
        name=name,
        image_file=fname,
        width=width,
        height=height,
        workflow_json=__import__("json").dumps(workflow, ensure_ascii=False),
        checkpoint=checkpoint,
        loras=lora_refs,
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        sampler=samp["sampler"],
        scheduler=samp["scheduler"],
        seed=samp["seed"],
        steps=samp["steps"],
        cfg=samp["cfg"],
    )
    return web.json_response({"ok": True, "style": db.get_style(sid)})


@routes.get("/peropix/api/library/styles/list")
async def api_style_list(request):
    """Returns all styles. Each row gets an image_missing flag set when the
    referenced image file is gone from disk — lets the frontend show a clear
    placeholder instead of retrying GETs that will always 404."""
    styles_list = db.get_styles()
    sdir = styles.styles_dir() or ""
    for s in styles_list:
        f = s.get("image_file") or ""
        s["image_missing"] = bool(f) and not os.path.isfile(os.path.join(sdir, f))
    return web.json_response({"styles": styles_list})


@routes.post("/peropix/api/library/styles/update")
async def api_style_update(request):
    data = await request.json()
    sid = data.get("id")
    if not sid:
        return web.json_response({"ok": False, "error": "id required"}, status=400)
    db.update_style(sid, {k: data[k] for k in db.STYLE_USER_FIELDS if k in data})
    return web.json_response({"ok": True, "style": db.get_style(sid)})


@routes.post("/peropix/api/library/styles/delete")
async def api_style_delete(request):
    data = await request.json()
    sid = data.get("id")
    if not sid:
        return web.json_response({"ok": False, "error": "id required"}, status=400)
    style = db.get_style(sid)
    if style and style.get("image_file"):
        image_file = style["image_file"]
        # Only delete the file if no OTHER row references it. SHA-based
        # filenames mean re-uploading the same PNG creates a new row but
        # reuses the file; deleting it would kill the thumbnail for siblings.
        if db.count_styles_using_image(image_file) <= 1:
            path = os.path.join(styles.styles_dir(), image_file)
            try:
                os.remove(path)
            except OSError:
                pass
    db.delete_style(sid)
    return web.json_response({"ok": True})


@routes.get("/peropix/api/library/styles/image")
async def api_style_image(request):
    fn = os.path.basename(request.rel_url.query.get("file", ""))
    path = os.path.join(styles.styles_dir(), fn)
    if fn and os.path.isfile(path):
        return web.FileResponse(path)
    return web.Response(status=404)


@routes.get("/peropix/api/library/styles/workflow")
async def api_style_workflow(request):
    sid = request.rel_url.query.get("id", "")
    if not sid.isdigit():
        return web.json_response({"ok": False, "error": "id required"}, status=400)
    style = db.get_style(int(sid))
    if not style:
        return web.Response(status=404)
    return web.Response(text=style.get("workflow_json") or "{}",
                        content_type="application/json")


@routes.post("/peropix/api/library/styles/create")
async def api_style_create(request):
    """Create a style directly from generation params (PeroPix workbench
    "save as style"). Unlike /styles/upload there is no workflow PNG to parse —
    the client sends the fields explicitly, plus an optional reference to a
    generated image in ComfyUI's output directory to use as the thumbnail."""
    data = await request.json()
    name = (data.get("name") or "").strip()
    if not name:
        return web.json_response({"ok": False, "error": "name required"}, status=400)

    image_file = ""
    width = int(data.get("width") or 0)
    height = int(data.get("height") or 0)
    ref = data.get("image") or {}
    if ref.get("filename"):
        out_dir = os.path.abspath(folder_paths.get_output_directory())
        path = os.path.abspath(os.path.join(
            out_dir, ref.get("subfolder") or "", os.path.basename(ref["filename"])))
        if path.startswith(out_dir + os.sep) and os.path.isfile(path):
            with open(path, "rb") as f:
                image_file = styles.save_image(f.read(), ref["filename"])

    loras = []
    for l in data.get("loras") or []:
        if not l.get("lora_rel_path"):
            continue
        loras.append({
            "lora_rel_path": l["lora_rel_path"],
            "display_name": l.get("display_name") or l["lora_rel_path"],
            "strength": float(l.get("strength", 1.0)),
            "enabled": bool(l.get("enabled", True)),
        })

    sid = db.create_style(
        name=name,
        image_file=image_file,
        width=width,
        height=height,
        workflow_json="",
        checkpoint=data.get("checkpoint") or "",
        positive_prompt=data.get("positive_prompt") or "",
        negative_prompt=data.get("negative_prompt") or "",
        sampler=data.get("sampler") or "",
        scheduler=data.get("scheduler") or "",
        seed=int(data.get("seed") or 0),
        steps=int(data.get("steps") or 0),
        cfg=float(data.get("cfg") or 0),
        loras=loras,
    )
    if data.get("tags"):
        db.update_style(sid, {"tags": data["tags"]})
    return web.json_response({"ok": True, "style": db.get_style(sid)})
