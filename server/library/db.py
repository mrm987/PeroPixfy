"""SQLite store for LoRA metadata.

One row per LoRA, keyed by rel_path (the id ComfyUI uses). Auto-fetched values
(CivitAI / safetensors) never overwrite fields the user has edited by hand:
once `user_edited` is set, re-scans only refresh technical fields (hash, size).
"""

import os
import time
import json
import sqlite3
import threading
from contextlib import contextmanager

_DB_PATH = None
_LOCK = threading.Lock()

COLUMNS = [
    "rel_path", "file_name", "size", "mtime", "ctime", "sha256",
    "name", "trigger_words", "civitai_url", "thumb_url", "thumb_type",
    "thumb_source_url",
    "local_thumb", "base_model", "base_category", "nsfw", "trigger_candidates",
    "disabled_triggers",
    "source", "user_edited", "scanned", "favorite",
    "latest_version_id", "latest_version_name", "latest_published_at",
    "updated_at",
]

# Fields owned by the user once they edit; protected from auto-overwrite.
USER_FIELDS = ("name", "trigger_words", "civitai_url", "thumb_url",
               "thumb_type", "local_thumb", "nsfw", "base_model", "base_category")


def init(db_path):
    global _DB_PATH
    _DB_PATH = db_path
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS loras (
                rel_path TEXT PRIMARY KEY,
                file_name TEXT,
                size INTEGER,
                mtime REAL,
                ctime REAL DEFAULT 0,
                sha256 TEXT,
                name TEXT,
                trigger_words TEXT DEFAULT '',
                civitai_url TEXT DEFAULT '',
                thumb_url TEXT DEFAULT '',
                thumb_type TEXT DEFAULT 'image',
                thumb_source_url TEXT DEFAULT '',
                local_thumb TEXT DEFAULT '',
                base_model TEXT DEFAULT '',
                base_category TEXT DEFAULT '',
                nsfw INTEGER DEFAULT 0,
                trigger_candidates TEXT DEFAULT '[]',
                disabled_triggers TEXT DEFAULT '',
                source TEXT DEFAULT '',
                user_edited INTEGER DEFAULT 0,
                scanned INTEGER DEFAULT 0,
                favorite INTEGER DEFAULT 0,
                updated_at REAL
            )
        """)
        # migrate older DBs that predate a column
        cols = [r[1] for r in c.execute("PRAGMA table_info(loras)").fetchall()]
        if "disabled_triggers" not in cols:
            c.execute("ALTER TABLE loras ADD COLUMN disabled_triggers TEXT DEFAULT ''")
        if "favorite" not in cols:
            c.execute("ALTER TABLE loras ADD COLUMN favorite INTEGER DEFAULT 0")
        if "base_category" not in cols:
            c.execute("ALTER TABLE loras ADD COLUMN base_category TEXT DEFAULT ''")
        if "ctime" not in cols:
            c.execute("ALTER TABLE loras ADD COLUMN ctime REAL DEFAULT 0")
        if "latest_version_id" not in cols:
            c.execute("ALTER TABLE loras ADD COLUMN latest_version_id INTEGER DEFAULT 0")
            c.execute("ALTER TABLE loras ADD COLUMN latest_version_name TEXT DEFAULT ''")
            c.execute("ALTER TABLE loras ADD COLUMN latest_published_at TEXT DEFAULT ''")
        if "thumb_source_url" not in cols:
            # Holds the original CivitAI image URL (kept verbatim) so the
            # lightbox can lazily fetch a larger variant of the SAME image
            # without re-querying the API (which might return a different
            # current main image if the creator changed it). Empty for
            # legacy rows and user-uploaded thumbnails — lightbox falls
            # back to the cached small thumb in those cases.
            c.execute("ALTER TABLE loras ADD COLUMN thumb_source_url TEXT DEFAULT ''")
        # legacy cleanup: the pre-split scanner used to copy CivitAI's category
        # ("Anima") into base_model when safetensors had no specific detail.
        # After the category/detail split, those rows end up with base_model
        # equal to base_category — redundant. Case-insensitive because kohya
        # often stores ss_base_model_version lowercase ("anima") while CivitAI
        # capitalizes it ("Anima"). Skip user-edited rows.
        c.execute("""UPDATE loras SET base_model='' WHERE base_model != ''
                     AND LOWER(base_model) = LOWER(base_category)
                     AND user_edited = 0""")
        # Redirect civitai.com model links to civitai.red (the .red mirror
        # shows NSFW content fully; .com restricts under current policy).
        # Idempotent — once rewritten, the WHERE clause no longer matches.
        c.execute("""UPDATE loras
                     SET civitai_url = REPLACE(civitai_url, '://civitai.com/models/', '://civitai.red/models/')
                     WHERE civitai_url LIKE 'https://civitai.com/models/%'""")

        # ---- Styles gallery tables ----
        c.execute("""
            CREATE TABLE IF NOT EXISTS styles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                image_file TEXT,
                width INTEGER DEFAULT 0,
                height INTEGER DEFAULT 0,
                workflow_json TEXT DEFAULT '',
                checkpoint TEXT DEFAULT '',
                positive_prompt TEXT DEFAULT '',
                negative_prompt TEXT DEFAULT '',
                sampler TEXT DEFAULT '',
                scheduler TEXT DEFAULT '',
                seed INTEGER DEFAULT 0,
                steps INTEGER DEFAULT 0,
                cfg REAL DEFAULT 0,
                notes TEXT DEFAULT '',
                tags TEXT DEFAULT '',
                nsfw INTEGER DEFAULT 0,
                created_at REAL
            )
        """)
        # migrate older Style-Manager DBs that predate the prompt / nsfw columns
        style_cols = [r[1] for r in c.execute("PRAGMA table_info(styles)").fetchall()]
        if "positive_prompt" not in style_cols:
            c.execute("ALTER TABLE styles ADD COLUMN positive_prompt TEXT DEFAULT ''")
        if "negative_prompt" not in style_cols:
            c.execute("ALTER TABLE styles ADD COLUMN negative_prompt TEXT DEFAULT ''")
        if "nsfw" not in style_cols:
            c.execute("ALTER TABLE styles ADD COLUMN nsfw INTEGER DEFAULT 0")
        # 샘플러/스케줄러/시드/스텝/cfg — 스타일에 생성 파라미터까지 저장
        if "sampler" not in style_cols:
            c.execute("ALTER TABLE styles ADD COLUMN sampler TEXT DEFAULT ''")
        if "scheduler" not in style_cols:
            c.execute("ALTER TABLE styles ADD COLUMN scheduler TEXT DEFAULT ''")
        if "seed" not in style_cols:
            c.execute("ALTER TABLE styles ADD COLUMN seed INTEGER DEFAULT 0")
        if "steps" not in style_cols:
            c.execute("ALTER TABLE styles ADD COLUMN steps INTEGER DEFAULT 0")
        if "cfg" not in style_cols:
            c.execute("ALTER TABLE styles ADD COLUMN cfg REAL DEFAULT 0")
        c.execute("""
            CREATE TABLE IF NOT EXISTS style_loras (
                style_id INTEGER NOT NULL,
                lora_rel_path TEXT DEFAULT '',
                display_name TEXT DEFAULT '',
                strength REAL DEFAULT 1.0,
                enabled INTEGER DEFAULT 1,
                FOREIGN KEY (style_id) REFERENCES styles(id) ON DELETE CASCADE
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_style_loras_style ON style_loras (style_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_style_loras_lora ON style_loras (lora_rel_path)")


@contextmanager
def _conn():
    """Open a connection, commit on success, and always close it.

    sqlite3's own context manager commits but does NOT close, which leaks
    connections and holds file locks on Windows.
    """
    c = sqlite3.connect(_DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def get_all():
    with _conn() as c:
        rows = c.execute("SELECT * FROM loras ORDER BY LOWER(rel_path)").fetchall()
    return [dict(r) for r in rows]


def get_one(rel_path):
    with _conn() as c:
        row = c.execute("SELECT * FROM loras WHERE rel_path=?", (rel_path,)).fetchone()
    return dict(row) if row else None


def ensure_row(rel_path, file_name, size, mtime, ctime=0):
    """Create a bare row from a freshly listed file (no metadata yet)."""
    with _LOCK, _conn() as c:
        c.execute("""
            INSERT INTO loras (rel_path, file_name, size, mtime, ctime, name, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(rel_path) DO UPDATE SET file_name=excluded.file_name
        """, (rel_path, file_name, size, mtime, ctime,
              os.path.splitext(file_name)[0], time.time()))


def set_hash(rel_path, sha256, size, mtime):
    with _LOCK, _conn() as c:
        c.execute("UPDATE loras SET sha256=?, size=?, mtime=? WHERE rel_path=?",
                  (sha256, size, mtime, rel_path))


def apply_auto(rel_path, fields, candidates=None):
    """Apply CivitAI/safetensors results, skipping user-owned fields if edited."""
    row = get_one(rel_path)
    if row is None:
        return
    sets, vals = [], []
    protect = bool(row.get("user_edited"))
    for k, v in fields.items():
        if k not in COLUMNS:
            continue
        if protect and k in USER_FIELDS:
            continue
        # don't blank an existing value with an empty auto value
        if (v is None or v == "") and row.get(k):
            continue
        sets.append(f"{k}=?")
        vals.append(v)
    if candidates is not None:
        sets.append("trigger_candidates=?")
        vals.append(json.dumps(candidates, ensure_ascii=False))
    sets.append("scanned=1")
    sets.append("updated_at=?")
    vals.append(time.time())
    vals.append(rel_path)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE loras SET {', '.join(sets)} WHERE rel_path=?", vals)


def update_user(rel_path, fields):
    """Save manual edits and mark the row as user-owned."""
    sets, vals = [], []
    for k, v in fields.items():
        if k in USER_FIELDS:
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return
    sets.append("user_edited=1")
    sets.append("updated_at=?")
    vals.append(time.time())
    vals.append(rel_path)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE loras SET {', '.join(sets)} WHERE rel_path=?", vals)


def set_favorite(rel_path, fav):
    """Toggle the favorite flag. Kept separate from update_user so favoriting
    doesn't mark the row user-edited / freeze its auto-fetched metadata."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE loras SET favorite=? WHERE rel_path=?",
                  (1 if fav else 0, rel_path))


def set_disabled_triggers(rel_path, value):
    """이 로라에서 기본 off로 둘 트리거워드(쉼표구분)를 저장. 트리거 뱃지 on/off의 영구
    기본값. favorite처럼 user_edited를 건드리지 않아 trigger_words 자동 갱신을 막지 않는다."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE loras SET disabled_triggers=? WHERE rel_path=?",
                  (value or "", rel_path))


def set_thumb_url(rel_path, url):
    """Replace thumb_url. Used by the local thumbnail cache; does NOT flag
    the row as user-edited so future re-scans can still refresh other fields."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE loras SET thumb_url=? WHERE rel_path=?", (url, rel_path))


def write_internal(rel_path, fields):
    """Bulk-write derived/internal fields without flagging user_edited.
    Used by Save to commit fields that round-trip through preview but aren't
    user-editable (e.g. thumb_source_url — set by rescan, forwarded by Save
    so the rescan→preview→save pipeline doesn't drop them)."""
    sets, vals = [], []
    for k, v in fields.items():
        if k not in COLUMNS:
            continue
        sets.append(f"{k}=?")
        vals.append(v)
    if not sets:
        return
    sets.append("updated_at=?")
    vals.append(time.time())
    vals.append(rel_path)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE loras SET {', '.join(sets)} WHERE rel_path=?", vals)


def set_base_category(rel_path, cat):
    """Set base_category without flagging user_edited. Used by the one-shot
    backfill that populates the column on existing rows."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE loras SET base_category=? WHERE rel_path=?", (cat, rel_path))


def set_base_model(rel_path, model):
    """Set base_model without flagging user_edited. Used by the one-shot
    cleanup that drops legacy ss_base_model_version fallback values."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE loras SET base_model=? WHERE rel_path=?", (model, rel_path))


def set_ctime(rel_path, ctime):
    """Set ctime without touching anything else. Used by the one-shot backfill
    that populates the column on existing rows from os.path.getctime."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE loras SET ctime=? WHERE rel_path=?", (ctime, rel_path))


def set_update_info(rel_path, latest_version_id, latest_version_name, latest_published_at):
    """Store the newest CivitAI version info for a row, written by the
    Check Updates action. Doesn't touch user_edited."""
    with _LOCK, _conn() as c:
        c.execute("""UPDATE loras SET latest_version_id=?, latest_version_name=?,
                     latest_published_at=? WHERE rel_path=?""",
                  (latest_version_id, latest_version_name, latest_published_at, rel_path))


def delete_row(rel_path):
    """Drop a row completely. Called by the Delete action after the file on
    disk has been removed."""
    with _LOCK, _conn() as c:
        c.execute("DELETE FROM loras WHERE rel_path=?", (rel_path,))


def clear_user_edited(rel_path):
    """Drop user_edited and force scanned=0 so a per-LoRA rescan can overwrite
    everything (matches the 'rescan = overwrite' semantic in the edit dialog)."""
    with _LOCK, _conn() as c:
        c.execute("UPDATE loras SET user_edited=0, scanned=0 WHERE rel_path=?",
                  (rel_path,))


def get_user_version():
    """Read SQLite's built-in PRAGMA user_version (one-shot migration marker)."""
    with _conn() as c:
        return c.execute("PRAGMA user_version").fetchone()[0]


def set_user_version(v):
    with _LOCK, _conn() as c:
        c.execute(f"PRAGMA user_version = {int(v)}")


def prune(valid_rel_paths):
    """Drop rows for files that no longer exist."""
    valid = set(valid_rel_paths)
    with _conn() as c:
        existing = [r[0] for r in c.execute("SELECT rel_path FROM loras").fetchall()]
    gone = [p for p in existing if p not in valid]
    if gone:
        with _LOCK, _conn() as c:
            c.executemany("DELETE FROM loras WHERE rel_path=?", [(p,) for p in gone])
    return len(gone)


# ---------------------------------------------------------------------------
# Styles (saved workflow snapshots with thumbnail images)
# ---------------------------------------------------------------------------

STYLE_USER_FIELDS = ("name", "notes", "tags", "positive_prompt", "negative_prompt", "nsfw")


def create_style(name, image_file, width, height, workflow_json, checkpoint, loras,
                 positive_prompt="", negative_prompt="",
                 sampler="", scheduler="", seed=0, steps=0, cfg=0):
    """Insert a style row + child style_loras rows. Returns the new style id.
    `loras` is a list of {display_name, strength, enabled} dicts."""
    with _LOCK, _conn() as c:
        cur = c.execute(
            """INSERT INTO styles
               (name, image_file, width, height, workflow_json, checkpoint,
                positive_prompt, negative_prompt, sampler, scheduler,
                seed, steps, cfg, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (name, image_file, width, height, workflow_json, checkpoint,
             positive_prompt, negative_prompt, sampler, scheduler,
             seed, steps, cfg, time.time()),
        )
        sid = cur.lastrowid
        if loras:
            c.executemany(
                """INSERT INTO style_loras
                   (style_id, lora_rel_path, display_name, strength, enabled)
                   VALUES (?, ?, ?, ?, ?)""",
                [(sid, l.get("lora_rel_path", ""), l["display_name"],
                  l["strength"], 1 if l.get("enabled", True) else 0) for l in loras],
            )
    return sid


def get_styles():
    """Return all styles with their associated LoRA rows as `loras` list."""
    with _conn() as c:
        rows = c.execute("SELECT * FROM styles ORDER BY created_at DESC").fetchall()
        styles = [dict(r) for r in rows]
        if styles:
            id_set = tuple(s["id"] for s in styles)
            placeholders = ",".join("?" * len(id_set))
            lora_rows = c.execute(
                f"SELECT * FROM style_loras WHERE style_id IN ({placeholders})",
                id_set,
            ).fetchall()
            by_style = {}
            for lr in lora_rows:
                by_style.setdefault(lr["style_id"], []).append(dict(lr))
            for s in styles:
                s["loras"] = by_style.get(s["id"], [])
    return styles


def get_style(style_id):
    with _conn() as c:
        row = c.execute("SELECT * FROM styles WHERE id=?", (style_id,)).fetchone()
        if not row:
            return None
        s = dict(row)
        s["loras"] = [dict(r) for r in c.execute(
            "SELECT * FROM style_loras WHERE style_id=?", (style_id,)).fetchall()]
    return s


def update_style(style_id, fields):
    """Update name / notes / tags on a style."""
    sets, vals = [], []
    for k, v in fields.items():
        if k in STYLE_USER_FIELDS:
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return
    vals.append(style_id)
    with _LOCK, _conn() as c:
        c.execute(f"UPDATE styles SET {', '.join(sets)} WHERE id=?", vals)


def delete_style(style_id):
    """Drop the style row + its style_loras children. Caller deletes the
    image file separately so it can decide whether to keep the bytes."""
    with _LOCK, _conn() as c:
        c.execute("DELETE FROM style_loras WHERE style_id=?", (style_id,))
        c.execute("DELETE FROM styles WHERE id=?", (style_id,))


def count_styles_using_image(image_file):
    """How many style rows reference this image file. SHA-based filenames
    mean re-uploading the same PNG creates a new row but shares the file;
    used by the delete handler to keep the file alive while any sibling
    row still points at it."""
    if not image_file:
        return 0
    with _conn() as c:
        row = c.execute(
            "SELECT COUNT(*) FROM styles WHERE image_file = ?",
            (image_file,),
        ).fetchone()
    return row[0] if row else 0


def get_styles_missing_checkpoint():
    """Rows where the checkpoint slot is empty — fed into the backfill that
    re-parses workflow_json with the latest extraction rules."""
    with _conn() as c:
        rows = c.execute(
            "SELECT id, workflow_json FROM styles WHERE COALESCE(checkpoint,'')=''"
        ).fetchall()
    return [dict(r) for r in rows]


def set_style_checkpoint(style_id, ckpt):
    with _LOCK, _conn() as c:
        c.execute("UPDATE styles SET checkpoint=? WHERE id=?", (ckpt, style_id))


def styles_using_lora(lora_rel_path):
    """For the cross-reference: which styles include this LoRA?
    Only counts styles where the LoRA slot is ENABLED — bypassed/muted slots
    don't actually use the LoRA at generation time, so they shouldn't appear
    in the cross-reference (or the symmetric count below)."""
    with _conn() as c:
        rows = c.execute(
            """SELECT DISTINCT s.* FROM styles s
               JOIN style_loras sl ON sl.style_id = s.id
               WHERE sl.lora_rel_path = ? AND sl.enabled = 1
               ORDER BY s.created_at DESC""",
            (lora_rel_path,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_style_counts_per_lora():
    """Returns {rel_path: count} — how many distinct styles reference each
    LoRA. Used to render the "Used in N styles" badge on LoRA cards in one
    request instead of N round-trips. Mirrors styles_using_lora's enabled
    filter so the badge count matches what clicking it reveals."""
    with _conn() as c:
        rows = c.execute(
            """SELECT lora_rel_path, COUNT(DISTINCT style_id) AS cnt
               FROM style_loras
               WHERE lora_rel_path != '' AND enabled = 1
               GROUP BY lora_rel_path"""
        ).fetchall()
    return {r["lora_rel_path"]: r["cnt"] for r in rows}
