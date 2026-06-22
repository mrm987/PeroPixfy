@echo off
REM ============================================================
REM  PeroPixfy installer / updater
REM  Place this .bat in your ComfyUI portable ROOT
REM  (the folder that contains  ComfyUI\  and  python_embeded\ )
REM  e.g.  W:\ComfyUI_windows_portable_nvidia_cu121_or_cpu\ComfyUI_windows_portable
REM  then double-click it.
REM ============================================================
setlocal
cd /d "%~dp0"

set "REPO=https://github.com/mrm987/PeroPixfy.git"
set "TARGET=ComfyUI\custom_nodes\PeroPixfy"
set "PY=python_embeded\python.exe"

echo === PeroPixfy install / update ===
echo Root: %CD%
echo.

REM --- sanity: are we in the ComfyUI portable root? ---
if not exist "ComfyUI\custom_nodes\" (
  echo [ERROR] "ComfyUI\custom_nodes" not found here.
  echo Put this .bat in the ComfyUI portable root ^(the folder with ComfyUI\ and python_embeded\^) and run again.
  echo.
  pause
  exit /b 1
)

REM --- need git ---
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] git is not installed / not in PATH.
  echo Install Git for Windows first:  https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

REM --- clone (or update if already there) ---
if exist "%TARGET%\.git" (
  echo Already installed - updating ^(git pull^)...
  git -C "%TARGET%" pull
) else (
  echo Cloning into %TARGET% ...
  git clone "%REPO%" "%TARGET%"
)
if errorlevel 1 (
  echo.
  echo [ERROR] git clone/pull failed. Check your internet connection and try again.
  echo.
  pause
  exit /b 1
)

REM --- dependencies (color-matcher, for hires color match) ---
echo.
if exist "%PY%" (
  echo Installing requirements ^(color-matcher^)...
  "%PY%" -m pip install -r "%TARGET%\requirements.txt"
  if errorlevel 1 (
    echo [WARN] requirements install failed - PeroPixfy still works, but the
    echo        "color match" feature will be skipped. You can retry later:
    echo        "%PY%" -m pip install color-matcher
  )
) else (
  echo [WARN] "%PY%" not found - skipping requirements.
  echo        Install color-matcher into your ComfyUI python manually:  pip install color-matcher
)

echo.
echo === Done! Restart ComfyUI, then open the "PeroPixfy" tab in the sidebar. ===
echo.
pause
