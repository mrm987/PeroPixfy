"""인페인트 검증용 마스크 생성: 중앙 원형 흰색, 나머지 검정.

Usage: python make_test_mask.py <width> <height> <out.png>
"""

import sys

from PIL import Image, ImageDraw

w, h = int(sys.argv[1]), int(sys.argv[2])
img = Image.new("RGB", (w, h), "black")
d = ImageDraw.Draw(img)
r = min(w, h) // 4
d.ellipse([w // 2 - r, h // 2 - r, w // 2 + r, h // 2 + r], fill="white")
img.save(sys.argv[3])
print("saved", sys.argv[3])
