"""One-time import of existing ComfyUI-Style-Manager data (loras.db, thumbs, styles).

Skips the 10-minute lora rescan and CivitAI re-lookup when the user already
has a populated Style-Manager database in the same custom_nodes directory.
Runs only when our own loras.db does not exist yet.
"""

import os
import shutil
import sqlite3

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def import_style_manager_data(data_dir: str) -> None:
    db_path = os.path.join(data_dir, "loras.db")
    if os.path.exists(db_path):
        return

    src = os.path.join(os.path.dirname(PLUGIN_DIR), "ComfyUI-Style-Manager", "data")
    src_db = os.path.join(src, "loras.db")
    if not os.path.isfile(src_db):
        return

    print("[PeroPix] importing Style-Manager data from", src)
    os.makedirs(data_dir, exist_ok=True)
    shutil.copy2(src_db, db_path)
    for sub in ("thumbs", "styles"):
        s = os.path.join(src, sub)
        if os.path.isdir(s):
            shutil.copytree(s, os.path.join(data_dir, sub), dirs_exist_ok=True)

    # stored thumbnail URLs embed the old route prefix
    con = sqlite3.connect(db_path)
    try:
        con.execute(
            "UPDATE loras SET thumb_url = REPLACE(thumb_url, '/lora-manager/', '/peropix/api/library/')"
        )
        con.commit()
    finally:
        con.close()
    print("[PeroPix] import done")
