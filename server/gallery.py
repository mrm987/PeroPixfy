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
                created_at REAL
            )
        """)


def record(prompt_id, params_json):
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO generations (prompt_id, params_json, created_at) VALUES (?, ?, ?)",
            (prompt_id, params_json, time.time()),
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


def list_recent(limit=100, offset=0):
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]


def list_pending():
    with _conn() as c:
        rows = c.execute("SELECT * FROM generations WHERE status='pending'").fetchall()
        return [dict(r) for r in rows]
