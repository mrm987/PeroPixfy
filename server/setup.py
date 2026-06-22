"""첫 설치 부트스트랩 — 빈 ComfyUI에서 동작에 필요한 모델을 받아준다.

필수 3종(UNet/CLIP/VAE)이 없으면 t2i 자체가 안 되므로, 프런트 셋업 배너가
이 모듈의 status로 누락을 감지하고 download로 받는다. 다운로드 URL은 사용자가
확인해 준 HuggingFace 정본 경로만 쓴다(추측 금지). Spectrum 노드는 플러그인에
벤더링돼 있어 별도 설치가 필요 없다.
"""

import asyncio
import os
import threading

import aiohttp
import folder_paths

# HF resolve URL: https://huggingface.co/{repo}/resolve/main/{path}
_ANIMA = "https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files"
_KIM = "https://huggingface.co/Kim2091/2x-AnimeSharpV4/resolve/main"

MANIFEST = [
    {
        "key": "unet", "label": "Anima base (UNet)", "required": True,
        "folder": "diffusion_models", "filename": "anima-base-v1.0.safetensors",
        "url": f"{_ANIMA}/diffusion_models/anima-base-v1.0.safetensors",
    },
    {
        "key": "clip", "label": "Qwen text encoder (CLIP)", "required": True,
        "folder": "text_encoders", "filename": "qwen_3_06b_base.safetensors",
        "url": f"{_ANIMA}/text_encoders/qwen_3_06b_base.safetensors",
    },
    {
        "key": "vae", "label": "Qwen image VAE", "required": True,
        "folder": "vae", "filename": "qwen_image_vae.safetensors",
        "url": f"{_ANIMA}/vae/qwen_image_vae.safetensors",
    },
    {
        "key": "upscale", "label": "2x-AnimeSharpV4 RCAN (hires)", "required": False,
        "folder": "upscale_models", "filename": "2x-AnimeSharpV4_RCAN.safetensors",
        "url": f"{_KIM}/2x-AnimeSharpV4_RCAN.safetensors",
    },
]

# key -> {"status": "idle|downloading|done|error", "received": int, "total": int, "error": str|None}
_PROGRESS = {}
_LOCK = threading.Lock()
_TASK = None


def _target_dir(folder):
    """folder_paths가 아는 폴더면 그 경로, 모르면 models/{folder}.
    한 타입에 여러 경로가 매핑된 경우(예: diffusion_models -> [models/unet, models/diffusion_models])
    이름이 정확히 일치하는 폴더를 우선한다 — 정본 위치(diffusion_models)에 받도록.
    (unet/diffusion_models는 별칭이라 어디 받든 인식은 되지만, 관례상 정본 폴더를 쓴다.)"""
    try:
        dirs = folder_paths.get_folder_paths(folder)
        if dirs:
            for d in dirs:
                if os.path.basename(os.path.normpath(d)) == folder:
                    return d
            return dirs[0]
    except Exception:
        pass
    return os.path.join(folder_paths.models_dir, folder)


_MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".sft", ".bin")


def _exact(item):
    """추천 파일 그 자체가 설치돼 있는가."""
    try:
        if folder_paths.get_full_path(item["folder"], item["filename"]):
            return True
    except Exception:
        pass
    return os.path.isfile(os.path.join(_target_dir(item["folder"]), item["filename"]))


def _folder_has_any(folder):
    """해당 종류 폴더에 (추천이든 아니든) 모델이 하나라도 있는가."""
    try:
        if folder_paths.get_filename_list(folder):
            return True
    except Exception:
        pass
    try:
        return any(f.lower().endswith(_MODEL_EXTS) for f in os.listdir(_target_dir(folder)))
    except OSError:
        return False


def _satisfied(item):
    # 추천모델은 '아예 비어있을 때만' 받게 한다 — 유저가 다른 모델(프리뷰3, 타 업스케일러 등)을
    # 이미 쓰면 폴더가 비어있지 않으므로 충족으로 보고 다운로드를 권하지 않는다.
    return _exact(item) or _folder_has_any(item["folder"])


def status():
    out = []
    for it in MANIFEST:
        with _LOCK:
            prog = dict(_PROGRESS.get(it["key"], {}))
        out.append({
            "key": it["key"], "label": it["label"], "required": it["required"],
            "folder": it["folder"], "filename": it["filename"],
            "exact": _exact(it), "present": _satisfied(it), "progress": prog,
        })
    return out


async def _download_one(item):
    key = item["key"]
    d = _target_dir(item["folder"])
    os.makedirs(d, exist_ok=True)
    dest = os.path.join(d, item["filename"])
    part = dest + ".part"
    with _LOCK:
        _PROGRESS[key] = {"status": "downloading", "received": 0, "total": 0, "error": None}
    try:
        # 대용량 LFS — 전체 타임아웃은 없애고 읽기 정체만 감시. HF resolve는 CDN으로 리다이렉트(자동 추적).
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=60, sock_read=120)
        async with aiohttp.ClientSession(timeout=timeout) as sess:
            async with sess.get(item["url"]) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"HTTP {resp.status}")
                total = int(resp.headers.get("Content-Length", "0") or 0)
                with _LOCK:
                    _PROGRESS[key]["total"] = total
                received = 0
                with open(part, "wb") as f:
                    async for chunk in resp.content.iter_chunked(1024 * 1024):
                        f.write(chunk)
                        received += len(chunk)
                        with _LOCK:
                            _PROGRESS[key]["received"] = received
        os.replace(part, dest)
        with _LOCK:
            _PROGRESS[key]["status"] = "done"
    except Exception as e:
        try:
            if os.path.exists(part):
                os.remove(part)
        except OSError:
            pass
        with _LOCK:
            _PROGRESS[key] = {"status": "error", "received": 0, "total": 0, "error": str(e)}


async def _download_many(keys):
    # 슬로우 디스크 보호 + 진행률 단순화를 위해 순차 다운로드. 이미 충족된(폴더에 모델이
    # 있는) 종류는 건너뛴다 — 부분만 비어있으면 그 부분만 받는다.
    for it in MANIFEST:
        if it["key"] in keys and not _satisfied(it):
            await _download_one(it)


def start_download(keys):
    """누락 에셋 다운로드를 백그라운드 태스크로 시작. 이미 진행 중이면 False."""
    global _TASK
    if _TASK and not _TASK.done():
        return False
    _TASK = asyncio.create_task(_download_many(set(keys)))
    return True
