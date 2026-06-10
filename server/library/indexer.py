"""Scan orchestration: list -> hash (cached) -> safetensors meta -> CivitAI.

Import-safe (no ComfyUI imports) so it can be exercised standalone. api.py
supplies the loras directories and runs scan() on a background thread.
"""

import os
import time

from . import scanner, civitai, db, thumbs


def _needs_hash(row, size, mtime):
    if not row or not row.get("sha256"):
        return True
    return row.get("size") != size or row.get("mtime") != mtime


def _ensure_local_thumb(rel_path, row):
    """If the row's thumb_url is still a remote CivitAI URL, download it to
    the local cache and swap the DB to point at the local copy. No-op if
    already local or the download fails."""
    url = row.get("thumb_url") or ""
    if not url.startswith("http"):
        return row
    local = thumbs.download(row.get("sha256") or "", url)
    if local:
        db.set_thumb_url(rel_path, local)
        return db.get_one(rel_path)
    return row


def process_one(abs_path, rel_path, force=False, throttle=0.0):
    """Index a single file. Returns the resulting db row (dict)."""
    size, mtime, ctime = scanner.file_signature(abs_path)
    db.ensure_row(rel_path, os.path.basename(abs_path), size, mtime, ctime)
    row = db.get_one(rel_path)

    if _needs_hash(row, size, mtime):
        sha = scanner.file_sha256(abs_path)
        db.set_hash(rel_path, sha, size, mtime)
        row = db.get_one(rel_path)
        changed = True
    else:
        sha = row["sha256"]
        changed = False

    # localize any pre-existing remote thumb before the early-return for
    # already-scanned rows — this is how older rows get migrated to local.
    row = _ensure_local_thumb(rel_path, row)

    if row.get("scanned") and not changed and not force:
        return row

    meta = scanner.read_safetensors_metadata(abs_path)
    info = civitai.lookup_by_hash(sha)
    detail = scanner.best_base_model(meta)

    if info is civitai.TRANSIENT:
        # CivitAI is unreachable (5xx/timeout). Do NOT mark scanned so the row
        # is retried next scan. Still record the safetensors detail (it's
        # local, always available) without bumping the scanned flag.
        if detail and not (row.get("base_model") or ""):
            db.set_base_model(rel_path, detail)
        if throttle:
            time.sleep(throttle)
        return db.get_one(rel_path)

    if info:
        info["base_model"] = detail
        # Preserve the raw CivitAI image URL before _ensure_local_thumb
        # overwrites thumb_url with the localized path. The lightbox uses
        # this to lazily fetch a larger variant of the SAME image.
        info["thumb_source_url"] = info.get("thumb_url", "")
        db.apply_auto(rel_path, info)
    else:
        db.apply_auto(rel_path, {
            "base_model": detail,
            "base_category": "",
            "source": "local",
        })

    # localize the newly-applied civitai URL
    row = _ensure_local_thumb(rel_path, db.get_one(rel_path))

    # Eager-fetch the width=720 variant alongside the small one — card
    # display + lightbox now both serve from the large cache, so dual-fetch
    # at scan time is cheaper than discovering it's missing later.
    src = (row or {}).get("thumb_source_url") or ""
    if sha and src:
        thumbs.download_large(sha, src)

    if throttle:
        time.sleep(throttle)
    return row


def scan(dirs, progress_cb=None, force=False, throttle=0.0):
    """Full scan of all LoRA files under `dirs`. progress_cb(done, total, name).

    Sequential on purpose: the dominant cost is reading each file to hash it,
    and concurrent reads thrash a spinning disk. The CivitAI call (~0.5s) is a
    small fraction and naturally spaces out the requests. Runs once; hashes are
    cached by (size, mtime) so later scans only touch new/changed files.
    """
    files = scanner.list_lora_files(dirs)
    db.prune([rel for _, rel in files])
    total = len(files)
    for i, (abs_path, rel) in enumerate(files):
        try:
            process_one(abs_path, rel, force=force, throttle=throttle)
        except Exception as e:
            print(f"[Style-Manager] failed on {rel}: {e}")
        if progress_cb:
            progress_cb(i + 1, total, rel)
    return total
