"""HTTP routes wired into ComfyUI's aiohttp server.

Only this module imports ComfyUI internals (server), so the rest of the
plugin stays testable in isolation.
"""

import asyncio
import hashlib
import json
import mimetypes
import os
import subprocess

import folder_paths
from aiohttp import web
from PIL import Image
from server import PromptServer

from . import gallery
from . import presets
from . import setup as _setup
from .library import api as _library_api  # noqa: F401  (registers /peropixfy/api/library/*)

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(PLUGIN_DIR, "web")

gallery.init(os.path.join(PLUGIN_DIR, "data", "loras.db"))
presets.init(os.path.join(PLUGIN_DIR, "data", "presets"))

routes = PromptServer.instance.routes

# git 기반 버전/업데이트 — 플러그인은 custom_nodes에 git clone으로 설치되므로 현재 커밋과
# origin의 차이로 업데이트 존재를 판단한다(읽기 전용). 실제 적용은 update_peropixfy.bat.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # Windows 콘솔 창 깜빡임 방지


def _git(*args, timeout=15):
    return subprocess.run(
        ["git", "-C", PLUGIN_DIR, *args],
        capture_output=True, text=True, timeout=timeout, creationflags=_NO_WINDOW,
    )


@routes.get("/peropixfy")
async def index(request):
    # index.html은 매 빌드마다 새 에셋 해시를 참조하므로 절대 캐시하면 안 된다.
    # (vite build가 emptyOutDir로 옛 해시를 지우기 때문에, 스테일 index.html을
    #  캐시하면 삭제된 에셋을 가리켜 404 → 흰 화면이 된다.)
    return web.FileResponse(
        os.path.join(WEB_DIR, "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@routes.get("/peropixfy/assets/{path:.*}")
async def assets(request):
    base = os.path.normpath(os.path.join(WEB_DIR, "assets"))
    full = os.path.normpath(os.path.join(base, request.match_info["path"]))
    if not full.startswith(base + os.sep) or not os.path.isfile(full):
        raise web.HTTPNotFound()
    # 에셋 파일명에 콘텐츠 해시가 박혀 있어 불변 → 장기 캐시 안전.
    return web.FileResponse(
        full,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# 캔버스 줌아웃 시 풀해상도 대신 쓰는 다운스케일 썸네일 캐시.
# 플러그인 하위(data/)에 두어 배포 시에도 설치 경로를 따라간다.
_THUMB_DIR = os.path.join(PLUGIN_DIR, "data", "thumbs_out")
os.makedirs(_THUMB_DIR, exist_ok=True)


@routes.get("/peropixfy/api/thumb")
async def output_thumb(request):
    """출력 이미지를 가로 w로 다운스케일한 webp 썸네일. 캔버스가 줌아웃 상태에서
    풀해상도 대신 이걸 받으면 디코딩 비트맵이 작아져 메모리·래스터화 부하가 준다.
    리사이즈 결과를 (경로+mtime+w) 키로 캐시 → 느린 출력 디스크 재읽기를 피한다."""
    q = request.query
    fn = q.get("filename")
    if not fn:
        return web.Response(status=400)
    try:
        w = max(64, min(1024, int(q.get("w", "360"))))
    except ValueError:
        w = 360

    typ = q.get("type", "output")
    subfolder = q.get("subfolder", "")
    if typ == "abs":
        # 절대경로 저장(output 밖). subfolder가 절대 폴더.
        src = os.path.abspath(os.path.join(subfolder, os.path.basename(fn)))
        if not os.path.isfile(src):
            return web.Response(status=404)
    else:
        base = folder_paths.get_directory_by_type(typ)
        if base is None:
            return web.Response(status=400)
        base = os.path.abspath(base)
        # 경로 탈출 방지 — base 디렉터리 내부 파일만 허용.
        src = os.path.abspath(os.path.join(base, subfolder, os.path.basename(fn)))
        if not (src == base or src.startswith(base + os.sep)) or not os.path.isfile(src):
            return web.Response(status=404)

    try:
        mtime = int(os.path.getmtime(src))
    except OSError:
        return web.Response(status=404)
    key = hashlib.sha1(f"{src}|{mtime}|{w}".encode("utf-8")).hexdigest()
    cache = os.path.join(_THUMB_DIR, f"{key}.webp")

    if not os.path.isfile(cache):
        try:
            with Image.open(src) as img:
                img = img.convert("RGB")
                if img.width > w:
                    h = max(1, round(img.height * w / img.width))
                    img = img.resize((w, h), Image.LANCZOS)
                img.save(cache, format="webp", quality=82)
        except Exception:
            # 썸네일 생성 실패 시 프론트가 풀해상도 /view로 폴백하도록 404.
            return web.Response(status=404)

    return web.FileResponse(
        cache,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@routes.get("/peropixfy/api/localview")
async def localview(request):
    """output 밖 절대경로에 저장된 이미지를 풀해상도로 서빙(/view는 output 한정이라 불가).
    로컬 단일 사용자 도구라 사용자가 고른 폴더의 파일을 그대로 제공한다."""
    d = request.query.get("dir", "")
    f = request.query.get("file", "")
    if not d or not f:
        return web.Response(status=400)
    path = os.path.abspath(os.path.join(d, os.path.basename(f)))
    if not os.path.isfile(path):
        return web.Response(status=404)
    ct = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return web.FileResponse(path, headers={"Content-Type": ct, "Cache-Control": "no-cache"})


@routes.get("/peropixfy/api/output-dir")
async def output_dir_get(request):
    try:
        return web.json_response({"path": os.path.abspath(folder_paths.get_output_directory())})
    except Exception as e:
        return web.json_response({"path": None, "error": str(e)})


def _pick_folder_modern():
    """모던 폴더 선택 다이얼로그(IFileOpenDialog + FOS_PICKFOLDERS) — pywin32가 해당 심볼을
    노출하지 않아 ctypes로 직접 COM 호출. 취소 시 None. (Win Vista+ 표준 탐색기 스타일)"""
    import ctypes
    from ctypes import POINTER, byref, c_long, c_ulong, c_void_p, c_wchar_p
    ole32 = ctypes.windll.ole32

    class GUID(ctypes.Structure):
        _fields_ = [("Data1", ctypes.c_uint32), ("Data2", ctypes.c_uint16),
                    ("Data3", ctypes.c_uint16), ("Data4", ctypes.c_ubyte * 8)]

    def _guid(s):
        g = GUID()
        if ole32.CLSIDFromString(c_wchar_p(s), byref(g)) != 0:
            raise OSError("bad guid")
        return g

    def _vcall(ptr, index, restype, argtypes, *args):
        vtbl = ctypes.cast(ptr, POINTER(c_void_p))[0]
        fn = ctypes.cast(vtbl, POINTER(c_void_p))[index]
        return ctypes.WINFUNCTYPE(restype, c_void_p, *argtypes)(fn)(ptr, *args)

    def _release(ptr):
        if ptr:
            _vcall(ptr, 2, c_ulong, [])

    CLSID_FileOpenDialog = _guid("{DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7}")
    IID_IFileOpenDialog = _guid("{D57C7288-D4AD-4768-BE02-9D969532D960}")
    ole32.CoInitialize(None)
    dlg = c_void_p()
    try:
        if ole32.CoCreateInstance(byref(CLSID_FileOpenDialog), None, 1, byref(IID_IFileOpenDialog), byref(dlg)) != 0 or not dlg:
            return None
        opts = c_ulong()
        _vcall(dlg, 10, c_long, [POINTER(c_ulong)], byref(opts))                  # IFileDialog::GetOptions
        _vcall(dlg, 9, c_long, [c_ulong], c_ulong(opts.value | 0x20 | 0x40))      # SetOptions(FOS_PICKFOLDERS|FOS_FORCEFILESYSTEM)
        if _vcall(dlg, 3, c_long, [c_void_p], None) != 0:                         # IModalWindow::Show(NULL) — 취소 시 nonzero
            return None
        psi = c_void_p()
        if _vcall(dlg, 20, c_long, [POINTER(c_void_p)], byref(psi)) != 0 or not psi:  # IFileDialog::GetResult
            return None
        try:
            pwsz = c_wchar_p()
            if _vcall(psi, 5, c_long, [c_ulong, POINTER(c_wchar_p)], 0x80058000, byref(pwsz)) != 0:  # IShellItem::GetDisplayName(SIGDN_FILESYSPATH)
                return None
            path = pwsz.value
            if pwsz:
                ole32.CoTaskMemFree(ctypes.cast(pwsz, c_void_p))
            return path or None
        finally:
            _release(psi)
    finally:
        _release(dlg)
        ole32.CoUninitialize()


def _pick_folder_classic():
    """폴백: 구형 SHBrowseForFolder. 모던 다이얼로그가 예외로 실패할 때만 사용."""
    try:
        import pythoncom
        from win32com.shell import shell, shellcon
    except Exception:
        return None
    pythoncom.CoInitialize()
    try:
        flags = shellcon.BIF_RETURNONLYFSDIRS | getattr(shellcon, "BIF_NEWDIALOGSTYLE", 0x40) | shellcon.BIF_EDITBOX
        res = shell.SHBrowseForFolder(0, None, "PeroPixfy - Select output folder", flags)
        pidl = res[0] if isinstance(res, tuple) else res
        if not pidl:
            return None
        path = shell.SHGetPathFromIDList(pidl)
        return path.decode("utf-8", "ignore") if isinstance(path, bytes) else (path or None)
    except Exception:
        return None
    finally:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass


def _pick_folder():
    """네이티브 폴더 선택. 블로킹 — executor에서 호출. 모던 우선, 예외 시 구형 폴백. 취소=None."""
    try:
        return _pick_folder_modern()
    except Exception:
        import traceback
        traceback.print_exc()  # 모던 실패 원인 콘솔 출력
        return _pick_folder_classic()


@routes.post("/peropixfy/api/pick-folder")
async def pick_folder(request):
    path = await asyncio.get_event_loop().run_in_executor(None, _pick_folder)
    return web.json_response({"path": path})


def _force_foreground_window(hwnd):
    """탐색기 창을 브라우저 앞으로 가져온다.

    PeroPixfy는 ComfyUI(=백그라운드 프로세스)에서 호출하므로 단순 SetForegroundWindow가
    Windows 포그라운드 제한에 막힌다(브라우저가 포그라운드라 권한 없음). 그래서:
      1) 포그라운드 잠금 타임아웃을 0으로 (백그라운드 전환 허용),
      2) 호출 스레드 + 대상 스레드를 현재 포그라운드 스레드에 attach (권한 빌림),
      3) topmost 토글(HWND_TOPMOST→NOTOPMOST)로 z-order 최상단에 올린다 — SetWindowPos는
         포그라운드 권한이 없어도 되므로, SetForegroundWindow가 막혀도 창이 앞으로 온다.
    (단일 프로세스 앱이던 PeroPix는 1~3 없이 SetForegroundWindow만으로도 됐다.)"""
    try:
        import ctypes

        import win32con
        import win32gui
        import win32process
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        if win32gui.GetForegroundWindow() == hwnd:
            return
        try:
            ctypes.windll.user32.SystemParametersInfoW(0x2001, 0, 0, 0)  # SPI_SETFOREGROUNDLOCKTIMEOUT=0
        except Exception:
            pass
        fg = win32gui.GetForegroundWindow()
        ft = win32process.GetWindowThreadProcessId(fg)[0] if fg else 0
        tt = win32process.GetWindowThreadProcessId(hwnd)[0]
        cur = ctypes.windll.kernel32.GetCurrentThreadId()
        attached = []
        for th in {cur, tt}:
            if th and ft and th != ft and ctypes.windll.user32.AttachThreadInput(th, ft, True):
                attached.append(th)
        try:
            win32gui.BringWindowToTop(hwnd)
            try:
                win32gui.SetForegroundWindow(hwnd)
            except Exception:
                pass
            # z-order 최상단으로 (포그라운드 권한 불필요) → 막혀도 브라우저 앞에 보이게.
            flags = win32con.SWP_NOMOVE | win32con.SWP_NOSIZE
            win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 0, 0, 0, 0, flags)
            win32gui.SetWindowPos(hwnd, win32con.HWND_NOTOPMOST, 0, 0, 0, 0, flags)
        finally:
            for th in attached:
                ctypes.windll.user32.AttachThreadInput(th, ft, False)
    except Exception:
        pass


def _open_and_focus(folder, select_file=None):
    """폴더(또는 파일 위치)를 탐색기로 열고, 그 탐색기 창을 foreground로 가져온다.
    블로킹 호출 — 이벤트 루프를 막지 않도록 스레드 풀에서 실행한다."""
    import time
    import urllib.parse
    try:
        import pythoncom
        pythoncom.CoInitialize()
    except Exception:
        pythoncom = None
    try:
        target_norm = os.path.normcase(os.path.normpath(folder))
        shell = None
        try:
            import win32com.client
            shell = win32com.client.Dispatch("Shell.Application")
        except Exception:
            shell = None

        def find_window():
            if not shell:
                return None
            for w in shell.Windows():
                try:
                    loc = str(w.LocationURL)
                    if loc.startswith("file:///"):
                        wp = urllib.parse.unquote(loc[8:].replace("/", "\\"))
                        if os.path.normcase(os.path.normpath(wp)) == target_norm:
                            return w
                except Exception:
                    continue
            return None

        existing = find_window()
        if select_file:
            subprocess.Popen(f'explorer /select,"{os.path.normpath(select_file)}"')
        elif existing is not None:
            _force_foreground_window(existing.HWND)
            return
        else:
            os.startfile(folder)
        # 창이 실제로 뜰 때까지 폴링한 뒤 foreground로. 특히 /select(파일 선택)는 우리가
        # 띄운 explorer.exe가 기존 셸 프로세스에 위임하고 종료 → 창은 포그라운드 권한이 없는
        # 셸이 늦게 만들기 때문에, 고정 시간 한 번만으로는 놓쳐 브라우저 뒤에 남는다.
        w = None
        deadline = time.monotonic() + 2.0
        while w is None and time.monotonic() < deadline:
            time.sleep(0.1)
            w = find_window()
        if w is not None:
            _force_foreground_window(w.HWND)
            if select_file:
                # explorer가 파일을 선택하며 창을 늦게 재정렬하므로, 정착을 기다렸다 한 번 더.
                time.sleep(0.3)
                _force_foreground_window(w.HWND)
    except Exception:
        try:
            if select_file:
                subprocess.Popen(f'explorer /select,"{os.path.normpath(select_file)}"')
            else:
                os.startfile(folder)
        except Exception:
            pass
    finally:
        if pythoncom is not None:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass


@routes.post("/peropixfy/api/open-folder")
async def open_folder(request):
    """이미지가 저장된 폴더를 탐색기로 열고 그 창을 브라우저 앞으로 가져온다. file이
    주어지면 그 파일을 선택해 연다. output 디렉터리 밖 경로는 거부."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    try:
        out_dir = os.path.abspath(folder_paths.get_output_directory())
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)
    raw = (data.get("file") or "").strip()
    if raw and os.path.isabs(raw):
        # 사용자가 고른 절대 경로(폴더/파일) — output 제한 없이 연다.
        rel = raw
        target = os.path.abspath(raw)
    else:
        rel = raw.replace("\\", "/").strip("/")
        target = os.path.abspath(os.path.join(out_dir, rel)) if rel else os.path.join(out_dir, "PeroPixfy")
        if not (target == out_dir or target.startswith(out_dir + os.sep)):
            return web.json_response({"ok": False, "error": "invalid path"}, status=400)
    if rel and os.path.isfile(target):
        folder, select_file = os.path.dirname(target), target
    else:
        # 대상 폴더가 아직 없으면(한 번도 생성 안 함) 만들어서 연다.
        folder = target
        if not os.path.isdir(folder):
            try:
                os.makedirs(folder, exist_ok=True)
            except OSError:
                folder = os.path.dirname(target) if os.path.isdir(os.path.dirname(target)) else out_dir
        select_file = None
    try:
        await asyncio.get_event_loop().run_in_executor(None, _open_and_focus, folder, select_file)
        return web.json_response({"ok": True})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@routes.get("/peropixfy/api/presets")
async def presets_list(request):
    return web.json_response({"presets": presets.list_presets()})


@routes.post("/peropixfy/api/presets")
async def presets_create(request):
    data = await request.json()
    fn = presets.create_preset(data.get("name") or "preset", data.get("slots") or [])
    return web.json_response({"ok": True, "filename": fn})


@routes.get("/peropixfy/api/presets/{filename}")
async def presets_get(request):
    p = presets.get_preset(request.match_info["filename"])
    if p is None:
        raise web.HTTPNotFound()
    return web.json_response(p)


@routes.put("/peropixfy/api/presets/{filename}")
async def presets_update(request):
    data = await request.json()
    ok = presets.update_preset(request.match_info["filename"], data.get("name") or "preset", data.get("slots") or [])
    return web.json_response({"ok": ok}, status=200 if ok else 404)


@routes.delete("/peropixfy/api/presets/{filename}")
async def presets_delete(request):
    ok = presets.delete_preset(request.match_info["filename"])
    return web.json_response({"ok": ok}, status=200 if ok else 404)


@routes.get("/peropixfy/tags.json")
async def tags_json(request):
    # 태그 자동완성용 Danbooru 태그 목록 (ui/public/tags.json → web/tags.json).
    path = os.path.join(WEB_DIR, "tags.json")
    if not os.path.isfile(path):
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


@routes.post("/peropixfy/api/gallery/record")
async def gallery_record(request):
    data = await request.json()
    gallery.record(data["prompt_id"], json.dumps(data["params"], ensure_ascii=False),
                   source=data.get("source", "single"))
    return web.json_response({"ok": True})


@routes.post("/peropixfy/api/gallery/complete")
async def gallery_complete(request):
    data = await request.json()
    gallery.complete(data["prompt_id"], data.get("files", []))
    return web.json_response({"ok": True})


@routes.post("/peropixfy/api/gallery/fail")
async def gallery_fail(request):
    data = await request.json()
    gallery.fail(data["prompt_id"])
    return web.json_response({"ok": True})


@routes.post("/peropixfy/api/gallery/star")
async def gallery_star(request):
    data = await request.json()
    gallery.set_starred(data["prompt_id"], bool(data.get("starred")))
    return web.json_response({"ok": True})


@routes.get("/peropixfy/api/version")
async def peropix_version(request):
    """현재 버전 — 선언 버전(__version__) + git 커밋/날짜/브랜치 + 플러그인/포터블 루트 경로."""
    try:
        root = os.path.dirname(folder_paths.base_path)  # ComfyUI 폴더의 부모 = 포터블 루트(bat 위치)
    except Exception:
        root = os.path.dirname(os.path.dirname(os.path.dirname(PLUGIN_DIR)))
    info = {"version": None, "commit": None, "date": None, "branch": None,
            "isGit": False, "path": PLUGIN_DIR, "rootPath": root}
    try:
        from .. import __version__ as v
        info["version"] = v
    except Exception:
        pass
    try:
        head = _git("rev-parse", "--short", "HEAD")
        if head.returncode == 0:
            info["isGit"] = True
            info["commit"] = head.stdout.strip()
            d = _git("log", "-1", "--format=%cs")
            if d.returncode == 0:
                info["date"] = d.stdout.strip()
            b = _git("rev-parse", "--abbrev-ref", "HEAD")
            if b.returncode == 0:
                info["branch"] = b.stdout.strip()
    except Exception as e:
        info["error"] = str(e)
    return web.json_response(info)


@routes.post("/peropixfy/api/check-update")
async def peropix_check_update(request):
    """origin에서 fetch 후 HEAD가 몇 커밋 뒤처졌는지 계산(읽기 전용). 적용은 안 한다."""
    try:
        if _git("rev-parse", "--is-inside-work-tree").returncode != 0:
            return web.json_response({"ok": False, "error": "not a git checkout"})
        branch = (_git("rev-parse", "--abbrev-ref", "HEAD").stdout or "").strip() or "main"
        # fetch는 네트워크 호출 — 이벤트 루프를 막지 않도록 executor로 뺀다.
        fetch = await asyncio.get_event_loop().run_in_executor(
            None, lambda: _git("fetch", "--quiet", "origin", branch, timeout=40))
        if fetch.returncode != 0:
            return web.json_response({"ok": False, "error": (fetch.stderr or "git fetch failed").strip()})
        upstream = "origin/" + branch
        behind = int((_git("rev-list", "--count", "HEAD.." + upstream).stdout or "0").strip() or "0")
        return web.json_response({
            "ok": True, "behind": behind, "hasUpdate": behind > 0, "branch": branch,
            "current": (_git("rev-parse", "--short", "HEAD").stdout or "").strip(),
            "latest": (_git("rev-parse", "--short", upstream).stdout or "").strip(),
        })
    except subprocess.TimeoutExpired:
        return web.json_response({"ok": False, "error": "git fetch timed out"})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)})


def _delete_output_files(files, keep=None):
    """gallery 레코드의 출력 파일들을 ComfyUI output 디렉터리에서 실제로 삭제한다.
    경로 탈출 방지 — output 디렉터리 내부 파일만 지운다. keep에 든 (subfolder,
    filename) 키는 다른 레코드가 아직 참조 중이므로 보존한다."""
    keep = keep or set()
    try:
        out_dir = os.path.abspath(folder_paths.get_output_directory())
    except Exception:
        return
    for f in files or []:
        if not isinstance(f, dict):
            continue
        fn = f.get("filename")
        if not fn:
            continue
        if (f.get("subfolder") or "", fn) in keep:
            continue  # 다른 생성 기록이 공유 중인 파일 — 삭제하지 않음
        ftype = f.get("type") or "output"
        if ftype == "abs":
            # output 밖 절대경로 저장물(subfolder=절대 폴더) — 그 경로 그대로 삭제.
            path = os.path.abspath(os.path.join(f.get("subfolder") or "", os.path.basename(fn)))
            if os.path.isfile(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
            continue
        if ftype != "output":
            continue
        path = os.path.abspath(os.path.join(out_dir, f.get("subfolder") or "",
                                            os.path.basename(fn)))
        if path.startswith(out_dir + os.sep) and os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass


@routes.post("/peropixfy/api/gallery/delete")
async def gallery_delete(request):
    data = await request.json()
    pid = data["prompt_id"]
    # Delete 시 ComfyUI output 폴더의 원본 PNG도 함께 삭제한다. 단, 동일 그래프
    # 캐시로 다른 기록이 같은 파일을 공유 중이면 그 파일은 보존한다.
    _delete_output_files(gallery.get_files(pid), keep=gallery.files_referenced_by_others(pid))
    gallery.delete(pid)
    return web.json_response({"ok": True})


@routes.get("/peropixfy/api/gallery/list")
async def gallery_list(request):
    limit = int(request.query.get("limit", "100"))
    offset = int(request.query.get("offset", "0"))
    source = request.query.get("source")  # 'single' | 'multi' | 미지정(전체)
    return web.json_response({"generations": gallery.list_recent(limit, offset, source)})


@routes.post("/peropixfy/api/exists")
async def files_exist(request):
    """주어진 파일 참조들이 실제로 존재하는지 일괄 확인. 캔버스 진입 시 원본이 외부에서
    삭제된 프리뷰를 솎아내는 데 쓴다. type='abs'는 subfolder가 절대 폴더."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    files = data.get("files") or []
    out = []
    for f in files:
        ok = False
        try:
            fn = os.path.basename((f or {}).get("filename") or "")
            sub = (f or {}).get("subfolder") or ""
            typ = (f or {}).get("type") or "output"
            if fn:
                if typ == "abs":
                    p = os.path.join(sub, fn)
                else:
                    base = folder_paths.get_directory_by_type(typ)
                    p = os.path.join(base, sub, fn) if base else None
                ok = bool(p) and os.path.isfile(p)
        except Exception:
            ok = False
        out.append(ok)
    return web.json_response({"exists": out})


@routes.get("/peropixfy/api/setup/status")
async def setup_status(request):
    return web.json_response({"assets": _setup.status()})


@routes.post("/peropixfy/api/setup/download")
async def setup_download(request):
    data = await request.json()
    keys = data.get("keys") or [it["key"] for it in _setup.MANIFEST]
    return web.json_response({"started": _setup.start_download(keys)})


SETTINGS_PATH = os.path.join(PLUGIN_DIR, "data", "settings.json")


@routes.get("/peropixfy/api/settings")
async def settings_get(request):
    if os.path.isfile(SETTINGS_PATH):
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return web.json_response(json.load(f))
    return web.json_response({})


@routes.post("/peropixfy/api/settings")
async def settings_set(request):
    data = await request.json()
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return web.json_response({"ok": True})
