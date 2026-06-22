@echo off
set COMFY_ROOT=W:\ComfyUI_windows_portable_nvidia_cu121_or_cpu\ComfyUI_windows_portable
cd /d "%COMFY_ROOT%"
start "" cmd /c "timeout /t 10 /nobreak >nul & start http://127.0.0.1:8188/peropix"
REM Spectrum 노드는 PeroPixComfy에 벤더링돼 함께 로드되므로 별도 화이트리스트 불필요.
REM hires는 코어 노드만 쓰므로 USDU도 불필요.
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --use-sage-attention --disable-dynamic-vram --disable-all-custom-nodes --whitelist-custom-nodes PeroPixComfy
pause
