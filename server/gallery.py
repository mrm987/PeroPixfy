"""SQLite store for generation records.

One row per submitted prompt. The client registers a record right after
queueing (status=pending) and completes it with the output file list once
ComfyUI reports execution success. Image files themselves stay in ComfyUI's
output directory — only references are stored here.
"""

import json
import os
import shutil
import sqlite3
import threading
import time
import uuid
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
                source TEXT DEFAULT 'single',
                workspace TEXT DEFAULT ''
            )
        """)
        cols = [r["name"] for r in c.execute("PRAGMA table_info(generations)").fetchall()]
        # 기존 DB에 source 컬럼이 없으면 추가(Single/Multi 리스트 분리용).
        if "source" not in cols:
            c.execute("ALTER TABLE generations ADD COLUMN source TEXT DEFAULT 'single'")
        # 워크스페이스 컬럼(Single 히스토리를 작업 단위로 분리). 없으면 추가하고, 기존
        # single 기록은 모두 기본 워크스페이스('default')에 귀속시킨다. (multi는 워크스페이스
        # 개념이 없으므로 '' 유지 — multi 조회는 workspace 필터 없이 source로만 한다.)
        if "workspace" not in cols:
            c.execute("ALTER TABLE generations ADD COLUMN workspace TEXT DEFAULT ''")
            c.execute(
                "UPDATE generations SET workspace='default' WHERE source='single' AND (workspace='' OR workspace IS NULL)"
            )


def record(prompt_id, params_json, source="single", workspace=""):
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO generations (prompt_id, params_json, source, workspace, created_at) VALUES (?, ?, ?, ?, ?)",
            (prompt_id, params_json, source, workspace, time.time()),
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


def delete_workspace_data(workspace, folder, out_dir):
    """워크스페이스 '완전 삭제' — 그 워크스페이스의 DB 기록 + 실제 이미지 파일 + (전용 폴더면)
    폴더까지 전부 제거한다. best-effort. 반환: 삭제한 파일 수.

    - 상대(type=output) 파일은 output 디렉터리 내부만, 절대(type=abs) 파일은 기록된 경로에서 삭제.
    - folder가 전용 자동 폴더(PeroPixfy/Single/<이름>)면 폴더를 통째로 rmtree(잔여 파일까지).
      베이스(PeroPixfy/Single)나 커스텀/절대 폴더는 통째 삭제하지 않는다(공유/사용자 폴더 보호).
    """
    out_abs = os.path.abspath(out_dir)
    with _conn() as c:
        rows = [r["files_json"] for r in c.execute(
            "SELECT files_json FROM generations WHERE source='single' AND workspace=?", (workspace,)).fetchall()]
    deleted = 0
    dirs = set()
    for fj in rows:
        try:
            files = json.loads(fj or "[]")
        except Exception:
            continue
        for f in files:
            if not isinstance(f, dict):
                continue
            fn = os.path.basename(f.get("filename") or "")
            if not fn:
                continue
            sub = f.get("subfolder") or ""
            if (f.get("type") or "output") == "abs":
                path = os.path.abspath(os.path.join(sub, fn))
            else:
                path = os.path.abspath(os.path.join(out_abs, sub.replace("\\", os.sep).replace("/", os.sep), fn))
                if not (path == out_abs or path.startswith(out_abs + os.sep)):
                    continue  # output 밖 → 안전상 스킵
            if os.path.isfile(path):
                try:
                    os.remove(path)
                    deleted += 1
                    dirs.add(os.path.dirname(path))
                except OSError:
                    pass
    with _conn() as c:
        c.execute("DELETE FROM generations WHERE source='single' AND workspace=?", (workspace,))
    # 전용 자동 폴더면 통째로 제거(잔여 파일까지). 베이스/커스텀/절대는 rmtree 안 함.
    fol = _normrel(folder)
    if fol.startswith("PeroPixfy/Single/") and len(fol) > len("PeroPixfy/Single/"):
        target = os.path.abspath(os.path.join(out_abs, fol.replace("/", os.sep)))
        if target.startswith(out_abs + os.sep) and os.path.isdir(target):
            shutil.rmtree(target, ignore_errors=True)
    # 비워진 폴더 정리(비어있을 때만 — 공유 베이스는 안전하게 남음)
    for d in sorted(dirs, key=len, reverse=True):
        if d == out_abs:
            continue
        try:
            os.rmdir(d)
        except OSError:
            pass
    return deleted


def _normrel(s):
    """경로를 비교용으로 정규화 — 백슬래시→슬래시, 양끝 슬래시 제거."""
    return str(s or "").replace("\\", "/").strip("/")


def copy_to_workspace(prompt_ids, target_workspace, target_folder, out_dir):
    """선택한 생성 기록들을 다른 워크스페이스로 '복제'한다 — 원본은 그대로 두고, 대상 워크스페이스에
    새 기록(새 prompt_id)을 만들고 출력 파일을 대상 폴더(최상위)로 복사한다. 파일명 충돌 시 새
    이름을 부여한다. abs 저장물도 대상 폴더로 복사해 사본은 대상 워크스페이스 안에서 독립적으로 둔다.
    반환: 복제한 기록 수."""
    out_abs = os.path.abspath(out_dir)
    tgt = _normrel(target_folder) or "PeroPixfy/Single"
    tgt_dir = os.path.abspath(os.path.join(out_abs, tgt.replace("/", os.sep)))
    if not (tgt_dir == out_abs or tgt_dir.startswith(out_abs + os.sep)):
        return 0
    copied = 0
    for pid in prompt_ids:
        with _conn() as c:
            row = c.execute(
                "SELECT params_json, files_json, status, starred FROM generations WHERE prompt_id=?",
                (pid,)).fetchone()
        if not row:
            continue
        try:
            files = json.loads(row["files_json"] or "[]")
        except Exception:
            files = []
        new_files = []
        for f in files:
            if not isinstance(f, dict):
                continue
            fn = os.path.basename(f.get("filename") or "")
            if not fn:
                continue
            sub = f.get("subfolder") or ""
            if (f.get("type") or "output") == "abs":
                src_path = os.path.abspath(os.path.join(sub, fn))
            else:
                src_path = os.path.abspath(os.path.join(out_abs, _normrel(sub).replace("/", os.sep), fn))
                if not (src_path == out_abs or src_path.startswith(out_abs + os.sep)):
                    continue
            if not os.path.isfile(src_path):
                continue
            os.makedirs(tgt_dir, exist_ok=True)
            new_fn = fn
            stem, ext = os.path.splitext(fn)
            k = 1
            while os.path.exists(os.path.join(tgt_dir, new_fn)):  # 파일명 충돌 회피
                new_fn = f"{stem}_{k}{ext}"
                k += 1
            try:
                shutil.copy2(src_path, os.path.join(tgt_dir, new_fn))
            except OSError:
                continue
            new_files.append({"filename": new_fn, "subfolder": tgt, "type": "output"})
        with _conn() as c:
            c.execute(
                "INSERT INTO generations (prompt_id, params_json, files_json, status, starred, created_at, source, workspace) "
                "VALUES (?, ?, ?, ?, ?, ?, 'single', ?)",
                (uuid.uuid4().hex, row["params_json"], json.dumps(new_files),
                 row["status"] or "done", row["starred"] or 0, time.time(), target_workspace),
            )
        copied += 1
    return copied


def rename_workspace_files(workspace, old_root, new_root, out_dir):
    """워크스페이스 이름 변경 시, 그 워크스페이스의 출력 파일을 옛 폴더(old_root) 하위에서
    새 폴더(new_root) 하위로 '실제로 이동'하고 DB의 subfolder 참조도 함께 갱신한다 —
    폴더가 이분화되지 않고 기존 이미지가 새 이름 폴더로 따라오게 한다.

    - 상대 저장(type=output)만 다룬다. 절대경로(type=abs) 저장물은 사용자 지정 폴더라 건드리지 않음.
    - 충돌(대상 파일이 이미 존재)나면 덮어쓰지 않고 그 파일만 건너뛴다(옛 위치·DB 그대로).
    - best-effort: 개별 이동 실패는 넘어가고 DB는 항상 실제 위치를 반영한다.
    - 이동으로 비워진 옛 폴더는 정리(비어있을 때만 삭제 — 베이스/공유 폴더는 안전하게 남음).
    반환: 실제로 이동한 파일 수.
    """
    old_n = _normrel(old_root)
    new_n = _normrel(new_root)
    if not new_n or old_n == new_n:
        return 0
    out_abs = os.path.abspath(out_dir)

    with _conn() as c:
        rows = [(r["prompt_id"], r["files_json"]) for r in c.execute(
            "SELECT prompt_id, files_json FROM generations WHERE source='single' AND workspace=?",
            (workspace,),
        ).fetchall()]

    updates = {}
    moved = 0
    old_dirs = set()
    for pid, fj in rows:
        try:
            files = json.loads(fj or "[]")
        except Exception:
            continue
        changed = False
        for f in files:
            if not isinstance(f, dict) or (f.get("type") or "output") != "output":
                continue
            sub = _normrel(f.get("subfolder") or "")
            # 옛 루트와 정확히 같거나 그 하위(경계 일치)일 때만 대상
            if sub != old_n and not sub.startswith(old_n + "/"):
                continue
            rest = sub[len(old_n):].lstrip("/")
            new_sub = (new_n + "/" + rest) if rest else new_n
            fn = os.path.basename(f.get("filename") or "")
            if not fn:
                continue
            old_abs = os.path.abspath(os.path.join(out_abs, sub.replace("/", os.sep), fn))
            new_abs = os.path.abspath(os.path.join(out_abs, new_sub.replace("/", os.sep), fn))
            # 경로 탈출 방지 — 둘 다 output 디렉터리 내부여야 함
            if not (old_abs == out_abs or old_abs.startswith(out_abs + os.sep)):
                continue
            if not new_abs.startswith(out_abs + os.sep) or old_abs == new_abs:
                continue
            if os.path.isfile(old_abs) and not os.path.exists(new_abs):
                try:
                    os.makedirs(os.path.dirname(new_abs), exist_ok=True)
                    os.replace(old_abs, new_abs)
                    moved += 1
                    old_dirs.add(os.path.dirname(old_abs))
                    f["subfolder"] = new_sub
                    changed = True
                except OSError:
                    pass  # 이동 실패 → 옛 위치·DB 유지
            elif not os.path.isfile(old_abs) and os.path.isfile(new_abs):
                # 이미 새 위치에 있음(재시도 등) → DB만 새 경로로 맞춘다
                f["subfolder"] = new_sub
                changed = True
        if changed:
            updates[pid] = json.dumps(files)

    if updates:
        with _conn() as c:
            for pid, fj in updates.items():
                c.execute("UPDATE generations SET files_json=? WHERE prompt_id=?", (fj, pid))

    # 비워진 옛 폴더 정리(옛 루트 포함, 깊은 경로부터). rmdir은 비어있을 때만 성공하므로
    # 베이스(PeroPixfy/Single 등 다른 워크스페이스가 공유)는 안전하게 남는다.
    old_dirs.add(os.path.join(out_abs, old_n.replace("/", os.sep)))
    for d in sorted(old_dirs, key=len, reverse=True):
        if d == out_abs:
            continue
        try:
            os.rmdir(d)
        except OSError:
            pass
    return moved


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


def list_recent(limit=100, offset=0, source=None, workspace=None):
    # source(single/multi)와 workspace(Single 작업 단위)를 각각 있을 때만 필터로 건다.
    # multi 조회는 workspace=None으로 넘어와 필터되지 않는다.
    clauses, args = [], []
    if source:
        clauses.append("source=?")
        args.append(source)
    if workspace is not None:
        clauses.append("workspace=?")
        args.append(workspace)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    args += [limit, offset]
    with _conn() as c:
        rows = c.execute(
            f"SELECT * FROM generations{where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            args,
        ).fetchall()
        return [dict(r) for r in rows]


def list_pending():
    with _conn() as c:
        rows = c.execute("SELECT * FROM generations WHERE status='pending'").fetchall()
        return [dict(r) for r in rows]
