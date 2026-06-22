@echo off
REM ============================================================
REM  PeroPixfy installer / updater
REM  Place this .bat in your ComfyUI portable ROOT
REM  (the folder that contains  ComfyUI\  and  python_embeded\ ,
REM   usually named  ComfyUI_windows_portable )  then double-click it.
REM ============================================================
setlocal
cd /d "%~dp0"

set "REPO=https://github.com/mrm987/PeroPixfy.git"
set "TARGET=ComfyUI\custom_nodes\PeroPixfy"
set "PY=python_embeded\python.exe"

echo === PeroPixfy install / update ===
echo Root: %CD%
echo.

REM --- sanity: must run from the ComfyUI portable ROOT (the folder that
REM     contains both ComfyUI\ and python_embeded\ — one level ABOVE ComfyUI) ---
if exist "ComfyUI\" if exist "python_embeded\" goto :rootok
echo [ERROR] Wrong location: %CD%
echo This .bat must run from the ComfyUI portable ROOT — the folder that
echo contains both "ComfyUI\" and "python_embeded\" ^(one level ABOVE the
echo ComfyUI folder^). Move this .bat there and double-click it again.
echo.
pause
exit /b 1
:rootok

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
