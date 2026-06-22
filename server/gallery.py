"""SQLite store for generation records.

One row per submitted prompt. The client registers a record right after
queueing (status=pending) and completes it with the output file list once
ComfyUI reports execution success. Image files themselves stay in ComfyUI's
output directory — only references are stored here.
"""

import json
import sqlite3
import threading
import time
from contextlib import contextmanager

_DB_PATH = None
_LOCK = threading.Lock()


@contextmanager
def _conn():
    with _LOCK:
        c = sqlite3.connect(_DB_PATH)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()


def init(db_path):
    global _DB_PATH
    _DB_PATH = db_path
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS generations (
                prompt_id TEXT PRIMARY KEY,
                params_json TEXT NOT NULL,
                files_json TEXT DEFAULT '[]',
                status TEXT DEFAULT 'pending',
                starred INTEGER DEFAULT 0,
                created_at REAL,
                source TEXT DEFAULT 'single'
            )
        """)
        # 기존 DB에 source 컬럼이 없으면 추가(Single/Multi 리스트 분리용).
        cols = [r["name"] for r in c.execute("PRAGMA table_info(generations)").fetchall()]
        if "source" not in cols:
            c.execute("ALTER TABLE generations ADD COLUMN source TEXT DEFAULT 'single'")


def record(prompt_id, params_json, source="single"):
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO generations (prompt_id, params_json, source, created_at) VALUES (?, ?, ?, ?)",
            (prompt_id, params_json, source, time.time()),
        )


def complete(prompt_id, files):
    with _conn() as c:
        c.execute(
            "UPDATE generations SET status='done', files_json=? WHERE prompt_id=?",
            (json.dumps(files), prompt_id),
        )


def fail(prompt_id):
    with _conn() as c:
        c.execute("UPDATE generations SET status='error' WHERE prompt_id=?", (prompt_id,))


def set_starred(prompt_id, starred):
    with _conn() as c:
        c.execute("UPDATE generations SET starred=? WHERE prompt_id=?", (1 if starred else 0, prompt_id))


def delete(prompt_id):
    with _conn() as c:
        c.execute("DELETE FROM generations WHERE prompt_id=?", (prompt_id,))


def get_files(prompt_id):
    """레코드의 출력 파일 목록(파싱된 리스트). 없으면 []."""
    with _conn() as c:
        row = c.execute(
            "SELECT files_json FROM generations WHERE prompt_id=?", (prompt_id,)
        ).fetchone()
    if not row:
        return []
    try:
        return json.loads(row["files_json"] or "[]")
    except Exception:
        return []


def files_referenced_by_others(prompt_id):
    """prompt_id를 제외한 다른 레코드들이 참조하는 출력 파일 키 집합.
    ComfyUI 캐시로 동일 그래프가 같은 파일을 공유할 때, 한 레코드를 지워도
    다른 레코드가 쓰는 원본 파일은 보존하기 위해 쓴다. 키는 (subfolder, filename)."""
    keys = set()
    with _conn() as c:
        rows = c.execute(
            "SELECT files_json FROM generations WHERE prompt_id != ?", (prompt_id,)
        ).fetchall()
    for row in rows:
        try:
            files = json.loads(row["files_json"] or "[]")
        except Exception:
            continue
        for f in files:
            if isinstance(f, dict) and f.get("filename"):
                keys.add((f.get("subfolder") or "", f.get("filename")))
    return keys


def list_recent(limit=100, offset=0, source=None):
    with _conn() as c:
        if source:
            rows = c.execute(
                "SELECT * FROM generations WHERE source=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (source, limit, offset),
            ).fetchall()
        else:
            rows = c.execute(
                "SELECT * FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return [dict(r) for r in rows]


def list_pending():
    with _conn() as c:
        rows = c.execute("SELECT * FROM generations WHERE status='pending'").fetchall()
        return [dict(r) for r in rows]
