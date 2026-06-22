@echo off
REM 이 bat은 ...\ComfyUI\custom_nodes\PeroPixfy\scripts\ 안에 있다 — 포터블 루트
REM (ComfyUI\ 와 python_embeded\ 가 있는 폴더)는 여기서 4단계 위. 경로 하드코딩 없이 상대로 찾는다.
cd /d "%~dp0..\..\..\.."
if not exist "python_embeded\python.exe" (
  echo [ERROR] portable python not found here: %CD%
  echo Run this from inside  ComfyUI\custom_nodes\PeroPixfy\scripts\  of a portable install.
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 10 /nobreak >nul & start http://127.0.0.1:8188/peropix"
REM Spectrum 노드는 PeroPixfy에 벤더링돼 함께 로드되므로 별도 화이트리스트 불필요.
REM hires는 코어 노드만 쓰므로 USDU도 불필요.
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --use-sage-attention --disable-dynamic-vram --disable-all-custom-nodes --whitelist-custom-nodes PeroPixfy
pause
