"""LoRA file scanning: directory listing, safetensors metadata, cached hashing.

Kept free of ComfyUI imports so it can be tested standalone. The caller
(api.py) passes in the loras directories obtained from folder_paths.
"""

import os
import re
import json
import struct
import hashlib

LORA_EXTS = (".safetensors", ".pt", ".ckpt")


def list_lora_files(dirs):
    """Return list of (abs_path, rel_path) for every LoRA file under `dirs`.

    rel_path is relative to the directory it was found in and is used as the
    stable display id (matches what ComfyUI shows in its loader node).
    """
    out = []
    seen = set()
    for d in dirs:
        if not d or not os.path.isdir(d):
            continue
        for root, _, files in os.walk(d, followlinks=True):
            for fn in files:
                if not fn.lower().endswith(LORA_EXTS):
                    continue
                abs_path = os.path.join(root, fn)
                rel = os.path.relpath(abs_path, d).replace("\\", "/")
                if rel in seen:
                    continue
                seen.add(rel)
                out.append((abs_path, rel))
    out.sort(key=lambda x: x[1].lower())
    return out


def read_safetensors_metadata(path):
    """Read the __metadata__ dict from a safetensors header without loading tensors.

    Returns {} on any error or for non-safetensors files.
    """
    if not path.lower().endswith(".safetensors"):
        return {}
    try:
        with open(path, "rb") as f:
            head = f.read(8)
            if len(head) < 8:
                return {}
            n = struct.unpack("<Q", head)[0]
            if n <= 0 or n > 100 * 1024 * 1024:  # sanity cap: 100MB header
                return {}
            header = json.loads(f.read(n).decode("utf-8"))
        return header.get("__metadata__", {}) or {}
    except Exception:
        return {}


def base_model_from_meta(meta):
    """Best-effort base model label from training metadata."""
    name = meta.get("ss_base_model_version") or meta.get("ss_sd_model_name")
    return name or ""


def best_base_model(meta):
    """The actual training checkpoint filename, or empty when unknown.

    Uses ONLY `ss_sd_model_name` (the real file kohya recorded). Rejects CivitAI
    internal codes (^EMS-\\d). `ss_base_model_version` is intentionally NOT used
    as a fallback — it's a coarse family label ("anima"), not a checkpoint name,
    and surfacing it as "Trained on" would be misleading. Empty is honest.
    """
    raw = (meta.get("ss_sd_model_name") or "").strip()
    if raw and not re.match(r"^ems[-_]\d", raw, re.I):
        detailed = re.sub(r"\.(safetensors|ckpt|pt)$", "", raw, flags=re.I)
        detailed = detailed.replace("_", " ").replace("-", " ").strip()
        if re.search(r"[A-Za-z]{3,}", detailed):
            return detailed
    return ""


def file_sha256(path, chunk_size=4 * 1024 * 1024):
    """Full-file SHA256, read in chunks to stay memory-light on large files."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def file_signature(path):
    """(size, mtime, ctime).
    size/mtime are used to invalidate the cached hash. ctime is the file's
    creation time on this filesystem — on Windows this reflects when the
    file actually appeared in the loras folder ("added" order)."""
    st = os.stat(path)
    return st.st_size, st.st_mtime, st.st_ctime
