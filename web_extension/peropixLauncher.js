// PeroPix 런처 — ComfyUI 사이드바 탭에서 전체화면 PeroPix로 전환.
// 확장 API 의존은 registerSidebarTab 하나뿐 (Style-Manager에서 검증된 패턴).
// 런처가 깨져도 /peropix 직접 접속은 항상 동작한다.
import { app } from "../../scripts/app.js";

let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:#16161a;display:none;flex-direction:column;";

  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:4px 8px;background:#1e1e24;border-bottom:1px solid #2e2e36;";
  const back = document.createElement("button");
  back.textContent = "← ComfyUI";
  back.style.cssText =
    "background:none;border:1px solid #2e2e36;border-radius:6px;color:#e8e8ee;padding:4px 12px;cursor:pointer;";
  back.onclick = hide;
  const title = document.createElement("span");
  title.textContent = "PeroPix (ESC로 복귀)";
  title.style.cssText = "color:#9a9aa6;font-size:12px;";
  bar.append(back, title);

  // iframe은 한 번만 만들고 display로만 전환 — 오가도 양쪽 상태가 유지됨
  const frame = document.createElement("iframe");
  frame.src = "/peropix";
  frame.style.cssText = "flex:1;border:0;";

  overlay.append(bar, frame);
  document.body.append(overlay);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.style.display !== "none") hide();
  });
  return overlay;
}

function show() {
  ensureOverlay().style.display = "flex";
}

function hide() {
  if (overlay) overlay.style.display = "none";
}

app.registerExtension({
  name: "PeroPix.Launcher",
  async setup() {
    app.extensionManager.registerSidebarTab({
      id: "peropix",
      icon: "pi pi-palette",
      title: "PeroPix",
      tooltip: "PeroPix 전체화면",
      type: "custom",
      render: (el) => {
        el.innerHTML = "";
        const btn = document.createElement("button");
        btn.textContent = "PeroPix 전체화면 열기";
        btn.style.cssText =
          "margin:12px;padding:10px 16px;width:calc(100% - 24px);cursor:pointer;";
        btn.onclick = show;
        el.append(btn);
        show(); // 탭 활성화 즉시 전환
      },
    });
  },
});
