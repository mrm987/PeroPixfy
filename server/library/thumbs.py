"""Local cache for CivitAI thumbnail images.

Civitai image URLs are stored in the DB and the browser loads them directly.
If the upstream image disappears (model deletion, CDN rotation, etc.) the
thumbnail breaks. This module fetches each thumbnail to data/thumbs/<sha>.<ext>
so the LoRA Manager keeps working when the source goes away.
"""

import os
import re
import requests

_THUMB_DIR = None
HEADERS = {"User-Agent": "ComfyUI-Style-Manager"}


def init(thumb_dir):
    global _THUMB_DIR
    _THUMB_DIR = thumb_dir
    os.makedirs(thumb_dir, exist_ok=True)


def _ext_from_url(url):
    base = url.split("?")[0].split("#")[0].rstrip("/")
    m = re.search(r"\.(jpe?g|png|webp|gif|bmp|mp4|webm)$", base, re.I)
    return m.group(0).lower() if m else ".jpg"


def _resized_civitai(url):
    """Rewrite CivitAI's transform segment so we cache a small width=300
    version. Matches the frontend's display-time rewrite — ~37KB vs ~3.8MB
    for the same image."""
    return re.sub(
        r"(image\.civitai\.com/[^/]+/[0-9a-f-]+/)[^/]+(/)",
        r"\1width=300\2",
        url,
        flags=re.I,
    )


def download(sha, url):
    """Fetch the thumbnail and cache it as <sha>.<ext>. Returns the served URL
    ("/peropix/api/library/thumb?file=...") on success, or None on failure / before
    init()."""
    if not _THUMB_DIR or not sha or not url:
        return None
    ext = _ext_from_url(url)
    fname = f"{sha}{ext}"
    path = os.path.join(_THUMB_DIR, fname)
    if not os.path.exists(path):
        fetch = _resized_civitai(url) if "image.civitai.com" in url else url
        try:
            r = requests.get(fetch, headers=HEADERS, timeout=30)
        except requests.RequestException:
            return None
        if r.status_code != 200 or not r.content:
            return None
        try:
            with open(path, "wb") as f:
                f.write(r.content)
        except OSError:
            return None
    return f"/peropix/api/library/thumb?file={fname}"


def _resized_civitai_large(url):
    """Same rewrite as _resized_civitai but at width=720 — sharp enough for
    the lightbox at sidebar size without paying the full-original cost."""
    return re.sub(
        r"(image\.civitai\.com/[^/]+/[0-9a-f-]+/)[^/]+(/)",
        r"\1width=720\2",
        url,
        flags=re.I,
    )


def large_path(sha, url):
    """Path on disk for the cached large variant. Same <sha>_lg.<ext> naming
    everywhere so the API serve / lazy fetch agree without a side index."""
    if not _THUMB_DIR or not sha:
        return None
    return os.path.join(_THUMB_DIR, f"{sha}_lg{_ext_from_url(url or '.jpg')}")


def download_large(sha, source_url):
    """Lazily fetch the larger (width=720) variant of the SAME image we
    originally cached at width=300. Stored as <sha>_lg.<ext>. Returns the
    on-disk path on success, or None on failure / when source_url is empty
    (e.g. legacy rows that pre-date the source URL column, or user-uploaded
    thumbs). The caller can fall back to the small thumb in those cases."""
    if not _THUMB_DIR or not sha or not source_url:
        return None
    path = large_path(sha, source_url)
    if path and os.path.exists(path):
        return path
    fetch = (_resized_civitai_large(source_url)
             if "image.civitai.com" in source_url else source_url)
    try:
        r = requests.get(fetch, headers=HEADERS, timeout=30)
    except requests.RequestException:
        return None
    if r.status_code != 200 or not r.content:
        return None
    try:
        with open(path, "wb") as f:
            f.write(r.content)
    except OSError:
        return None
    return path
