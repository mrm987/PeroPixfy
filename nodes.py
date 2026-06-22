"""PeroPixfy 그래프 노드.

PeroPixSaveImage: 코어 SaveImage 호환이면서 png/jpg/webp 포맷을 선택할 수 있다.
- PNG: 코어 SaveImage와 동일하게 prompt/workflow 메타데이터(tEXt 청크)를 임베드해
  워크플로우를 이미지에 보존한다(나중에 PNG에서 스타일/워크플로우 재추출 가능).
- jpg/webp: 메타데이터를 보존하지 않는다(EXIF 미지원 — Multi 탭 UI에 명시). quality 적용.
"""

import json
import os
import re

import numpy as np
import torch
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths


def _next_counter(folder, base):
    """절대경로 저장 시 폴더 내 '{base}_NNNNN_' 의 다음 번호."""
    mx = 0
    try:
        rx = re.compile(re.escape(base) + r"_(\d+)_")
        for f in os.listdir(folder):
            m = rx.match(f)
            if m:
                mx = max(mx, int(m.group(1)))
    except OSError:
        pass
    return mx + 1


class PeroPixSaveImage:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "PeroPixfy"}),
                "format": (["png", "jpg", "webp"], {"default": "png"}),
                "quality": ("INT", {"default": 95, "min": 1, "max": 100}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "PeroPixfy"

    def save(self, images, filename_prefix="PeroPixfy", format="png", quality=95,
             prompt=None, extra_pnginfo=None):
        fmt = (format or "png").lower()
        if fmt not in ("png", "jpg", "webp"):
            fmt = "png"
        ext = "jpg" if fmt == "jpg" else fmt
        # filename_prefix가 절대경로면 그 폴더에 직접 저장(output 밖 자유 경로). ui에는
        # type="abs" + subfolder=절대폴더로 돌려줘, 프런트가 /peropix/api/localview로 표시한다.
        if os.path.isabs(filename_prefix):
            full_output_folder = os.path.dirname(filename_prefix) or filename_prefix
            filename = os.path.basename(filename_prefix) or "PeroPixfy"
            os.makedirs(full_output_folder, exist_ok=True)
            counter = _next_counter(full_output_folder, filename)
            subfolder = full_output_folder
            save_type = "abs"
        else:
            full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
                filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0]
            )
            save_type = self.type
        results = []
        for image in images:
            arr = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
            file = f"{filename}_{counter:05}_.{ext}"
            path = os.path.join(full_output_folder, file)
            if fmt == "png":
                meta = PngInfo()
                if prompt is not None:
                    meta.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for key in extra_pnginfo:
                        meta.add_text(key, json.dumps(extra_pnginfo[key]))
                img.save(path, pnginfo=meta, compress_level=4)
            else:
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")
                img.save(path, quality=int(quality))
            results.append({"filename": file, "subfolder": subfolder, "type": save_type})
            counter += 1
        return {"ui": {"images": results}}


class PeroPixColorMatch:
    """색 복원 — 하이레스픽스로 칙칙해진 색을 원본(reference) 색으로 되돌린다.

    원인: 하이레스 2패스의 VAE 왕복이 '생생한 영역'의 채도를 압축(칙칙함).
    구현: 검증된 color-matcher 라이브러리(KJNodes ColorMatch가 쓰는 것)로 전역 색 전이.
    - mkl: Monge-Kantorovich(Pitié) 선형전이 — 균형 좋고 매끄러움(기본).
    - mvgd: 다변량 가우시안 분포 전이. hm: 히스토그램. reinhard: 평균/표준편차.
    - hm-mkl-hm / hm-mvgd-hm: 전후 히스토그램 매칭 결합(복합).
    strength로 원본↔결과 블렌드. reference 해상도가 달라도 됨(통계만 사용).
    """

    METHODS = ["mkl", "mvgd", "hm-mkl-hm", "hm-mvgd-hm", "hm", "reinhard"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "reference": ("IMAGE",),
                "method": (cls.METHODS, {"default": "mkl"}),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "match"
    CATEGORY = "PeroPixfy"

    def match(self, image, reference, method="mkl", strength=1.0):
        try:
            from color_matcher import ColorMatcher
        except ImportError:
            print("[PeroPix] color-matcher 미설치 — 색 보정 건너뜀 (pip install color-matcher)")
            return (image,)
        cm = ColorMatcher()
        out = image.clone()
        rn = reference.shape[0]
        for i in range(image.shape[0]):
            src = image[i].detach().cpu().numpy()
            ref = reference[i % rn].detach().cpu().numpy()
            try:
                res = cm.transfer(src=src, ref=ref, method=method)
            except Exception as e:  # 메서드 실패 시 원본 유지
                print(f"[PeroPix] color match 실패({method}): {e}")
                continue
            res = np.clip(np.asarray(res, dtype=np.float32), 0.0, 1.0)
            t = torch.from_numpy(res).to(image.device, image.dtype)
            out[i] = (image[i] + (t - image[i]) * float(strength)).clamp(0.0, 1.0)
        return (out,)


NODE_CLASS_MAPPINGS = {
    "PeroPixSaveImage": PeroPixSaveImage,
    "PeroPixColorMatch": PeroPixColorMatch,
}
NODE_CLASS_DISPLAY_NAME_MAPPINGS = {
    "PeroPixSaveImage": "PeroPix Save Image",
    "PeroPixColorMatch": "PeroPix Color Match",
}
