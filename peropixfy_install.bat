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
