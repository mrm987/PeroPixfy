"""Pixel-exact comparison of two images, ignoring metadata.

Usage: python compare.py a.png b.png
Exit 0 + "IDENTICAL" when every pixel matches.
"""

import sys

from PIL import Image, ImageChops

a = Image.open(sys.argv[1]).convert("RGB")
b = Image.open(sys.argv[2]).convert("RGB")
if a.size != b.size:
    print(f"DIFFERENT: size {a.size} vs {b.size}")
    sys.exit(1)
bbox = ImageChops.difference(a, b).getbbox()
if bbox is None:
    print("IDENTICAL")
    sys.exit(0)
print(f"DIFFERENT: bbox={bbox}")
sys.exit(1)
