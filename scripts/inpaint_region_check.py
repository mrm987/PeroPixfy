"""인페인트 결과 검증: 마스크 안은 크게 바뀌고, 마스크 밖은 원본과 거의 같아야 함.

Usage: python inpaint_region_check.py <source.png> <result.png> <mask.png>
"""

import sys

import numpy as np
from PIL import Image

src = np.asarray(Image.open(sys.argv[1]).convert("RGB"), dtype=np.float32)
res = np.asarray(Image.open(sys.argv[2]).convert("RGB"), dtype=np.float32)
mask = np.asarray(Image.open(sys.argv[3]).convert("L"), dtype=np.float32) / 255.0

diff = np.abs(src - res).mean(axis=2)
inside = diff[mask > 0.5].mean()
outside = diff[mask <= 0.5].mean()
print(f"inside mask mean diff: {inside:.2f}")
print(f"outside mask mean diff: {outside:.2f}")
# 마스크 밖은 VAE 왕복 오차 수준(작음), 안은 새로 그려져 커야 함
ok = inside > outside * 3 and outside < 12
print("RESULT:", "OK" if ok else "SUSPICIOUS")
sys.exit(0 if ok else 1)
