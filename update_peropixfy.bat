@echo off
REM ============================================================
REM  PeroPixfy updater — pulls the latest code + installs deps.
REM  Double-click this from INSIDE the plugin folder:
REM    ...\ComfyUI\custom_nodes\PeroPixfy\update_peropixfy.bat
REM  Then restart ComfyUI to load the update.
REM ============================================================
setlocal
cd /d "%~dp0"

REM portable python, relative to this plugin folder:
REM   ...\ComfyUI\custom_nodes\PeroPixfy  ->  ...\python_embeded
set "PY=%~dp0..\..\..\python_embeded\python.exe"

echo === PeroPixfy update ===
echo Folder: %CD%
echo.

REM --- must be a git checkout (installed via git clone) ---
if not exist ".git" (
  echo [ERROR] This folder is not a git checkout.
  echo Install with install_peropixfy.bat first ^(it does the git clone^).
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
git pull
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
  "%PY%" -m pip install -r "requirements.txt"
  if errorlevel 1 (
    echo [WARN] requirements install failed - PeroPixfy still works, but the
    echo        "color match" feature may be skipped. Retry later:
    echo        "%PY%" -m pip install color-matcher
  )
) else (
  echo [WARN] portable python not found at "%PY%"
  echo        Install deps manually into your ComfyUI python:  pip install color-matcher
)

echo.
echo === Done! Restart ComfyUI to load the update. ===
echo.
pause
