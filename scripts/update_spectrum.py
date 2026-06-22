"""벤더링된 Spectrum 노드를 업스트림에서 갱신한다(우리가 원할 때만).

사용법:
    python scripts/update_spectrum.py [git-태그-또는-브랜치]

지정한 ref로 sorryhyun/ComfyUI-Spectrum-KSampler를 임시 디렉터리에 clone하고,
.py 파일 + LICENSE를 vendor/spectrum/ 로 덮어쓴다. 순수 파일 복사라 의존성 없음.

갱신 후 점검: NODE_CLASS_MAPPINGS가 여전히 'SpectrumKSamplerModGuidance'를
같은 입력 스키마로 노출하는지 확인. 업스트림이 노드명/입력을 바꿨다면 그때만
ui/src/workflow/builder.ts 를 맞춘다. __init__.py 의 SPECTRUM_VERSION 도 갱신.
"""
import os
import shutil
import subprocess
import sys
import tempfile

REPO = "https://github.com/sorryhyun/ComfyUI-Spectrum-KSampler"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(HERE, "vendor", "spectrum")


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else None
    os.makedirs(DST, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        args = ["git", "clone", "--depth", "1"]
        if ref:
            args += ["--branch", ref]
        args += [REPO, tmp]
        subprocess.check_call(args)
        copied = []
        for name in os.listdir(tmp):
            if name.endswith(".py") or name in ("LICENSE", "README.md"):
                shutil.copy2(os.path.join(tmp, name), os.path.join(DST, name))
                copied.append(name)
    print(f"Updated vendor/spectrum from {REPO} @ {ref or 'default branch'}")
    print(f"Copied: {', '.join(sorted(copied))}")
    print("Check: NODE_CLASS_MAPPINGS must still export 'SpectrumKSamplerModGuidance' "
          "with the same inputs; then bump SPECTRUM_VERSION in __init__.py.")


if __name__ == "__main__":
    main()
