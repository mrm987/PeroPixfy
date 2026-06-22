"""Multi 탭 슬롯 프리셋 영속화 — data/presets/*.json (PeroPix 이식).

프리셋 = 슬롯 세트. 슬롯 = {name(파일 prefix 역할), prompt, locked}.
출력 폴더·포맷 등 세션 설정은 프리셋에 담지 않는다(프런트 localStorage).
"""

import json
import os
import re

_DIR = None


def init(presets_dir):
    global _DIR
    _DIR = presets_dir
    os.makedirs(presets_dir, exist_ok=True)


def _safe_name(name):
    s = re.sub(r"[^\w\-가-힣]+", "_", (name or "").strip()).strip("_")
    return s or "preset"


def _resolve(filename):
    """presets 디렉터리 내부의 *.json만 허용 (경로 탈출 방지)."""
    if not filename or "/" in filename or "\\" in filename or not filename.endswith(".json"):
        return None
    base = os.path.abspath(_DIR)
    path = os.path.abspath(os.path.join(base, filename))
    return path if path.startswith(base + os.sep) else None


def _norm_slots(slots):
    out = []
    for s in slots or []:
        if not isinstance(s, dict):
            continue
        item = {
            "name": str(s.get("name", "")),
            "prompt": str(s.get("prompt", "")),
            "locked": bool(s.get("locked", False)),
        }
        h = s.get("promptH")
        if isinstance(h, (int, float)) and h > 0:
            item["promptH"] = int(h)  # 프롬프트칸 높이(px) 기억
        out.append(item)
    return out


def list_presets():
    out = []
    for fn in sorted(os.listdir(_DIR)):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(_DIR, fn), encoding="utf-8") as f:
                data = json.load(f)
            out.append({"filename": fn, "name": data.get("name", fn[:-5])})
        except Exception:
            continue
    return out


def get_preset(filename):
    path = _resolve(filename)
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    return {"name": data.get("name", filename[:-5]), "slots": _norm_slots(data.get("slots"))}


def _write(filename, name, slots):
    with open(os.path.join(_DIR, filename), "w", encoding="utf-8") as f:
        json.dump({"name": name, "slots": _norm_slots(slots)}, f, ensure_ascii=False, indent=2)


def create_preset(name, slots):
    base = _safe_name(name)
    fn = base + ".json"
    i = 2
    while os.path.exists(os.path.join(_DIR, fn)):
        fn = f"{base}_{i}.json"
        i += 1
    _write(fn, name, slots)
    return fn


def update_preset(filename, name, slots):
    if _resolve(filename) is None:
        return False
    _write(filename, name, slots)
    return True


def delete_preset(filename):
    path = _resolve(filename)
    if not path or not os.path.isfile(path):
        return False
    os.remove(path)
    return True
