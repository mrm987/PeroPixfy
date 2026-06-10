@echo off
set COMFY_ROOT=W:\ComfyUI_windows_portable_nvidia_cu121_or_cpu\ComfyUI_windows_portable
cd /d "%COMFY_ROOT%"
start "" cmd /c "timeout /t 10 /nobreak >nul & start http://127.0.0.1:8188/peropix"
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --use-sage-attention --disable-dynamic-vram --disable-all-custom-nodes --whitelist-custom-nodes PeroPixComfy comfyui-spectrum-ksampler comfyui-spectrum-sdxl ComfyUI_UltimateSDUpscale
pause
