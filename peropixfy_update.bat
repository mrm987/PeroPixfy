@echo off
REM ============================================================
REM  PeroPixfy updater - pulls the latest code + installs deps.
REM  Place this .bat in your ComfyUI portable ROOT
REM  (the folder with  ComfyUI\  and  python_embeded\ ) and
REM  double-click it. Then restart ComfyUI to load the update.
REM ============================================================
setlocal
cd /d "%~dp0"

set "TARGET=ComfyUI\custom_nodes\PeroPixfy"
set "PY=python_embeded\python.exe"

echo === PeroPixfy update ===
echo Root: %CD%
echo.

REM --- sanity: must run from the ComfyUI portable ROOT (the folder that
REM     contains both ComfyUI\ and python_embeded\, one level ABOVE ComfyUI).
REM     goto-free so it still works even if this file has LF line endings. ---
set "_ROOTOK=1"
if not exist "ComfyUI\" set "_ROOTOK="
if not exist "python_embeded\" set "_ROOTOK="
if not defined _ROOTOK echo [ERROR] Wrong location: %CD%
if not defined _ROOTOK echo Run this from the ComfyUI portable ROOT - the folder that
if not defined _ROOTOK echo contains both the "ComfyUI" folder and the "python_embeded" folder,
if not defined _ROOTOK echo i.e. one level ABOVE the ComfyUI folder. Move it there and retry.
if not defined _ROOTOK pause
if not defined _ROOTOK exit /b 1

REM --- must already be installed (git checkout) ---
if not exist "%TARGET%\.git" (
  echo [ERROR] "%TARGET%" is not a git checkout.
  echo Run peropixfy_install.bat first ^(it does the git clone^).
  echo.
  pause
  exit /b 1
)

REM --- need git ---
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] git is not installed / not in PATH.
  echo Install Git for Windows:  https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

REM --- pull latest ---
echo Updating ^(git pull^)...
git -C "%TARGET%" pull
if errorlevel 1 (
  echo.
  echo [ERROR] git pull failed. Check your internet connection and try again.
  echo If you changed files locally, stash/discard them first.
  echo.
  pause
  exit /b 1
)

REM --- dependencies (color-matcher, for hires color match) ---
echo.
if exist "%PY%" (
  echo Installing/updating requirements ^(color-matcher^)...
  "%PY%" -m pip install -r "%TARGET%\requirements.txt"
  if errorlevel 1 (
    echo [WARN] requirements install failed - PeroPixfy still works, but the
    echo        "color match" feature may be skipped. Retry later:
    echo        "%PY%" -m pip install color-matcher
  )
) else (
  echo [WARN] "%PY%" not found - skipping requirements.
  echo        Install color-matcher into your ComfyUI python manually:  pip install color-matcher
)

echo.
echo === Done! Restart ComfyUI to load the update. ===
echo.
pause
