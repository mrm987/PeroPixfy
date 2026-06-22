// PeroPix 런처 — ComfyUI 사이드바 탭에서 전체화면 PeroPix로 전환.
// 확장 API 의존은 registerSidebarTab 하나뿐 (Style-Manager에서 검증된 패턴).
// 런처가 깨져도 /peropixfy 직접 접속은 항상 동작한다.
import { app } from "../../scripts/app.js";

// 언어: SPA(같은 오리진)가 옵션에서 저장한 peropix.ui state.lang을 우선, 없으면 시스템 언어.
function lang() {
  try {
    const ui = JSON.parse(localStorage.getItem("peropix.ui") || "{}");
    const l = ui && ui.state && ui.state.lang;
    if (l === "ko" || l === "en") return l;
  } catch {}
  return (navigator.language || "").toLowerCase().startsWith("ko") ? "ko" : "en";
}
const STR = {
  en: { title: "PeroPixfy (ESC to return)", tooltip: "PeroPixfy fullscreen", open: "Open PeroPixfy fullscreen" },
  ko: { title: "PeroPixfy (ESC로 복귀)", tooltip: "PeroPixfy 전체화면", open: "PeroPixfy 전체화면 열기" },
};
const t = () => STR[lang()];

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
  title.textContent = t().title;
  title.style.cssText = "color:#9a9aa6;font-size:12px;";
  bar.append(back, title);

  // iframe은 한 번만 만들고 display로만 전환 — 오가도 양쪽 상태가 유지됨
  const frame = document.createElement("iframe");
  frame.src = "/peropixfy";
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

// PeroPixfy 탭은 클릭=전체화면인 빈 런처라, 활성화 즉시 사이드바를 접어 빈 패널을 숨긴다.
// app.extensionManager엔 toggle API가 없어, ComfyUI가 만든 탭 버튼(.peropix-tab-button,
// 활성 시 .side-bar-button-selected)을 직접 클릭한다 — 활성 탭 재클릭 = 사이드바 접힘.
// 활성화 직후 선택 클래스가 붙는 타이밍을 대비해 짧게 재시도한다.
function collapseSidebar() {
  let tries = 0
  const attempt = () => {
    const btn = document.querySelector(".peropix-tab-button.side-bar-button-selected")
    if (btn) { btn.click(); return } // 접힌 뒤엔 selected가 사라져 재클릭되지 않음
    if (tries++ < 10) setTimeout(attempt, 30)
  }
  setTimeout(attempt, 0)
}

app.registerExtension({
  name: "PeroPix.Launcher",
  async setup() {
    // 코어 사이드바 탭이 먼저 등록되므로, 여기서 그냥 등록하면 탭 목록 맨 아래에 온다.
    // ("Templates"는 탭이 아니라 그 아래 고정 버튼이라 탭 API로는 그 위까지가 최하단.)
    app.extensionManager.registerSidebarTab({
      id: "peropix",
      icon: "pi pi-palette",
      title: "PeroPixfy",
      tooltip: t().tooltip,
      type: "custom",
      render: (el) => {
        el.innerHTML = "";
        const btn = document.createElement("button");
        btn.textContent = t().open;
        btn.style.cssText =
          "margin:12px;padding:10px 16px;width:calc(100% - 24px);cursor:pointer;";
        btn.onclick = show;
        el.append(btn);
        show(); // 탭 활성화 즉시 전체화면 전환
        collapseSidebar(); // 빈 패널이 뒤에 남지 않도록 사이드바는 접는다 (toggle API 없으면 버튼이 폴백)
      },
    });
  },
});
