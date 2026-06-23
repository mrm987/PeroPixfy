// ComfyUI's `app` import is intentionally removed — PeroPixComfy mounts this
// library panel standalone inside its own SPA (see mountLibrary at the bottom),
// not as a ComfyUI sidebar tab. Integration with the Workbench happens through
// callbacks injected by mountLibrary():
//   onApplyStyle(style) — apply a style's settings to the Workbench params
//   onAddLora(relPath)  — add a LoRA to the Workbench stack
let lmOpts = { onApplyStyle: () => {}, onAddLora: () => {} };

// ---------------------------------------------------------------------------
// Styling: reuse ComfyUI's own theme variables so the panel matches the native
// sidebar tabs (Queue / Model Library / Node Library) in both dark and light.
// ---------------------------------------------------------------------------
const STYLE = `
.lm-root { display:flex; flex-direction:column; height:100%; color:var(--fg-color,#fff);
  font-size:12px; box-sizing:border-box; }
/* Mode switcher at the top of the panel — segmented control between Styles
   (the headline feature) and LoRAs (the library). Each mode owns its own
   toolbar and scroll area below. */
.lm-modebar { display:flex; padding:8px; background:var(--comfy-menu-bg,#353535);
  border-bottom:1px solid var(--border-color,#4e4e4e); flex:none; }
.lm-mode-switch { display:flex; flex:1; background:var(--comfy-input-bg,#222);
  border:1px solid var(--border-color,#4e4e4e); border-radius:6px; padding:2px; }
.lm-mode-btn { flex:1; padding:5px 10px; background:transparent; border:none;
  color:var(--p-text-muted-color,#9ca3af); cursor:pointer; font-size:12px;
  border-radius:4px; transition:background .1s, color .1s, border-color .1s;
  position:relative; }
.lm-mode-btn.active { background:var(--p-primary-color,#3b82f6); color:#fff; }
.lm-mode-btn:hover:not(.active) { color:var(--fg-color,#fff); background:rgba(255,255,255,.04); }
/* Thin divider between buttons so the split-view (no-active) state still
   reads as two distinct tabs. Drawn as a ::before inside the second button
   (inset a few px from top/bottom) instead of a border-left, so the line
   sits centered in the gap and isn't clipped by either button's rounded
   corners — which made the previous border-left version look lop-sided. */
.lm-mode-btn + .lm-mode-btn::before {
  content:""; position:absolute; left:0; top:5px; bottom:5px; width:1px;
  background:var(--border-color,#4e4e4e); pointer-events:none;
  transition:background .1s;
}
/* Hide the divider whenever either neighbour is active — the blue pill
   shouldn't have a stray grey line next to it. */
.lm-mode-btn.active + .lm-mode-btn::before,
.lm-mode-btn + .lm-mode-btn.active::before { background:transparent; }
.lm-mode-panel { flex:1; display:flex; flex-direction:column; min-height:0; }
/* In split view both mode-panels are visible; add a divider between them so
   the boundary is obvious. The selector targets only the SECOND panel that
   follows another panel (i.e. when both are shown). */
.lm-mode-panel + .lm-mode-panel { border-top:2px solid var(--border-color,#4e4e4e); }
/* In split view, shrink the styles panel to its content (capped at half the
   viewport) so an empty/short gallery doesn't reserve a big blank area.
   The LoRA panel keeps flex:1 and absorbs the rest of the space.
   Applied only when the lm-compact marker is set on the styles panel — see
   setMode(). Single-styles mode leaves the panel at full height. */
.lm-mode-panel.lm-compact { flex:0 1 auto; max-height:50%; }
.lm-styles-placeholder { padding:40px 20px; text-align:center;
  color:var(--p-text-muted-color,#9ca3af); grid-column:1/-1; }
.lm-styles-placeholder .icon { font-size:48px; opacity:0.3; margin-bottom:16px; }
.lm-styles-placeholder .title { font-size:14px; font-weight:600;
  color:var(--fg-color,#fff); margin-bottom:8px; }
.lm-styles-placeholder .desc { font-size:11px; line-height:1.5; }
/* Full-screen image viewer (lightbox) — opens when the user clicks a style
   card's thumbnail. Loading the workflow is handled by an explicit button
   in the card's action row instead. */
.lm-lightbox { position:fixed; inset:0; z-index:12000;
  background:rgba(0,0,0,.92); display:flex; align-items:center;
  justify-content:center; cursor:zoom-out; animation:lm-fade-in .15s ease-out; }
.lm-lightbox-img { max-width:96vw; max-height:96vh; object-fit:contain;
  display:block; box-shadow:0 12px 40px rgba(0,0,0,.6); }
@keyframes lm-fade-in { from { opacity:0 } to { opacity:1 } }

/* Style cards use a 1:1 (square) thumbnail wrap — better for arbitrary
   ComfyUI outputs (varied aspect ratios). Matches the LoRA card's 3:4
   portrait so both grids align row-by-row at the same card height. */
.lm-style-thumb-wrap { position:relative; width:100%; padding-top:133.33%;
  background:#111; overflow:hidden; }
.lm-style-thumb { position:absolute; inset:0; width:100%; height:100%;
  object-fit:cover; display:block; }
/* Mirror the LoRA .lm-thumb.blur rule so style cards get the same NSFW
   blur treatment from the shared nsfwBlur toggle. */
.lm-style-thumb.blur { filter:blur(14px); }
/* Drop feedback: a viewport-level fixed overlay so the visual cue isn't
   constrained to the inner panel's boundingRect (which can be much smaller
   than the area the user actually drops onto). pointer-events:none keeps
   the drag-and-drop events flowing through to the real handler underneath. */
.lm-drop-overlay { position:fixed; z-index:11500;
  background:rgba(59,130,246,.08); border:4px dashed var(--p-primary-color,#3b82f6);
  display:none; align-items:center; justify-content:center;
  color:var(--p-primary-color,#3b82f6); pointer-events:none;
  box-sizing:border-box; }
/* top/left/width/height set inline by showOverlay() from sidebar's rect */
.lm-drop-overlay.show { display:flex; }
.lm-drop-overlay-msg { background:rgba(0,0,0,.72); color:#fff;
  padding:18px 28px; border-radius:14px; display:flex; flex-direction:column;
  align-items:center; gap:10px; font-size:14px; font-weight:600;
  box-shadow:0 8px 28px rgba(0,0,0,.4); }
.lm-drop-overlay-msg i { font-size:38px; color:var(--p-primary-color,#3b82f6); }
/* Style LoRA chip subtle variants */
.lm-chip.missing { opacity:.5; border-style:dashed; }
.lm-chip.disabled { text-decoration:line-through; opacity:.5; }
/* Inline strength badge inside a LoRA chip — monospace + subtle background so
   the numeric weight reads as data, not part of the LoRA name. display:inline
   (not inline-block) so the chip's own word-wrap can flow around it. */
.lm-chip .lm-strength { display:inline; margin-right:6px; padding:1px 5px;
  border-radius:4px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:11px; background:rgba(255,255,255,.08);
  color:var(--p-primary-color,#3b82f6); white-space:nowrap; }
/* Checkpoint label: NOT clickable (unlike LoRA chips), just identifying
   the foundation model used. Stripped of button-like affordances — no
   border, no background fill, no hover, default cursor. Amber color is
   kept as a visual cue tying it to the "checkpoint" concept. */
.lm-chip.ckpt { background:transparent; border-color:transparent;
  color:#fbbf24; font-weight:500; cursor:default; padding:1px 0; }
.lm-chip.ckpt:hover { border-color:transparent; }
/* Tag chip: green tint + automatic # prefix via ::before */
.lm-chip.tag { background:rgba(34,197,94,.10); border-color:#15803d;
  color:#86efac; }
.lm-chip.tag::before { content:"#"; opacity:.6; margin-right:1px; }
.lm-chip.tag:hover { border-color:#22c55e; }
.lm-chip.tag.active { background:#22c55e; color:#fff; border-color:#22c55e; }
/* Tag input field (chip-style entry in edit modal) */
.lm-tag-input { display:flex; flex-wrap:wrap; gap:4px; padding:5px;
  background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#4e4e4e);
  border-radius:6px; min-height:32px; cursor:text; }
.lm-tag-input:focus-within { border-color:var(--p-primary-color,#3b82f6); }
.lm-tag-input input { flex:1; min-width:80px; background:transparent; border:none;
  color:var(--input-text,var(--fg-color,#fff)); outline:none; font-size:12px;
  padding:2px 4px; }
.lm-tag-input .lm-chip.tag .lm-tag-x { margin-left:4px; opacity:.7; cursor:pointer;
  font-weight:700; }
.lm-tag-input .lm-chip.tag .lm-tag-x:hover { opacity:1; }
/* Active-filter bar that appears at the top of the styles scroll area when
   one or more tags are toggled on. Click any chip there to clear it. */
.lm-filter-bar { display:flex; flex-wrap:wrap; gap:5px; align-items:center;
  padding:6px 8px; margin-bottom:6px; background:rgba(34,197,94,.06);
  border:1px dashed #15803d; border-radius:6px; font-size:11px; }
.lm-filter-bar .lm-filter-label { color:var(--p-text-muted-color,#9ca3af);
  margin-right:2px; }
.lm-filter-bar .lm-filter-clear { margin-left:auto; color:var(--p-text-muted-color,#9ca3af);
  cursor:pointer; text-decoration:underline; font-size:10px; }
.lm-filter-bar .lm-filter-clear:hover { color:#fff; }
/* Prompt textarea — taller than notes; monospace optional */
.lm-field textarea.lm-prompt { min-height:60px; font-family:inherit; line-height:1.4; }
/* Cross-reference: yellow ring + pulse when a card is jumped to from the
   other tab. Removed after the animation finishes. */
@keyframes lm-flash {
  0%   { box-shadow:0 0 0 3px #fbbf24, 0 0 18px rgba(251,191,36,.55); }
  100% { box-shadow:0 0 0 0 rgba(251,191,36,0); }
}
.lm-card.lm-flash { animation:lm-flash 1.6s ease-out; }
/* Used-in-styles badge on LoRA cards: small purple chip, clickable to jump
   back to Styles filtered by this LoRA. */
.lm-chip.styles-badge { background:rgba(168,85,247,.12); border-color:#7e22ce;
  color:#d8b4fe; cursor:pointer; }
.lm-chip.styles-badge:hover { background:rgba(168,85,247,.22); border-color:#a855f7; }
/* Make Style-card LoRA chips visibly clickable when they ARE in the library */
.lm-chip:not(.missing):not(.ckpt):not(.tag):not(.empty):not(.styles-badge) {
  cursor:pointer;
}
.lm-chip.missing { cursor:default; }
/* Sticky toolbar: position:sticky attaches to the nearest scrolling ancestor.
   That might be .lm-scroll (when our flex height resolves) or an outer ComfyUI
   container — either way the toolbar pins to its top. Opaque background +
   z-index 50 keep cards from showing through. */
.lm-toolbar { position:sticky; top:0; z-index:50;
  display:flex; flex-direction:column; gap:6px; padding:8px;
  background:var(--comfy-menu-bg,#353535);
  border-bottom:1px solid var(--border-color,#4e4e4e); }
.lm-row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.lm-search { flex:1; min-width:0; background:var(--comfy-input-bg,#222);
  color:var(--input-text,var(--fg-color,#fff)); border:1px solid var(--border-color,#4e4e4e);
  border-radius:6px; padding:5px 8px; outline:none; }
/* Exact-jump lock state — the field is read-only and presented as a chip
   carrying the pinned LoRA name. Clicking anywhere on it clears + unlocks. */
.lm-search.locked { background:rgba(59,130,246,.14);
  border-color:var(--p-primary-color,#3b82f6);
  color:var(--p-primary-color,#3b82f6); font-weight:600;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  cursor:pointer; caret-color:transparent; }
.lm-search.locked::selection { background:transparent; }
/* Clearable search wrapper — used by both LoRA and Style toolbars. Input
   gets right-padding so the absolutely-positioned × button doesn't overlap
   typed text. The × matches the active blur button's accent color. */
.lm-search-wrap { flex:1; min-width:0; position:relative; display:block; }
.lm-search-wrap .lm-search { flex:none; width:100%; padding-right:28px;
  box-sizing:border-box; }
.lm-search-clear { position:absolute; right:6px; top:50%;
  transform:translateY(-50%); width:18px; height:18px; padding:0; border:none;
  background:var(--p-primary-color,#3b82f6); color:#fff; border-radius:50%;
  cursor:pointer; display:none; align-items:center; justify-content:center;
  font-size:12px; line-height:1; font-weight:700; }
.lm-search-clear.show { display:flex; }
.lm-search-clear:hover { filter:brightness(1.1); }
.lm-filter { position:relative; flex:0 1 auto; min-width:0; }
.lm-filter-btn { width:auto; max-width:220px; white-space:nowrap; overflow:hidden;
  background:var(--comfy-input-bg,#222);
  color:var(--input-text,var(--fg-color,#fff)); border:1px solid var(--border-color,#4e4e4e);
  border-radius:6px; padding:5px 8px; outline:none; font-size:12px; cursor:pointer;
  text-align:left; display:flex; justify-content:space-between; align-items:center; }
.lm-filter-btn .lm-filter-caret { font-size:9px; opacity:.6; margin-left:6px; }
.lm-filter-panel { display:none; position:absolute; top:calc(100% + 4px); left:0; right:auto; min-width:220px;
  background:var(--comfy-menu-bg,#353535); border:1px solid var(--border-color,#4e4e4e);
  border-radius:6px; padding:6px; max-height:340px; overflow-y:auto; z-index:100;
  box-shadow:0 6px 18px rgba(0,0,0,.4); }
.lm-filter-group { margin-bottom:4px; }
.lm-filter-row { display:flex; align-items:center; gap:5px; padding:2px 4px; cursor:pointer;
  font-size:11px; border-radius:3px; user-select:none; }
.lm-filter-row:hover { background:rgba(255,255,255,.06); }
.lm-filter-row.parent { font-weight:600; }
.lm-filter-row.child { padding-left:22px; opacity:.92; }
.lm-filter-row input[type=checkbox] { margin:0; cursor:pointer; flex:none; }
.lm-filter-actions { display:flex; justify-content:flex-end; gap:6px; padding-bottom:6px;
  border-bottom:1px solid var(--border-color,#4e4e4e); margin-bottom:6px; }
.lm-filter-actions .lm-btn { padding:3px 8px; font-size:11px; }
.lm-sort { background:var(--comfy-input-bg,#222); color:var(--input-text,var(--fg-color,#fff));
  border:1px solid var(--border-color,#4e4e4e); border-radius:6px; padding:0 6px;
  outline:none; font-size:12px; cursor:pointer; }
/* unify control heights inside the toolbar so the NSFW icon button, sort
   dropdown, and Scan button line up cleanly */
.lm-toolbar .lm-btn, .lm-toolbar .lm-sort { height:28px; box-sizing:border-box; }
.lm-btn { background:var(--comfy-menu-bg,#353535); color:var(--fg-color,#fff);
  border:1px solid var(--border-color,#4e4e4e); border-radius:6px; padding:5px 8px;
  cursor:pointer; display:flex; align-items:center; gap:4px; white-space:nowrap; }
.lm-btn:hover { border-color:var(--p-primary-color,#3b82f6); }
.lm-btn.active { background:var(--p-primary-color,#3b82f6); color:#fff; }
.lm-btn.danger { color:#ef4444; border-color:#7f1d1d; }
.lm-btn.danger:hover { background:#7f1d1d; color:#fff; border-color:#7f1d1d; }
.lm-meta { color:var(--p-text-muted-color,#9ca3af); font-size:11px; }
.lm-progress { height:3px; background:var(--p-primary-color,#3b82f6); width:0%; transition:width .2s; }
.lm-scroll { flex:1; overflow-y:auto; padding:8px; }
.lm-grid { display:grid; gap:8px;
  grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); align-content:start; }
/* Compact list view: each card becomes a single horizontal row with a small
   thumbnail on the left and the full card body (all chips, triggers, badges,
   actions) on the right. Hover the thumbnail for a floating enlarged preview.
   Goal: same information density per card as grid mode, but rows pack much
   tighter so more LoRAs/styles fit per screen. */
.lm-grid.list-mode { grid-template-columns:1fr; gap:3px; }
.lm-grid.list-mode .lm-card { display:grid;
  grid-template-columns:44px minmax(0,1fr); align-items:start;
  padding:4px 76px 4px 6px; gap:8px; overflow:visible; position:relative; }
.lm-grid.list-mode .lm-thumb-wrap,
.lm-grid.list-mode .lm-style-thumb-wrap { width:44px; height:44px;
  padding-top:0; flex:none; border-radius:4px; background:transparent; }
.lm-grid.list-mode .lm-thumb,
.lm-grid.list-mode .lm-style-thumb { border-radius:4px; cursor:zoom-in; }
.lm-grid.list-mode .lm-noimg { font-size:18px; }
/* Thumb-overlay tags (NSFW, ACTIVE/IN WORKFLOW, favorite star) shrink so
   they don't overflow the 44px thumb. They still render — same info as
   grid view, just smaller. */
.lm-grid.list-mode .lm-nsfw-tag,
.lm-grid.list-mode .lm-wf-tag { font-size:7px; padding:0 3px;
  letter-spacing:.2px; }
.lm-grid.list-mode .lm-wf-tags { bottom:1px; left:1px; gap:1px; }
.lm-grid.list-mode .lm-nsfw-tag { top:1px; left:1px; }
.lm-grid.list-mode .lm-fav { width:14px; height:14px; font-size:9px;
  top:1px; right:1px; }
.lm-grid.list-mode .lm-reveal { font-size:8px; padding:0; line-height:1; }
.lm-grid.list-mode .lm-body { padding:0; gap:3px; min-width:0; }
/* Actions floated to the card's right edge — vertically centered, horizontal
   row — so they don't claim a full row at the bottom of the body. The card
   reserves padding-right for this strip. */
.lm-grid.list-mode .lm-actions { position:absolute; right:6px; top:50%;
  transform:translateY(-50%); margin:0; gap:2px; flex-direction:row; }
.lm-grid.list-mode .lm-iconbtn { flex:none; padding:2px 6px; font-size:11px; }
/* Floating hover-preview popup. Lives at document.body level so it escapes
   the scroll container's overflow clipping. Positioned by JS. */
.lm-hover-preview { position:fixed; width:240px; height:240px;
  background:#111; border:2px solid var(--p-primary-color,#3b82f6);
  border-radius:6px; box-shadow:0 12px 32px rgba(0,0,0,.6);
  z-index:11500; pointer-events:none; display:none; overflow:hidden; }
.lm-hover-preview.show { display:block; }
/* The preview's child is a cloned thumb-wrap. Override the grid-mode
   aspect-ratio padding trick so the wrap fills the preview, and let the
   absolutely-positioned badges inside (NSFW, ACTIVE/IN WORKFLOW, favorite)
   render at their default sizes (list-mode shrinkers don't reach here). */
.lm-hover-preview .lm-thumb-wrap,
.lm-hover-preview .lm-style-thumb-wrap {
  position:relative; width:100%; height:100%; padding-top:0; }
.lm-hover-preview img, .lm-hover-preview video { width:100%; height:100%;
  object-fit:cover; display:block; }
.lm-section { display:flex; align-items:center; gap:5px; font-size:11px; font-weight:600;
  color:var(--p-text-muted-color,#9ca3af); padding:4px 2px; }
.lm-section.fav { color:#f5c518; }
.lm-section.rest { margin-top:10px; border-top:1px solid var(--border-color,#4e4e4e); padding-top:8px; }
.lm-card { background:var(--comfy-menu-bg,#353535); border:1px solid var(--border-color,#4e4e4e);
  border-radius:8px; overflow:hidden; display:flex; flex-direction:column; }
.lm-card.active { box-shadow:0 0 0 2px var(--p-primary-color,#3b82f6); }
.lm-card.in-wf { box-shadow:0 0 0 2px var(--p-text-muted-color,#6b7280); }
/* workflow tags sit at the bottom-left of the thumbnail, mirroring NSFW
   (top-left). When both Active and In workflow apply, ACTIVE stacks above
   IN WORKFLOW. */
.lm-wf-tags { position:absolute; bottom:4px; left:4px; display:flex;
  flex-direction:column; gap:2px; align-items:flex-start; }
.lm-wf-tag { color:#fff; font-size:9px; font-weight:700; letter-spacing:.4px;
  padding:1px 5px; border-radius:4px; background:var(--p-text-muted-color,#6b7280); }
.lm-wf-tag.active { background:var(--p-primary-color,#3b82f6); }
/* padding-top % gives a reliable 3:4 box: it's based on the element's WIDTH,
   so the height is always definite regardless of flex/grid context (unlike
   aspect-ratio, which can collapse to 0 for a flex item here). */
.lm-thumb-wrap { position:relative; width:100%; padding-top:133.33%; background:#111; overflow:hidden; }
.lm-thumb { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
.lm-thumb.blur { filter:blur(14px); }
.lm-noimg { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  color:var(--p-text-muted-color,#9ca3af); font-size:24px; }
.lm-nsfw-tag { position:absolute; top:4px; left:4px; background:#b91c1c; color:#fff;
  font-size:9px; padding:1px 5px; border-radius:4px; }
.lm-err-tag { position:absolute; bottom:4px; right:4px; background:#d97706; color:#fff;
  font-size:9px; font-weight:700; padding:1px 5px; border-radius:4px; cursor:help; }
.lm-update-tag { position:absolute; bottom:4px; right:4px; background:#16a34a; color:#fff;
  font-size:9px; font-weight:700; padding:1px 5px; border-radius:4px; cursor:help; }
/* Match the muted meta colour by default — old LoRAs may have lingering
   "N updates" indefinitely so a permanent blue highlight is too noisy. */
.lm-update-link { color:inherit; cursor:pointer; text-decoration:none; margin-left:4px; }
.lm-update-link:hover { color:var(--p-primary-color,#3b82f6); text-decoration:underline; }
/* filter on — full blue + underline so user sees they're in a filtered view */
.lm-update-link.active { color:var(--p-primary-color,#3b82f6); text-decoration:underline; }

/* small dropdown menu used by the Check Updates split button */
.lm-popmenu { position:absolute; top:calc(100% + 4px); right:0;
  background:var(--comfy-menu-bg,#353535); border:1px solid var(--border-color,#4e4e4e);
  border-radius:6px; padding:4px; box-shadow:0 6px 18px rgba(0,0,0,.4);
  z-index:60; min-width:160px; display:none; }
.lm-popmenu-item { padding:6px 10px; cursor:pointer; font-size:12px; border-radius:4px;
  white-space:nowrap; }
.lm-popmenu-item:hover { background:rgba(255,255,255,.06); }
.lm-popmenu-item[disabled] { opacity:.4; cursor:default; }
.lm-popmenu-item[disabled]:hover { background:transparent; }
.lm-popmenu-header { padding:6px 10px 4px; font-size:10px; font-weight:600;
  color:var(--p-text-muted-color,#9ca3af); letter-spacing:.3px;
  border-bottom:1px solid var(--border-color,#4e4e4e); margin-bottom:2px;
  pointer-events:none; text-transform:uppercase; }
.lm-reveal { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  cursor:pointer; color:#fff; font-size:11px; background:rgba(0,0,0,.35); }
.lm-fav { position:absolute; top:4px; right:4px; width:22px; height:22px; border-radius:50%;
  background:rgba(0,0,0,.45); color:#fff; display:flex; align-items:center; justify-content:center;
  cursor:pointer; font-size:12px; }
.lm-fav:hover { background:rgba(0,0,0,.75); }
.lm-fav.on { color:#f5c518; }
.lm-body { padding:6px 7px; display:flex; flex-direction:column; gap:4px; flex:1; }
.lm-name { font-weight:600; line-height:1.25; word-break:break-word;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.lm-base { color:var(--p-text-muted-color,#9ca3af); font-size:10px; }
.lm-triggers { display:flex; flex-wrap:wrap; gap:3px; }
.lm-chip { background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#4e4e4e);
  border-radius:4px; padding:1px 5px; font-size:10px; cursor:pointer;
  max-width:100%; overflow-wrap:anywhere; word-break:break-word; }
.lm-chip:hover { border-color:var(--p-primary-color,#3b82f6); }
.lm-toggle { font-weight:600; opacity:.85; }
.lm-chip.empty { background:transparent; border-style:dashed;
  color:var(--p-text-muted-color,#9ca3af); cursor:default; }
.lm-chip.empty:hover { border-color:var(--border-color,#4e4e4e); }
.lm-actions { display:flex; gap:4px; margin-top:auto; }
.lm-iconbtn { flex:1; text-align:center; background:var(--comfy-input-bg,#222);
  border:1px solid var(--border-color,#4e4e4e); border-radius:5px; padding:3px; cursor:pointer;
  color:var(--fg-color,#fff); }
.lm-iconbtn:hover { border-color:var(--p-primary-color,#3b82f6); }
.lm-iconbtn[disabled] { opacity:.35; cursor:default; }
/* edit modal */
.lm-overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:11000;
  display:flex; align-items:center; justify-content:center; }
.lm-modal { background:var(--comfy-menu-bg,#353535); color:var(--fg-color,#fff);
  border:1px solid var(--border-color,#4e4e4e); border-radius:10px; width:min(420px,92vw);
  max-height:88vh; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:10px; }
.lm-modal h3 { margin:0 0 4px; font-size:14px; }
.lm-field { display:flex; flex-direction:column; gap:3px; }
.lm-field label { font-size:11px; color:var(--p-text-muted-color,#9ca3af); }
.lm-field input[type=text], .lm-field textarea { background:var(--comfy-input-bg,#222);
  color:var(--input-text,var(--fg-color,#fff)); border:1px solid var(--border-color,#4e4e4e);
  border-radius:6px; padding:6px 8px; outline:none; font-family:inherit; }
.lm-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:6px; }
.lm-toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
  background:var(--p-primary-color,#3b82f6); color:#fff; padding:8px 14px; border-radius:8px;
  z-index:12000; font-size:12px; }
`;

function injectStyle() {
  if (document.getElementById("lm-style")) return;
  const s = document.createElement("style");
  s.id = "lm-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

// --- API helpers -----------------------------------------------------------
const api = {
  list: () => fetch("/peropixfy/api/library/list").then(r => r.json()),
  scan: (force) => fetch("/peropixfy/api/library/scan" + (force ? "?force=1" : ""), { method: "POST" }).then(r => r.json()),
  status: () => fetch("/peropixfy/api/library/scan-status").then(r => r.json()),
  update: (body) => fetch("/peropixfy/api/library/update", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.json()),
  favorite: (rel, fav) => fetch("/peropixfy/api/library/favorite", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel_path: rel, favorite: fav }),
  }).then(r => r.json()),
  rescan: (rel) => fetch("/peropixfy/api/library/rescan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel_path: rel }),
  }).then(r => r.json()),
  previewRescan: (rel) => fetch("/peropixfy/api/library/preview-rescan", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel_path: rel }),
  }).then(r => r.json()),
  remove: (rel) => fetch("/peropixfy/api/library/delete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel_path: rel }),
  }).then(r => r.json()),
  checkUpdates: (relPaths) => fetch("/peropixfy/api/library/check-updates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rel_paths: relPaths || null }),
  }).then(r => r.json()),
  checkUpdatesStatus: () => fetch("/peropixfy/api/library/check-updates/status").then(r => r.json()),
  uploadThumb: (rel, file) => {
    const fd = new FormData();
    fd.append("rel_path", rel);
    fd.append("file", file);
    return fetch("/peropixfy/api/library/upload-thumb", { method: "POST", body: fd }).then(r => r.json());
  },
  styleList: () => fetch("/peropixfy/api/library/styles/list").then(r => r.json()),
  styleUpload: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/peropixfy/api/library/styles/upload", { method: "POST", body: fd }).then(r => r.json());
  },
  styleUpdate: (body) => fetch("/peropixfy/api/library/styles/update", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => r.json()),
  styleDelete: (id) => fetch("/peropixfy/api/library/styles/delete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).then(r => r.json()),
  styleWorkflow: (id) => fetch(`/peropixfy/api/library/styles/workflow?id=${id}`).then(r => r.json()),
};

// Close a modal when the user clicks its backdrop — but ONLY if the click
// truly started and ended on the backdrop. A text-selection drag inside the
// modal that releases over the overlay would otherwise fire a click on the
// overlay (the nearest common ancestor of mousedown and mouseup) and close
// the dialog mid-edit.
function attachBackdropClose(overlay) {
  let downOnOverlay = false;
  overlay.addEventListener("mousedown", (e) => {
    downOnOverlay = (e.target === overlay);
  });
  overlay.addEventListener("click", (e) => {
    if (downOnOverlay && e.target === overlay) overlay.remove();
    downOnOverlay = false;
  });
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "lm-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1500);
}

// --- workflow detection ----------------------------------------------------
// ComfyUI widgets carry lora paths in two shapes: a plain string (LoraLoader,
// LoraLoaderModelOnly, stacker slots) or an object with a `lora` field
// (rgthree Power Lora Loader, which also has an `on` flag). On Windows the
// path separators may be backslashes; the DB stores forward-slash rel_paths.
//
// Two states are tracked: PRESENT (referenced anywhere on the canvas, even
// bypassed) and ACTIVE (also passes node.mode + per-slot enable checks).
// node.mode: 0=ALWAYS (active), 2=MUTE/NEVER, 4=BYPASS — confirmed in
// rgthree/web/comfyui/node_mode_relay.js and feature_group_fast_toggle.js.
function normPath(s) { return String(s).replace(/\\/g, "/"); }

// --- current Workbench stack -----------------------------------------------
// PeroPixComfy has no ComfyUI graph. Instead the Workbench owns a LoRA stack,
// which the React wrapper pushes here via the mount handle's setStack(). We
// feed it through the original applyWorkflow()/updateInWorkflow() machinery so
// the ACTIVE / IN STACK badges and the active-first sort keep working.

// [{ relPath, enabled }] — the current Workbench LoRA stack.
let currentStackEntries = [];

function getLorasInWorkflow() {
  const present = new Set();
  const active = new Set();
  for (const e of currentStackEntries) {
    if (!e || !e.relPath) continue;
    present.add(normPath(e.relPath));
    if (e.enabled !== false) active.add(normPath(e.relPath));
  }
  return { present, active };
}

// Called by the React wrapper whenever the Workbench LoRA stack changes.
function setStack(entries) {
  currentStackEntries = Array.isArray(entries) ? entries : [];
  updateInWorkflow();
}

let wfTimer = null;
let wfKey = "";

// Normalize a LoRA reference for fuzzy comparison: basename, no extension,
// lowercased. Mirrors _match_lora_to_db in py/api.py — the CivitAI Lora
// Manager plugin stores names without the .safetensors suffix, so naive
// equality against l.rel_path (which carries the full filename) never
// matches.
function _normLoraKey(s) {
  if (!s) return "";
  const base = String(s).replace(/\\/g, "/").split("/").pop();
  return base.replace(/\.(safetensors|ckpt|pt)$/i, "").toLowerCase();
}

function applyWorkflow({ present, active }) {
  // wfKey uses RAW set contents so it lines up with the key computed in
  // updateInWorkflow's short-circuit check. Matching uses NORMALIZED keys
  // to bridge bare-name (LoraManager) vs full-filename (DB rel_path) gaps.
  wfKey = [...present].sort().join("|") + "##" + [...active].sort().join("|");
  const presentKeys = new Set([...present].map(_normLoraKey));
  const activeKeys = new Set([...active].map(_normLoraKey));
  for (const l of loras) {
    const k = _normLoraKey(l.rel_path);
    l.inWorkflow = presentKeys.has(k);
    l.active = activeKeys.has(k);
  }
}

function updateInWorkflow() {
  const sets = getLorasInWorkflow();
  const key = [...sets.present].sort().join("|") + "##" + [...sets.active].sort().join("|");
  if (key === wfKey) return;          // nothing changed, skip the rerender
  applyWorkflow(sets);
  renderGrid(true);                   // 스택 변경 → 재정렬을 FLIP으로 부드럽게
}

// --- module state ----------------------------------------------------------
let loras = [];
let filter = "";
// When set (via a cross-reference jump from a style chip), `matches()` does
// strict equality on l.rel_path instead of substring search — so jumping to
// "anima-highres-aesthetic-boost" doesn't also surface "anima-highres-
// aesthetic-boost-db5b". The search input still displays the name (so the
// user sees what was jumped to and can clear via ×), but the moment they
// type, beforeinput wipes the field and the panel reverts to normal
// substring search.
let exactLoraKey = null;
let selectedBases = new Set();
let filterBtnEl = null;
let filterPanelEl = null;
let filterOutsideBound = false;
// 라이브러리 탭의 정렬·NSFW 블러 선호를 reload 후에도 보존한다.
const LM_PREFS_KEY = "peropix.library.prefs";
let _libPrefs = {};
try { _libPrefs = JSON.parse(localStorage.getItem(LM_PREFS_KEY) || "{}"); } catch (e) { _libPrefs = {}; }
function saveLibPrefs() {
  try { localStorage.setItem(LM_PREFS_KEY, JSON.stringify({ nsfwBlur, sortMode })); } catch (e) { /* ignore */ }
}
let nsfwBlur = _libPrefs.nsfwBlur !== undefined ? !!_libPrefs.nsfwBlur : true;
// 사용자가 개별로 블러 해제한 카드(rel_path) 기억 — 재정렬/재렌더(스택 추가 등) 후에도
// 다시 블러되지 않게 한다. 세션 한정(persist 안 함). 블러를 다시 ON 하면 비운다.
const _revealedNsfw = new Set();
let pollTimer = null;
let sortMode = _libPrefs.sortMode || "default";   // "default" | "name" | "date"
// Three modes: "both" (split view), "loras", "styles".
// Always start in split view on tab entry — the layout is the headline UX
// and shouldn't be hidden behind a stale single-mode preference from a
// prior session. Mode switches within the session are still honored.
let currentMode = "both";
// Tracks an active cross-reference jump. Holding the previous mode lets the
// user toggle the jump button to restore whatever layout they had before.
// Shape: {key: string, prevMode: "both"|"loras"|"styles"} | null
let activeJump = null;

// --- styles state ----------------------------------------------------------
let styles = [];
let styleFilter = "";
// Reverse of exactLoraKey: set when jumping from a LoRA card to the Styles
// tab. styleMatches() requires at least one ENABLED slot whose lora_rel_path
// equals this value — strict equality so a partial-name match doesn't pull
// in styles using a same-prefixed but different LoRA.
let exactStyleLoraKey = null;
let stylesGridEl = null;
let stylesScrollEl = null;
// Held so the drop handler (attached at the sidebar-container level for
// reliable full-area hit testing) can toggle the hover outline on the right
// element regardless of which mode is currently visible.
let stylesPanelEl = null;
let lorasPanelEl = null;
// Modebar element — keeping a direct reference avoids accidentally toggling
// buttons on stale modebar instances that ComfyUI may have left in the DOM
// across sidebar re-renders.
let modeBarEl = null;
// The sidebar tab container ComfyUI passes into buildPanel(el). Held so the
// document-level drop handler can verify the cursor is actually inside our
// sidebar tab — without this check, drops on the canvas would be hijacked
// from ComfyUI's built-in "drop PNG to load workflow" feature.
let sidebarRootEl = null;
// The latest .lm-root element built by buildPanel(). Cached so the
// active-tab poller can detach/attach it without rebuilding state.
let cachedRoot = null;
// Cache-bust token set once per page load. Any previous session that left a
// broken-image entry in the browser cache for /styles/image?file=... will
// miss this token, forcing a fresh fetch on the very first attempt rather
// than relying on onerror retry.
const LM_PAGE_TOKEN = String(Math.floor(performance.now() * 1000)) + "_" +
                      String(performance.timeOrigin || 0).slice(-6);
// Active tag filter: clicking a chip on a card toggles it here, and any style
// must contain ALL selected tags (AND-mode) to be shown. Cleared via the
// active-filter bar's clear link.
let selectedStyleTags = new Set();

// Tags stored as a single comma-separated string in the DB; parse/serialize
// here so the UI deals with arrays. Empty/whitespace entries dropped. # prefix
// stripped on input (the chip CSS renders the # itself).
function parseTags(str) {
  if (!str) return [];
  return [...new Set(
    String(str).split(",").map(s => s.trim().replace(/^#+/, ""))
      .filter(Boolean).map(s => s.toLowerCase())
  )];
}
function serializeTags(arr) {
  return [...new Set(arr.map(t => String(t).trim().replace(/^#+/, "").toLowerCase()).filter(Boolean))]
    .join(", ");
}

function setMode(mode) {
  currentMode = mode;
  // Prefer direct module references — using querySelectorAll across the whole
  // document can pick up stale panels left behind by ComfyUI sidebar re-renders.
  for (const p of [stylesPanelEl, lorasPanelEl]) {
    if (!p) continue;
    p.style.display = (mode === "both" || p.dataset.mode === mode) ? "" : "none";
  }
  // Compact-shrink the styles panel only in split view, so a near-empty
  // gallery doesn't reserve half the sidebar height. Single styles mode
  // keeps the panel at full flex:1.
  if (stylesPanelEl) {
    stylesPanelEl.classList.toggle("lm-compact", mode === "both");
  }
  if (modeBarEl) {
    for (const b of modeBarEl.querySelectorAll(".lm-mode-btn")) {
      // In split view no button is active — that's the visual cue that
      // re-selecting either tab will switch into single-panel mode.
      b.classList.toggle("active", mode !== "both" && b.dataset.mode === mode);
    }
  }
}

function buildModeBar() {
  const bar = document.createElement("div");
  bar.className = "lm-modebar";
  modeBarEl = bar;
  const sw = document.createElement("div");
  sw.className = "lm-mode-switch";
  // Styles first (headline feature). Clicking the already-active tab toggles
  // back to split view; clicking the other tab switches into single mode.
  // Direct tab interaction always clears any active cross-reference jump so
  // the next manual mode change isn't undone by toggling the jump button.
  for (const [mode, label] of [["styles", "Styles"], ["loras", "LoRAs"]]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lm-mode-btn";
    btn.dataset.mode = mode;
    btn.textContent = label;
    btn.onclick = () => {
      activeJump = null;
      setMode(currentMode === mode ? "both" : mode);
    };
    sw.appendChild(btn);
  }
  bar.appendChild(sw);
  return bar;
}

// Build the Styles panel: a sticky toolbar (search + "+" upload button) over a
// scrollable gallery grid. The whole scroll area also accepts image drops so the
// user can drag PNGs from Explorer / browser tab thumbnails straight in.
function buildStylesPanel() {
  const panel = document.createElement("div");
  panel.className = "lm-mode-panel";
  panel.dataset.mode = "styles";
  stylesPanelEl = panel;

  const toolbar = document.createElement("div");
  toolbar.className = "lm-toolbar";
  const row = document.createElement("div");
  row.className = "lm-row";

  const search = document.createElement("input");
  search.className = "lm-search";
  search.placeholder = "Search styles...";
  search.value = styleFilter;
  search.oninput = () => {
    // × clear / programmatic reset exits exact-jump mode.
    if (exactStyleLoraKey && search.value === "") {
      exactStyleLoraKey = null;
      activeJump = null;
      setExactLockState(search, false);
    }
    if (!exactStyleLoraKey) styleFilter = search.value;
    renderStylesGrid();
  };
  // Clicking the locked, exact-mode field clears it and unlocks for typing.
  search.addEventListener("click", () => {
    if (!exactStyleLoraKey) return;
    exactStyleLoraKey = null;
    activeJump = null;
    setExactLockState(search, false);
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.focus();
  });
  row.appendChild(makeClearableSearch(search));
  stylesSearchInputEl = search;

  // Hidden <input type=file> driven by a custom-styled button (same trick as
  // the LoRA thumbnail uploader, to avoid OS-localised native button text).
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  fileInput.onchange = async () => {
    for (const f of fileInput.files) await uploadStyle(f);
    fileInput.value = "";
  };
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "lm-btn";
  addBtn.innerHTML = `<i class="pi pi-plus"></i>`;
  addBtn.title = "Upload ComfyUI image (or drag onto this panel)";
  addBtn.onclick = () => fileInput.click();
  row.append(addBtn, fileInput);

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "lm-btn";
  refreshBtn.innerHTML = `<i class="pi pi-refresh"></i>`;
  refreshBtn.title = "Reload styles";
  refreshBtn.onclick = () => refreshStyles();
  row.appendChild(refreshBtn);

  // View density toggle (per-tab — Styles and LoRAs each have their own mode).
  row.appendChild(makeViewToggleButton("styles"));
  // NSFW blur toggle — shared state with the LoRA tab's button.
  row.appendChild(makeBlurButton());

  toolbar.appendChild(row);
  panel.appendChild(toolbar);

  stylesScrollEl = document.createElement("div");
  stylesScrollEl.className = "lm-scroll";

  stylesGridEl = document.createElement("div");
  stylesGridEl.className = "lm-grid";
  if (styleViewMode === "list") stylesGridEl.classList.add("list-mode");
  stylesScrollEl.appendChild(stylesGridEl);

  panel.appendChild(stylesScrollEl);
  return panel;
}

// Wrap a search <input> with a circular × button that appears when the
// field has text. Clicking the × empties the input and re-dispatches an
// 'input' event so the caller's existing oninput handler runs the same
// rendering path as user-typed clears — no second callback wiring needed.
// Lock the search input into a chip-like, non-editable display while a
// cross-reference jump is active. The user clicks the field (or ×) to unlock
// and clear — typing/Tab focus alone won't dislodge the pinned name, so they
// can't accidentally turn an exact match into a substring search.
function setExactLockState(input, on) {
  if (!input) return;
  input.classList.toggle("locked", on);
  input.readOnly = !!on;
}

function makeClearableSearch(input) {
  const wrap = document.createElement("div");
  wrap.className = "lm-search-wrap";
  wrap.appendChild(input);
  const clr = document.createElement("button");
  clr.type = "button";
  clr.className = "lm-search-clear";
  clr.textContent = "×";
  clr.title = "Clear search";
  clr.onclick = (e) => {
    e.stopPropagation();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  };
  wrap.appendChild(clr);
  const sync = () => clr.classList.toggle("show", input.value.length > 0);
  input.addEventListener("input", sync);
  sync();
  return wrap;
}

// NSFW blur is shared between the LoRA grid and the Styles grid — a user's
// blur preference is the same regardless of which tab they're looking at.
// Each toolbar has its own button; toggling either updates the shared
// `nsfwBlur` flag, refreshes BOTH buttons' visuals, and re-renders BOTH
// grids so the blur state is applied uniformly.
function makeBlurButton() {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lm-btn lm-blur-btn" + (nsfwBlur ? " active" : "");
  b.innerHTML = `<i class="pi ${nsfwBlur ? "pi-eye-slash" : "pi-eye"}"></i>`;
  b.title = "Toggle NSFW blur";
  b.onclick = toggleNsfwBlur;
  return b;
}

// Apply or remove the NSFW blur on a single thumb wrap WITHOUT touching the
// thumbnail's src — re-rendering the whole grid would force every <img> to
// re-decode and visually re-flash. innerSel is ".lm-thumb" for LoRA cards,
// ".lm-style-thumb" for Style cards.
function setWrapBlur(wrap, blurred, innerSel) {
  const el = wrap.querySelector(innerSel);
  if (!el) return;
  if (blurred) {
    el.classList.add("blur");
    if (!wrap.querySelector(".lm-reveal")) {
      const rev = document.createElement("div");
      rev.className = "lm-reveal";
      rev.textContent = "Click to reveal";
      rev.onclick = (e) => {
        e.stopPropagation();
        el.classList.remove("blur");
        rev.remove();
        const card = wrap.closest("[data-rel-path]");
        if (card) _revealedNsfw.add(card.dataset.relPath);
      };
      wrap.appendChild(rev);
    }
  } else {
    el.classList.remove("blur");
    const rev = wrap.querySelector(".lm-reveal");
    if (rev) rev.remove();
  }
}

// View density — "grid" (large thumbnails, default) or "list" (small
// thumbnails + text-focused rows, hover to enlarge). Tracked per-tab so the
// user can have, e.g., Styles in list mode while LoRAs stay in grid mode.
// CSS does the heavy lifting via .lm-grid.list-mode; we just sync the class
// on every grid inside the matching panel.
let styleViewMode = "grid";
let loraViewMode = "grid";

// Singleton floating preview overlay. Lives at document.body level so it
// escapes the scroll container's overflow clipping (CSS-only scale was
// getting cut off vertically by .lm-scroll's overflow-y:auto).
let hoverPreviewEl = null;
function showHoverPreview(wrap, mediaEl) {
  if (!mediaEl) return;
  // Read the per-tab mode from the wrap's nearest grid ancestor — avoids
  // depending on which panel called the handler.
  const grid = wrap.closest && wrap.closest(".lm-grid");
  if (!grid || !grid.classList.contains("list-mode")) return;
  if (!hoverPreviewEl) {
    hoverPreviewEl = document.createElement("div");
    hoverPreviewEl.className = "lm-hover-preview";
    document.body.appendChild(hoverPreviewEl);
  }
  hoverPreviewEl.innerHTML = "";
  // Clone the whole wrap (not just the media) so NSFW / ACTIVE / IN WORKFLOW
  // / favorite / update / scan-failed badges all ride along into the preview.
  // The preview's CSS overrides aspect-ratio + positioning so the wrap fills
  // the floating 240x240 box.
  const cloneWrap = wrap.cloneNode(true);
  cloneWrap.removeAttribute("style");
  cloneWrap.removeAttribute("data-nsfw");  // don't re-key the global blur toggle
  // The reveal overlay would block the visual — strip it. Card-level blur is
  // also removed so the preview always shows the actual image.
  const reveal = cloneWrap.querySelector(".lm-reveal");
  if (reveal) reveal.remove();
  const cloneMedia = cloneWrap.querySelector("img, video");
  if (cloneMedia) {
    cloneMedia.classList.remove("blur");
    if (cloneMedia.tagName === "VIDEO") {
      // The card-level video uses preload="none" to save bandwidth; the hover
      // preview wants the frame visible, so flip both knobs on the clone.
      cloneMedia.preload = "auto";
      cloneMedia.autoplay = true;
    }
  }
  hoverPreviewEl.appendChild(cloneWrap);
  const rect = wrap.getBoundingClientRect();
  const size = 240, margin = 8;
  let left = rect.right + margin;
  if (left + size > window.innerWidth - margin) left = rect.left - size - margin;
  if (left < margin) left = margin;
  let top = rect.top;
  if (top + size > window.innerHeight - margin) top = window.innerHeight - size - margin;
  if (top < margin) top = margin;
  hoverPreviewEl.style.left = left + "px";
  hoverPreviewEl.style.top = top + "px";
  hoverPreviewEl.classList.add("show");
}
function hideHoverPreview() {
  if (hoverPreviewEl) hoverPreviewEl.classList.remove("show");
}
// Attach hover-preview listeners to a thumb wrap. The handlers self-gate on
// the wrap's nearest .lm-grid having .list-mode, so it's safe to attach
// unconditionally at card-build time — grid-mode cards silently no-op.
function attachThumbHover(wrap) {
  if (!wrap) return;
  wrap.addEventListener("mouseenter", () => {
    const m = wrap.querySelector("img, video");
    if (m) showHoverPreview(wrap, m);
  });
  wrap.addEventListener("mouseleave", hideHoverPreview);
}

function makeViewToggleButton(tab) {
  const mode = tab === "styles" ? styleViewMode : loraViewMode;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lm-btn lm-view-btn" + (mode === "list" ? " active" : "");
  b.innerHTML = `<i class="pi ${mode === "list" ? "pi-th-large" : "pi-list"}"></i>`;
  b.title = mode === "list" ? "Switch to thumbnail view" : "Switch to compact list view";
  b.onclick = () => {
    const cur = tab === "styles" ? styleViewMode : loraViewMode;
    setViewMode(tab, cur === "list" ? "grid" : "list");
  };
  return b;
}

function setViewMode(tab, mode) {
  const panel = tab === "styles" ? stylesPanelEl : lorasPanelEl;
  if (tab === "styles") styleViewMode = mode;
  else loraViewMode = mode;
  if (!panel) return;
  for (const btn of panel.querySelectorAll(".lm-view-btn")) {
    btn.className = "lm-btn lm-view-btn" + (mode === "list" ? " active" : "");
    btn.innerHTML = `<i class="pi ${mode === "list" ? "pi-th-large" : "pi-list"}"></i>`;
    btn.title = mode === "list" ? "Switch to thumbnail view" : "Switch to compact list view";
  }
  for (const g of panel.querySelectorAll(".lm-grid")) {
    g.classList.toggle("list-mode", mode === "list");
  }
}

function toggleNsfwBlur() {
  nsfwBlur = !nsfwBlur;
  if (nsfwBlur) _revealedNsfw.clear(); // 다시 블러 ON 하면 개별 해제 기억을 비운다.
  saveLibPrefs();
  for (const btn of document.querySelectorAll(".lm-blur-btn")) {
    btn.className = "lm-btn lm-blur-btn" + (nsfwBlur ? " active" : "");
    btn.innerHTML = `<i class="pi ${nsfwBlur ? "pi-eye-slash" : "pi-eye"}"></i>`;
  }
  for (const w of document.querySelectorAll(".lm-thumb-wrap[data-nsfw='1']")) {
    setWrapBlur(w, nsfwBlur, ".lm-thumb");
  }
  for (const w of document.querySelectorAll(".lm-style-thumb-wrap[data-nsfw='1']")) {
    setWrapBlur(w, nsfwBlur, ".lm-style-thumb");
  }
}

// Lazily-created viewport overlay shown while a file is being dragged in
// Styles mode. Kept outside the sidebar tree so its size doesn't depend on
// whatever flex layout the inner panel ends up with.
let dropOverlayEl = null;
function ensureDropOverlay() {
  if (dropOverlayEl) return;
  dropOverlayEl = document.createElement("div");
  dropOverlayEl.className = "lm-drop-overlay";
  dropOverlayEl.innerHTML =
    `<div class="lm-drop-overlay-msg">` +
      `<i class="pi pi-images"></i>` +
      `<div>Drop to add as Style</div>` +
    `</div>`;
  document.body.appendChild(dropOverlayEl);
}

// Drop handlers live at document level so the hit area is everything the
// browser can see, not just whatever flex region our panel happens to be
// laid out into. ComfyUI's sidebar layout can put our root inside a
// shorter-than-visible container, leaving the panel's boundingRect smaller
// than the visible sidebar area. Going document-wide sidesteps that
// entirely. Gated on currentMode === "styles" + dataTransfer carrying real
// files, so we don't intercept text drags or trigger on the LoRA panel.
function bindStyleDropHandlers() {
  if (window.__lmStyleDropBound) return;
  window.__lmStyleDropBound = true;
  let dragDepth = 0;
  const showOverlay = () => {
    ensureDropOverlay();
    // Pin the overlay to the sidebar tab's current rect so the visual
    // feedback covers only that area, not the whole viewport.
    if (sidebarRootEl) {
      const r = sidebarRootEl.getBoundingClientRect();
      dropOverlayEl.style.top    = r.top    + "px";
      dropOverlayEl.style.left   = r.left   + "px";
      dropOverlayEl.style.width  = r.width  + "px";
      dropOverlayEl.style.height = r.height + "px";
    }
    dropOverlayEl.classList.add("show");
  };
  const hideOverlay = () => {
    if (dropOverlayEl) dropOverlayEl.classList.remove("show");
  };
  const isFilesDrag = (e) => {
    const t = e.dataTransfer?.types;
    return !!(t && [...t].includes("Files"));
  };
  const overSidebar = (e) => !!(sidebarRootEl && e.target instanceof Node
                                && sidebarRootEl.contains(e.target));
  const eligible = (e) => currentMode !== "loras" && isFilesDrag(e) && overSidebar(e);
  // Eligibility: accept drops in "styles" or "both" mode (refuse single LoRA),
  // and ONLY when the cursor is over our sidebar tab. Going document-wide
  // without the sidebar check would intercept drops on the canvas and break
  // ComfyUI's built-in "drop PNG to load workflow" feature.
  // Capture-phase listeners + stopImmediatePropagation when eligible —
  // otherwise ComfyUI's canvas drop handler (registered separately) ALSO
  // fires on the same event and loads the workflow into the graph in
  // addition to saving the style. Capture runs before target/bubble, so
  // stopping there cuts off every later handler in the chain.
  document.addEventListener("dragenter", (e) => {
    if (!eligible(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    dragDepth++;
    showOverlay();
  }, true);
  document.addEventListener("dragover", (e) => {
    if (!eligible(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener("dragleave", (e) => {
    if (currentMode === "loras") return;
    // dragleave fires when crossing element boundaries even within the
    // sidebar — only treat it as a real "left the sidebar" event when the
    // related target is outside our root (or null = left the window).
    const rt = e.relatedTarget;
    const stillInside = rt instanceof Node && sidebarRootEl && sidebarRootEl.contains(rt);
    if (stillInside) return;
    dragDepth = 0;
    hideOverlay();
  }, true);
  document.addEventListener("drop", async (e) => {
    if (!eligible(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    dragDepth = 0;
    hideOverlay();
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith("image/"));
    if (!files.length) {
      toast("Drop an image file");
      return;
    }
    for (const f of files) await uploadStyle(f);
  }, true);
}

// Replace a thumbnail <img> with a clear "missing on disk" placeholder.
// Avoids the misleading broken-image icon when the file genuinely isn't
// there (orphan DB row pointing at a deleted file).
function markThumbMissing(imgEl, file) {
  const wrap = imgEl.parentElement;
  if (!wrap) return;
  if (imgEl._lmObjectUrl) URL.revokeObjectURL(imgEl._lmObjectUrl);
  imgEl.remove();
  const ph = document.createElement("div");
  ph.className = "lm-noimg";
  ph.style.flexDirection = "column";
  ph.style.gap = "4px";
  ph.style.color = "#ef4444";
  ph.style.fontSize = "9px";
  ph.style.padding = "8px";
  ph.style.textAlign = "center";
  ph.innerHTML =
    `<i class="pi pi-exclamation-triangle" style="font-size:24px"></i>` +
    `<div>Image missing on disk</div>`;
  ph.title = `Expected file not found:\n${file}\n\nThe DB row still exists — open the edit dialog to delete it, or re-upload the image.`;
  wrap.appendChild(ph);
}

// Fetch the thumbnail bytes ourselves and hand the <img> a blob: URL. This
// sidesteps the broken-image cache that an <img src> first-load failure
// leaves behind. 404s are reported immediately (no retry — the file is gone);
// network/transient errors get a brief retry against server warm-up.
// Show the full-size image in a viewport-filling lightbox. Workflow loading
// is intentionally NOT triggered here — the card's action row has a dedicated
// "Load workflow" button for that.
// Generic full-size media viewer. Click backdrop (or press Esc) to close.
// For videos: native controls + click-on-video doesn't close (so play/pause
// hits work); clicking outside the media still closes.
function openMediaLightbox(url, opts) {
  if (!url) return;
  const isVideo = !!(opts && opts.isVideo);
  const lb = document.createElement("div");
  lb.className = "lm-lightbox";
  let el;
  if (isVideo) {
    el = document.createElement("video");
    el.src = url;
    el.controls = true;
    el.autoplay = true;
    el.loop = true;
    el.onclick = (e) => e.stopPropagation();
  } else {
    el = document.createElement("img");
    el.src = url;
    if (opts && opts.alt) el.alt = opts.alt;
  }
  el.className = "lm-lightbox-img";
  el.draggable = false; // 라이브러리 이미지 드래그 금지 — 스타일 드롭존에 실수로 떨어지는 것 방지
  lb.appendChild(el);
  const close = () => {
    lb.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  lb.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(lb);
}

function openStyleImageView(s) {
  if (!s || !s.image_file || s.image_missing) return;
  openMediaLightbox(
    `/peropixfy/api/library/styles/image?file=${encodeURIComponent(s.image_file)}`,
    { alt: s.name || "" },
  );
}

async function loadStyleThumb(imgEl, file) {
  const url = `/peropixfy/api/library/styles/image?file=${encodeURIComponent(file)}`;
  const MAX = 3;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const r = await fetch(url + "&_=" + LM_PAGE_TOKEN + "_" + attempt, {
        cache: "no-store",
      });
      if (r.status === 404) {
        // File genuinely missing — no point retrying.
        markThumbMissing(imgEl, file);
        return;
      }
      if (r.ok) {
        const blob = await r.blob();
        if (blob && blob.size > 0) {
          if (imgEl._lmObjectUrl) URL.revokeObjectURL(imgEl._lmObjectUrl);
          const objUrl = URL.createObjectURL(blob);
          imgEl._lmObjectUrl = objUrl;
          imgEl.src = objUrl;
          return;
        }
      }
    } catch (e) {
      // network blip; fall through to retry
    }
    await new Promise(res => setTimeout(res, 300 * (attempt + 1)));
  }
  console.warn(`[Style-Manager] thumbnail failed after ${MAX} attempts: ${file}`);
  markThumbMissing(imgEl, file);
}

async function refreshStyles() {
  try {
    const data = await api.styleList();
    styles = data.styles || [];
  } catch (e) {
    styles = [];
  }
  renderStylesGrid();
}

function styleMatches(s) {
  // Cross-reference jump: only styles whose ENABLED slot list contains this
  // exact lora_rel_path. Bypasses tag filter / text search entirely.
  if (exactStyleLoraKey) {
    for (const l of (s.loras || [])) {
      if (l.enabled && l.lora_rel_path === exactStyleLoraKey) return true;
    }
    return false;
  }
  // AND-mode tag filter — every selected tag must be present on the style.
  if (selectedStyleTags.size > 0) {
    const tags = new Set(parseTags(s.tags));
    for (const t of selectedStyleTags) if (!tags.has(t)) return false;
  }
  if (!styleFilter) return true;
  const q = styleFilter.toLowerCase();
  if ((s.name || "").toLowerCase().includes(q)) return true;
  if ((s.tags || "").toLowerCase().includes(q)) return true;
  if ((s.notes || "").toLowerCase().includes(q)) return true;
  if ((s.checkpoint || "").toLowerCase().includes(q)) return true;
  if ((s.positive_prompt || "").toLowerCase().includes(q)) return true;
  if ((s.negative_prompt || "").toLowerCase().includes(q)) return true;
  // Only match against ENABLED LoRAs — bypassed/muted slots are hidden on
  // the card and excluded from "Used in N styles" counts, so they shouldn't
  // pull the style into search results either.
  for (const l of (s.loras || [])) {
    if (!l.enabled) continue;
    if ((l.display_name || "").toLowerCase().includes(q)) return true;
  }
  return false;
}

function toggleTagFilter(tag) {
  if (selectedStyleTags.has(tag)) selectedStyleTags.delete(tag);
  else selectedStyleTags.add(tag);
  renderStylesGrid();
}

function buildFilterBar() {
  if (!selectedStyleTags.size) return null;
  const bar = document.createElement("div");
  bar.className = "lm-filter-bar";
  const lab = document.createElement("span");
  lab.className = "lm-filter-label";
  lab.textContent = "Filtering by:";
  bar.appendChild(lab);
  for (const t of selectedStyleTags) {
    const chip = document.createElement("span");
    chip.className = "lm-chip tag active";
    chip.textContent = t + " ×";
    chip.title = "Click to remove this tag filter";
    chip.onclick = () => toggleTagFilter(t);
    bar.appendChild(chip);
  }
  const clear = document.createElement("span");
  clear.className = "lm-filter-clear";
  clear.textContent = "Clear all";
  clear.onclick = () => { selectedStyleTags.clear(); renderStylesGrid(); };
  bar.appendChild(clear);
  return bar;
}

function renderStylesGrid() {
  if (!stylesGridEl || !stylesScrollEl) return;
  // The filter bar lives in the scroll area (above the grid) so it disappears
  // entirely when no tags are selected. Re-render destroys + recreates it.
  const prevBar = stylesScrollEl.querySelector(":scope > .lm-filter-bar");
  if (prevBar) prevBar.remove();
  const bar = buildFilterBar();
  if (bar) stylesScrollEl.insertBefore(bar, stylesGridEl);

  stylesGridEl.innerHTML = "";
  if (!styles.length) {
    const empty = document.createElement("div");
    empty.className = "lm-styles-placeholder";
    empty.innerHTML = `
      <div class="icon"><i class="pi pi-images"></i></div>
      <div class="title">No styles yet</div>
      <div class="desc">Drop a ComfyUI-generated PNG anywhere on this panel,<br>or use the <i class="pi pi-plus"></i> button above to add one.</div>
    `;
    stylesGridEl.appendChild(empty);
    return;
  }
  const visible = styles.filter(styleMatches);
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "lm-styles-placeholder";
    empty.innerHTML = `
      <div class="icon"><i class="pi pi-search"></i></div>
      <div class="title">No matches</div>
      <div class="desc">No styles match "${styleFilter.replace(/[<>&]/g, "")}".</div>
    `;
    stylesGridEl.appendChild(empty);
    return;
  }
  // newest first by created_at
  const sorted = [...visible].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  for (const s of sorted) stylesGridEl.appendChild(makeStyleCard(s));
}

// Strip the directory and extension off a LoRA path for chip display.
function loraShortName(p) {
  if (!p) return "(unknown)";
  return String(p).split("/").pop().replace(/\.(safetensors|ckpt|pt)$/i, "");
}

// Render active-LoRA chips into a wrap with a 1-chip limit + collapse/expand
// toggle. Mirrors the LoRA card's renderTriggers() pattern. Recursive — the
// toggle chip re-invokes with the flipped `expanded` flag.
const STYLE_LORA_LIMIT = 1;
// Per-style expanded state survives renderStylesGrid() rebuilds (triggered by
// search input, blur toggle, tag filter, etc.). Without this, every grid
// re-render snaps every expanded card back to collapsed.
const styleLoraExpanded = new Map();
function renderStyleLoraChips(wrap, loras, expanded, styleId) {
  if (styleId != null) styleLoraExpanded.set(styleId, !!expanded);
  wrap.innerHTML = "";
  const shown = expanded ? loras : loras.slice(0, STYLE_LORA_LIMIT);
  for (const l of shown) {
    const chip = document.createElement("span");
    chip.className = "lm-chip";
    if (!l.lora_rel_path) chip.classList.add("missing");
    let strengthTxt = "";
    if (typeof l.strength === "number") {
      strengthTxt = ` · ${l.strength.toFixed(2)}`;
      const s = document.createElement("span");
      s.className = "lm-strength";
      s.textContent = l.strength.toFixed(2);
      chip.appendChild(s);
    }
    chip.appendChild(document.createTextNode(loraShortName(l.display_name)));
    const statusTxt = !l.lora_rel_path
      ? " · not in library"
      : " · click to open in Library";
    chip.title = (l.display_name || "(unknown)") + strengthTxt + statusTxt;
    if (l.lora_rel_path) {
      chip.onclick = (e) => { e.stopPropagation(); jumpToLora(l.lora_rel_path); };
    }
    wrap.appendChild(chip);
  }
  if (loras.length > STYLE_LORA_LIMIT) {
    const tog = document.createElement("span");
    tog.className = "lm-chip lm-toggle";
    tog.textContent = expanded
      ? "Collapse ▲"
      : `+${loras.length - STYLE_LORA_LIMIT} more ▼`;
    tog.onclick = (e) => {
      e.stopPropagation();
      renderStyleLoraChips(wrap, loras, !expanded, styleId);
    };
    wrap.appendChild(tog);
  }
}

function makeStyleCard(s) {
  const card = document.createElement("div");
  card.className = "lm-card";

  // Thumbnail — clicking opens a full-size lightbox view. The "Load workflow"
  // action lives in the card's action row instead, since loading replaces
  // the canvas and shouldn't be triggered by a casual image inspection.
  const wrap = document.createElement("div");
  wrap.className = "lm-style-thumb-wrap";
  if (s.nsfw) wrap.dataset.nsfw = "1";
  wrap.style.cursor = "zoom-in";
  wrap.title = "Click to view full image";
  wrap.onclick = () => openStyleImageView(s);
  if (s.image_file) {
    const img = document.createElement("img");
    img.className = "lm-style-thumb";
    img.decoding = "async";
    img.draggable = false; // 썸네일 드래그 금지 — 스타일 드롭존 오발동 방지
    wrap.appendChild(img);
    if (s.image_missing) {
      // Backend already checked the file doesn't exist on disk — skip the
      // GET entirely and show the missing-state placeholder.
      markThumbMissing(img, s.image_file);
    } else {
      loadStyleThumb(img, s.image_file);
    }
    // NSFW blur + reveal overlay applied via the same helper used by the
    // global toggle, so the two paths can't drift.
    if (nsfwBlur && s.nsfw) setWrapBlur(wrap, true, ".lm-style-thumb");
  } else {
    const no = document.createElement("div");
    no.className = "lm-noimg";
    no.innerHTML = `<i class="pi pi-image"></i>`;
    wrap.appendChild(no);
  }
  if (s.nsfw) {
    const tag = document.createElement("span");
    tag.className = "lm-nsfw-tag";
    tag.textContent = "NSFW";
    wrap.appendChild(tag);
  }
  attachThumbHover(wrap);
  card.appendChild(wrap);

  const body = document.createElement("div");
  body.className = "lm-body";

  const name = document.createElement("div");
  name.className = "lm-name";
  name.textContent = s.name || "(untitled)";
  name.title = s.name || "";
  body.appendChild(name);

  // Tag chips sit between name and the checkpoint/LoRA chips so the user's
  // own labels read first, and the machine-extracted model info follows.
  const tagList = parseTags(s.tags);
  if (tagList.length) {
    const tagsWrap = document.createElement("div");
    tagsWrap.className = "lm-triggers";
    for (const t of tagList) {
      const chip = document.createElement("span");
      chip.className = "lm-chip tag";
      if (selectedStyleTags.has(t)) chip.classList.add("active");
      chip.textContent = t;
      chip.title = selectedStyleTags.has(t)
        ? "Click to remove this tag filter"
        : "Click to filter by this tag";
      chip.onclick = (e) => { e.stopPropagation(); toggleTagFilter(t); };
      tagsWrap.appendChild(chip);
    }
    body.appendChild(tagsWrap);
  }

  // Checkpoint chip — always shown (one foundation model per style, no need
  // to collapse). Rendered in its own wrap so the LoRA collapse/expand
  // doesn't touch it. Empty checkpoint falls back to a muted placeholder
  // mirroring the LoRA tab's "No trigger words found" treatment.
  const ckptWrap = document.createElement("div");
  ckptWrap.className = "lm-triggers";
  if (s.checkpoint) {
    const ck = document.createElement("span");
    ck.className = "lm-chip ckpt";
    ck.textContent = loraShortName(s.checkpoint);
    ck.title = "Checkpoint: " + s.checkpoint;
    ckptWrap.appendChild(ck);
  } else {
    const none = document.createElement("span");
    none.className = "lm-chip empty";
    none.textContent = "No base model found";
    ckptWrap.appendChild(none);
  }
  body.appendChild(ckptWrap);

  // Active LoRAs — limited to 1 visible chip by default, rest behind a
  // "+N more ▼" toggle (mirrors the LoRA card's trigger-word collapse).
  // Disabled (BYPASS / rgthree on=false) LoRAs are hidden from cards
  // entirely; the edit modal still has the full list for debugging.
  const activeLoras = (s.loras || []).filter(l => l.enabled);
  const loraWrap = document.createElement("div");
  loraWrap.className = "lm-triggers";
  body.appendChild(loraWrap);
  if (activeLoras.length) {
    renderStyleLoraChips(loraWrap, activeLoras,
                         styleLoraExpanded.get(s.id) || false, s.id);
  } else {
    const none = document.createElement("span");
    none.className = "lm-chip empty";
    none.textContent = "No LoRAs found";
    loraWrap.appendChild(none);
  }

  const actions = document.createElement("div");
  actions.className = "lm-actions";
  actions.appendChild(iconBtn("pi pi-arrow-left", "Apply this style to the current settings",
    () => { lmOpts.onApplyStyle(s); toast("Applied: " + (s.name || "style")); }));
  actions.appendChild(iconBtn("pi pi-pencil", "Edit",
    () => openStyleEdit(s)));
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

async function uploadStyle(file) {
  toast(`Uploading ${file.name}...`);
  let res;
  try {
    res = await api.styleUpload(file);
  } catch (e) {
    toast("Upload failed: " + e.message);
    return;
  }
  if (res && res.ok) {
    await refreshStyles();
    const n = res.style?.loras?.length ?? 0;
    toast(`Saved style (${n} LoRA${n !== 1 ? "s" : ""})`);
  } else {
    toast((res && res.error) || "Upload failed — is this a ComfyUI PNG?");
  }
}

// (loadStyleWorkflow removed — the style card's Apply button now calls
// lmOpts.onApplyStyle(s), which applies the style's settings to the Workbench
// params instead of loading a graph into a ComfyUI canvas.)

function openStyleEdit(s) {
  const overlay = document.createElement("div");
  overlay.className = "lm-overlay";
  attachBackdropClose(overlay);

  const modal = document.createElement("div");
  modal.className = "lm-modal";
  modal.innerHTML = `<h3>Edit style</h3>`;

  const fields = {};
  const addField = (key, label, value, opts) => {
    const f = document.createElement("div");
    f.className = "lm-field";
    const lab = document.createElement("label"); lab.textContent = label;
    const inp = (opts && opts.textarea) ? document.createElement("textarea") : document.createElement("input");
    if (!opts || !opts.textarea) inp.type = "text";
    else {
      inp.rows = opts.rows || 3;
      if (opts.cls) inp.className = opts.cls;
    }
    inp.value = value || "";
    f.appendChild(lab); f.appendChild(inp);
    modal.appendChild(f);
    fields[key] = inp;
  };
  addField("name", "Name", s.name);

  // Tag chip input: real chips inside the field, hidden array. Press
  // Enter/comma to commit the typed text; click × on a chip to remove it.
  const tagField = document.createElement("div");
  tagField.className = "lm-field";
  const tagLabel = document.createElement("label");
  tagLabel.textContent = "Tags";
  tagField.appendChild(tagLabel);
  const tagBox = document.createElement("div");
  tagBox.className = "lm-tag-input";
  const tagInput = document.createElement("input");
  tagInput.type = "text";
  tagInput.placeholder = "Type a tag and press Enter...";
  let tagArr = parseTags(s.tags);

  function renderTagChips() {
    // remove existing chips (keep the input)
    [...tagBox.querySelectorAll(".lm-chip")].forEach(c => c.remove());
    for (const t of tagArr) {
      const chip = document.createElement("span");
      chip.className = "lm-chip tag";
      chip.textContent = t;
      const x = document.createElement("span");
      x.className = "lm-tag-x";
      x.textContent = "×";
      x.title = "Remove";
      x.onclick = (e) => {
        e.stopPropagation();
        tagArr = tagArr.filter(tt => tt !== t);
        renderTagChips();
      };
      chip.appendChild(x);
      tagBox.insertBefore(chip, tagInput);
    }
  }
  function commitTagInput() {
    const raw = tagInput.value.trim();
    if (!raw) return;
    for (const t of parseTags(raw)) {
      if (!tagArr.includes(t)) tagArr.push(t);
    }
    tagInput.value = "";
    renderTagChips();
  }
  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTagInput();
    } else if (e.key === "Backspace" && tagInput.value === "" && tagArr.length) {
      // Backspace on empty input removes the last chip — matches most chip UIs.
      tagArr.pop();
      renderTagChips();
    }
  });
  tagInput.addEventListener("blur", commitTagInput);
  tagBox.onclick = (e) => { if (e.target === tagBox) tagInput.focus(); };
  tagBox.appendChild(tagInput);
  renderTagChips();
  tagField.appendChild(tagBox);
  modal.appendChild(tagField);

  addField("positive_prompt", "Positive prompt", s.positive_prompt,
           {textarea: true, rows: 3, cls: "lm-prompt"});
  addField("negative_prompt", "Negative prompt", s.negative_prompt,
           {textarea: true, rows: 2, cls: "lm-prompt"});
  addField("notes", "Notes", s.notes, {textarea: true, rows: 2});

  // NSFW toggle — same shape as the LoRA edit dialog.
  const nf = document.createElement("div");
  nf.className = "lm-field";
  const nsfwLabel = document.createElement("label");
  const nsfwCb = document.createElement("input");
  nsfwCb.type = "checkbox"; nsfwCb.checked = !!s.nsfw;
  nsfwLabel.style.flexDirection = "row";
  nsfwLabel.append(nsfwCb, document.createTextNode(" Mark as NSFW"));
  nf.appendChild(nsfwLabel);
  modal.appendChild(nf);

  // Read-only summary: checkpoint + LoRA list. Helps the user identify the
  // style without re-loading it on the canvas.
  if (s.checkpoint || (s.loras && s.loras.length)) {
    const summary = document.createElement("div");
    summary.className = "lm-field";
    const slab = document.createElement("label");
    slab.textContent = "Workflow summary";
    summary.appendChild(slab);
    const body = document.createElement("div");
    body.className = "lm-base";
    body.style.lineHeight = "1.5";
    const parts = [];
    if (s.checkpoint) parts.push(`<b>Checkpoint:</b> ${loraShortName(s.checkpoint)}`);
    if (s.loras && s.loras.length) {
      const names = s.loras.map(l => {
        const tag = !l.lora_rel_path ? " (missing)" : !l.enabled ? " (disabled)" : "";
        return loraShortName(l.display_name) + tag;
      });
      parts.push(`<b>LoRAs (${s.loras.length}):</b> ${names.join(", ")}`);
    }
    body.innerHTML = parts.join("<br>");
    summary.appendChild(body);
    modal.appendChild(summary);
  }

  const actions = document.createElement("div");
  actions.className = "lm-modal-actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "lm-btn danger";
  deleteBtn.innerHTML = `<i class="pi pi-trash"></i> Delete`;
  deleteBtn.title = "Permanently delete this style and its image";
  deleteBtn.style.marginRight = "auto";
  deleteBtn.onclick = async () => {
    if (deleteBtn.disabled) return;
    const ok = window.confirm(
      `Permanently delete this style?\n\n${s.name || "(untitled)"}\n\n` +
      `The image file and workflow snapshot will be removed.`
    );
    if (!ok) return;
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting...";
    const res = await api.styleDelete(s.id);
    if (res && res.ok) {
      const idx = styles.indexOf(s);
      if (idx >= 0) styles.splice(idx, 1);
      overlay.remove();
      renderStylesGrid();
      toast("Deleted");
    } else {
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = `<i class="pi pi-trash"></i> Delete`;
      toast((res && res.error) || "Delete failed");
    }
  };

  const cancel = document.createElement("button");
  cancel.className = "lm-btn"; cancel.textContent = "Cancel";
  cancel.onclick = () => overlay.remove();

  const save = document.createElement("button");
  save.className = "lm-btn active"; save.textContent = "Save";
  save.onclick = async () => {
    save.textContent = "Saving...";
    // commit any half-typed tag before sending
    commitTagInput();
    const res = await api.styleUpdate({
      id: s.id,
      name: fields.name.value,
      tags: serializeTags(tagArr),
      notes: fields.notes.value,
      positive_prompt: fields.positive_prompt.value,
      negative_prompt: fields.negative_prompt.value,
      nsfw: nsfwCb.checked ? 1 : 0,
    });
    if (res && res.ok && res.style) {
      Object.assign(s, res.style);
      renderStylesGrid();
      overlay.remove();
      toast("Saved");
    } else {
      save.textContent = "Save";
      toast((res && res.error) || "Save failed");
    }
  };

  actions.append(deleteBtn, cancel, save);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
let updateOnlyFilter = false;
let updateCheckTimer = null;

// hasUpdate: latest_version_id (set by Check Updates) differs from the current
// version embedded in civitai_url. If either is missing, no update info → false.
function hasUpdate(l) {
  if (!l.latest_version_id) return false;
  const m = (l.civitai_url || "").match(/modelVersionId=(\d+)/);
  if (!m) return false;
  return l.latest_version_id !== parseInt(m[1], 10);
}

function triggerList(l) {
  return (l.trigger_words || "").split(",").map(s => s.trim()).filter(Boolean);
}

// (category, base_model) compound key so the same base_model string under two
// different categories doesn't bleed into each other when filtering.
function itemKey(cat, base) { return `${cat} ${base}`; }

function matches(l) {
  // Cross-reference jump: strict rel_path equality, ignores all other filters
  // so the panel shows exactly the one LoRA that was jumped to.
  if (exactLoraKey) return l.rel_path === exactLoraKey;
  if (updateOnlyFilter && !hasUpdate(l)) return false;
  if (selectedBases.size > 0 &&
      !selectedBases.has(itemKey(categoryOf(l), l.base_model || ""))) return false;
  if (!filter) return true;
  const q = filter.toLowerCase();
  return (l.name || "").toLowerCase().includes(q) ||
         (l.rel_path || "").toLowerCase().includes(q) ||
         (l.trigger_words || "").toLowerCase().includes(q) ||
         (l.base_model || "").toLowerCase().includes(q);
}

// Categories now come straight from CivitAI's `baseModel` field (stored as
// l.base_category by the backend) — no hardcoded list. Rows with no
// category fall into UNKNOWN, which sits at the bottom of the filter.
const UNKNOWN = "(Unknown)";

function categoryOf(l) {
  return l.base_category || UNKNOWN;
}

// {cat, total, items:[{base,count}]}[]   — groups each LoRA by base_category,
// then counts distinct base_model values inside.
function getBaseGroups() {
  const groups = new Map();
  for (const l of loras) {
    const cat = categoryOf(l);
    const base = l.base_model || "";
    if (!groups.has(cat)) groups.set(cat, { total: 0, bases: new Map() });
    const g = groups.get(cat);
    g.bases.set(base, (g.bases.get(base) || 0) + 1);
    g.total += 1;
  }
  return [...groups.entries()]
    .map(([cat, g]) => ({
      cat,
      total: g.total,
      items: [...g.bases.entries()]
        .map(([base, count]) => ({ base, count }))
        .sort((a, b) => a.base.localeCompare(b.base)),
    }))
    .sort((a, b) => {
      if (a.cat === UNKNOWN) return 1;
      if (b.cat === UNKNOWN) return -1;
      return a.cat.localeCompare(b.cat);
    });
}

function refreshFilterUI() {
  if (!filterBtnEl || !filterPanelEl) return;
  const groups = getBaseGroups();
  // drop any selections whose (cat, base_model) pair disappeared
  const present = new Set(groups.flatMap(g => g.items.map(it => itemKey(g.cat, it.base))));
  for (const k of [...selectedBases]) if (!present.has(k)) selectedBases.delete(k);

  // button label
  filterBtnEl.innerHTML = "";
  const label = document.createElement("span");
  label.textContent = selectedBases.size === 0
    ? "All base models"
    : `${selectedBases.size} base model${selectedBases.size > 1 ? "s" : ""} selected`;
  const caret = document.createElement("span");
  caret.className = "lm-filter-caret"; caret.textContent = "▼";
  filterBtnEl.append(label, caret);

  // panel body
  filterPanelEl.innerHTML = "";

  // top action bar — Select all / Clear, always visible when there are groups
  if (groups.length > 0) {
    const actions = document.createElement("div");
    actions.className = "lm-filter-actions";

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "lm-btn";
    allBtn.textContent = "Select all";
    allBtn.onclick = (e) => {
      e.stopPropagation();
      for (const gg of groups) for (const it of gg.items) selectedBases.add(itemKey(gg.cat, it.base));
      refreshFilterUI(); renderGrid();
    };

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "lm-btn";
    clearBtn.textContent = "Clear";
    clearBtn.onclick = (e) => {
      e.stopPropagation();
      selectedBases.clear();
      refreshFilterUI(); renderGrid();
    };

    actions.append(allBtn, clearBtn);
    filterPanelEl.appendChild(actions);
  }

  for (const g of groups) {
    // Single-row collapse when the group's only item would render with the
    // same label as the group itself — empty base ("(no detail)" under
    // "(Unknown)") or base == cat (legacy rows where the old code stored
    // CivitAI's category as the detail too).
    if (g.items.length === 1 && (g.items[0].base === "" || g.items[0].base === g.cat)) {
      const key = itemKey(g.cat, g.items[0].base);
      const row = document.createElement("label");
      row.className = "lm-filter-row parent";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedBases.has(key);
      cb.onchange = () => {
        if (cb.checked) selectedBases.add(key); else selectedBases.delete(key);
        refreshFilterUI(); renderGrid();
      };
      const lab = document.createElement("span");
      lab.textContent = `${g.cat} (${g.total})`;
      row.append(cb, lab);
      filterPanelEl.appendChild(row);
      continue;
    }

    const groupEl = document.createElement("div");
    groupEl.className = "lm-filter-group";

    const childKeys = g.items.map(it => itemKey(g.cat, it.base));
    const numSel = childKeys.filter(k => selectedBases.has(k)).length;

    const parentRow = document.createElement("label");
    parentRow.className = "lm-filter-row parent";
    const parentCb = document.createElement("input");
    parentCb.type = "checkbox";
    parentCb.checked = numSel === childKeys.length;
    parentCb.indeterminate = numSel > 0 && numSel < childKeys.length;
    parentCb.onchange = () => {
      if (parentCb.checked) for (const k of childKeys) selectedBases.add(k);
      else                  for (const k of childKeys) selectedBases.delete(k);
      refreshFilterUI(); renderGrid();
    };
    const parentLabel = document.createElement("span");
    parentLabel.textContent = `${g.cat} (${g.total})`;
    parentRow.append(parentCb, parentLabel);
    groupEl.appendChild(parentRow);

    for (const it of g.items) {
      const key = itemKey(g.cat, it.base);
      const childRow = document.createElement("label");
      childRow.className = "lm-filter-row child";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedBases.has(key);
      cb.onchange = () => {
        if (cb.checked) selectedBases.add(key); else selectedBases.delete(key);
        refreshFilterUI(); renderGrid();
      };
      const lab = document.createElement("span");
      lab.textContent = `${it.base || "(no detail)"} (${it.count})`;
      childRow.append(cb, lab);
      groupEl.appendChild(childRow);
    }
    filterPanelEl.appendChild(groupEl);
  }

}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied: " + text); }
  catch { toast("Copy failed"); }
}

// --- rendering -------------------------------------------------------------
// CivitAI's CDN serves the full-res original by default (often several MB).
// Rewrite the transform segment to request a small resized thumbnail instead
// (measured ~3.8MB -> ~37KB), which is what kills scroll smoothness otherwise.
// Local-upload URLs (/peropixfy/api/library/...) and other hosts don't match and pass through.
function thumbSrc(url) {
  return url.replace(/(image\.civitai\.com\/[^/]+\/[0-9a-f-]+\/)[^/]+(\/)/i, "$1width=300$2");
}

function makeThumb(l) {
  const wrap = document.createElement("div");
  wrap.className = "lm-thumb-wrap";
  if (l.nsfw) wrap.dataset.nsfw = "1";
  const url = l.thumb_url;
  if (url) {
    let el;
    const isVideo = (l.thumb_type === "video") || /\.mp4($|\?)/i.test(url);
    if (isVideo) {
      el = document.createElement("video");
      // preload=none: don't fetch the video until the user hovers to play it
      el.src = url; el.muted = true; el.loop = true; el.playsInline = true; el.preload = "none";
      wrap.addEventListener("mouseenter", () => el.play().catch(() => {}));
      wrap.addEventListener("mouseleave", () => el.pause());
    } else {
      el = document.createElement("img");
      // Cards keep the small (~width=300) variant — decoding 720px on
      // every visible card during fast scroll showed perceptible lag, and
      // the size diff is barely visible at ~140px card width. Lightbox
      // still hits /thumb-large for the sharp full-size view.
      el.src = thumbSrc(url); el.loading = "lazy"; el.decoding = "async";
    }
    el.className = "lm-thumb";
    el.draggable = false; // 썸네일 드래그 금지 — 스타일 드롭존 오발동 방지
    wrap.appendChild(el);
    // Initial blur applied via setWrapBlur so the global toggle path and the
    // first-render path stay in sync.
    if (nsfwBlur && l.nsfw && !_revealedNsfw.has(l.rel_path)) setWrapBlur(wrap, true, ".lm-thumb");
    // Click-to-lightbox — full-resolution view, mirrors the Style card UX.
    // NSFW reveal overlay stops propagation when blur is on, so a blurred
    // thumb still requires the explicit reveal click first. For images we
    // hit the /thumb-large endpoint which serves a cached width=720 (lazy
    // downloaded on first open), falling back to the cached width=300 if
    // no source URL is on file or the upstream image is gone. Videos go
    // direct to the original URL (no separate large variant).
    wrap.style.cursor = "zoom-in";
    wrap.title = "Click to view full image";
    if (isVideo) {
      wrap.onclick = () => openMediaLightbox(url, { isVideo: true });
    } else {
      // Cache-bust by updated_at — earlier clicks (before rescan populated
      // thumb_source_url) returned a small-fallback that the browser may
      // still cache for the bare URL. Save bumps updated_at and the assign
      // in the save handler refreshes l, so post-Save clicks get a new URL.
      wrap.onclick = () => {
        const v = l.updated_at || 0;
        const largeUrl = `/peropixfy/api/library/thumb-large?rel=${encodeURIComponent(l.rel_path)}&v=${v}`;
        openMediaLightbox(largeUrl);
      };
    }
  } else {
    const no = document.createElement("div");
    no.className = "lm-noimg";
    no.innerHTML = `<i class="pi pi-image"></i>`;
    wrap.appendChild(no);
  }
  if (l.nsfw) {
    const tag = document.createElement("span");
    tag.className = "lm-nsfw-tag";
    tag.textContent = "NSFW";
    wrap.appendChild(tag);
  }
  // Scan-failed marker: hash was computed but CivitAI lookup hit a transient
  // error (5xx/timeout/network), so the row stays scanned=0. Hitting Scan
  // again — or Rescan in the edit dialog — will retry.
  if (l.sha256 && !l.scanned) {
    const err = document.createElement("span");
    err.className = "lm-err-tag";
    err.textContent = "⚠ SCAN FAILED";
    err.title = "CivitAI lookup failed (server error or timeout).\nClick Scan to retry, or open the edit dialog and use Rescan.";
    wrap.appendChild(err);
  } else if (hasUpdate(l)) {
    const up = document.createElement("span");
    up.className = "lm-update-tag";
    up.textContent = "⬆ UPDATE";
    up.title = `Newer version available: ${l.latest_version_name || "unknown"}`;
    wrap.appendChild(up);
  }
  if (l.active || l.inWorkflow) {
    const tags = document.createElement("div");
    tags.className = "lm-wf-tags";
    if (l.active) {
      const at = document.createElement("span");
      at.className = "lm-wf-tag active";
      at.textContent = "ACTIVE";
      tags.appendChild(at);
    }
    if (l.inWorkflow) {
      const wt = document.createElement("span");
      wt.className = "lm-wf-tag";
      wt.textContent = "IN STACK";
      tags.appendChild(wt);
    }
    wrap.appendChild(tags);
  }
  const fav = document.createElement("div");
  fav.className = "lm-fav" + (l.favorite ? " on" : "");
  fav.innerHTML = `<i class="pi ${l.favorite ? "pi-star-fill" : "pi-star"}"></i>`;
  fav.title = l.favorite ? "Remove from favorites" : "Add to favorites";
  fav.onclick = (e) => { e.stopPropagation(); toggleFavorite(l); };
  wrap.appendChild(fav);
  attachThumbHover(wrap);
  return wrap;
}

async function toggleFavorite(l) {
  l.favorite = l.favorite ? 0 : 1;
  renderGrid();                     // move card between sections immediately
  await api.favorite(l.rel_path, l.favorite);
}

const TRIGGER_LIMIT = 1;

function triggerChip(t) {
  const chip = document.createElement("span");
  chip.className = "lm-chip";
  chip.textContent = t;
  chip.title = "Click to copy";
  // 프롬프트에 바로 이어 붙일 수 있도록 뒤에 쉼표를 달아 복사한다.
  chip.onclick = () => copy(t + ", ");
  return chip;
}

// Show only the first few triggers; collapse the rest behind an expander.
// (CivitAI trainedWords can include dozens of tags and long caption phrases.)
// Per-LoRA expanded state survives renderGrid() rebuilds (search input, blur
// toggle, etc.) — same rationale as styleLoraExpanded above.
const loraTriggerExpanded = new Map();
function renderTriggers(wrap, words, expanded, loraKey) {
  if (loraKey != null) loraTriggerExpanded.set(loraKey, !!expanded);
  wrap.innerHTML = "";
  const shown = expanded ? words : words.slice(0, TRIGGER_LIMIT);
  shown.forEach(t => wrap.appendChild(triggerChip(t)));
  if (words.length > TRIGGER_LIMIT) {
    const tog = document.createElement("span");
    tog.className = "lm-chip lm-toggle";
    tog.textContent = expanded ? "Collapse ▲" : `+${words.length - TRIGGER_LIMIT} more ▼`;
    tog.onclick = (e) => { e.stopPropagation(); renderTriggers(wrap, words, !expanded, loraKey); };
    wrap.appendChild(tog);
  }
}

// ---------------------------------------------------------------------------
// Cross-reference jumps between Styles and LoRAs tabs
// ---------------------------------------------------------------------------

// Strip the extension off a filename so it works in a substring search.
function bareName(p) {
  return String(p || "").split("/").pop().replace(/\.(safetensors|ckpt|pt)$/i, "");
}

function flashCard(card) {
  if (!card) return;
  card.classList.remove("lm-flash");
  // restart the animation by reflowing — toggling class alone won't replay it
  void card.offsetWidth;
  card.classList.add("lm-flash");
  setTimeout(() => card.classList.remove("lm-flash"), 1700);
}

// Toggle-aware cross-reference jumps.
//
// On a NEW jump: remember the current mode in activeJump.prevMode, force
// split view (both panels visible so the user can see source and target at
// once), and set the relevant search filter.
//
// On a REPEAT click of the same jump key: restore prevMode and clear the
// filter — the user has indicated they want to back out of the jump. The
// per-jump key distinguishes Styles→LoRA from LoRA→Styles for the same
// rel_path so they each toggle independently.
//
// When already jumped and a DIFFERENT jump key is clicked, the prevMode is
// preserved (so the user can keep exploring and one more toggle still
// restores their pre-jump layout).

function _beginJump(key) {
  if (activeJump && activeJump.key === key) return null;          // signals "toggle off"
  const prevMode = activeJump ? activeJump.prevMode : currentMode;
  activeJump = { key, prevMode };
  return prevMode;
}

function _endJump() {
  const prev = activeJump ? activeJump.prevMode : "both";
  activeJump = null;
  return prev;
}

// Styles tab → LoRA card.
function jumpToLora(relPath) {
  if (!relPath) return;
  const key = "lora:" + relPath;
  if (activeJump && activeJump.key === key) {
    const prev = _endJump();
    exactLoraKey = null;
    filter = "";
    if (searchInputEl) {
      setExactLockState(searchInputEl, false);
      searchInputEl.value = "";
      searchInputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setMode(prev);
    renderGrid();
    return;
  }
  _beginJump(key);
  setMode("both");
  selectedBases.clear();
  updateOnlyFilter = false;
  // Show the bare name in the search box for visual context, but the actual
  // match key is the full rel_path — strict equality via exactLoraKey.
  exactLoraKey = relPath;
  filter = "";
  if (searchInputEl) {
    searchInputEl.value = bareName(relPath);
    setExactLockState(searchInputEl, true);
    // dispatch so the × clear-button shows up. oninput respects exactLoraKey
    // and won't overwrite it with substring search.
    searchInputEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
  refreshFilterUI();
  renderGrid();
  // wait one frame so the rendered card exists in the DOM
  requestAnimationFrame(() => {
    // Pull the LoRA panel into the sidebar's visible region first — in
    // split view the panel can sit below the fold, so just scrolling the
    // card inside its own scroll container wouldn't move the user's view.
    if (lorasPanelEl) {
      lorasPanelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (!scrollEl) return;
    const card = scrollEl.querySelector(`.lm-card[data-rel-path="${CSS.escape(relPath)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      flashCard(card);
    }
  });
}

// LoRA card → Styles tab.
function jumpToStylesUsingLora(relPath) {
  if (!relPath) return;
  const key = "style-for:" + relPath;
  if (activeJump && activeJump.key === key) {
    const prev = _endJump();
    exactStyleLoraKey = null;
    styleFilter = "";
    if (stylesSearchInputEl) {
      setExactLockState(stylesSearchInputEl, false);
      stylesSearchInputEl.value = "";
      stylesSearchInputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setMode(prev);
    renderStylesGrid();
    return;
  }
  _beginJump(key);
  setMode("both");
  exactStyleLoraKey = relPath;
  styleFilter = "";
  if (stylesSearchInputEl) {
    stylesSearchInputEl.value = bareName(relPath);
    setExactLockState(stylesSearchInputEl, true);
    stylesSearchInputEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
  renderStylesGrid();
  requestAnimationFrame(() => {
    // Same trick — bring the Styles panel into view before flashing the
    // matched cards (a single LoRA can be referenced by multiple styles).
    if (stylesPanelEl) {
      stylesPanelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (!stylesGridEl) return;
    const cards = stylesGridEl.querySelectorAll(".lm-card");
    for (const c of cards) flashCard(c);
  });
}

function makeCard(l) {
  const card = document.createElement("div");
  card.className = "lm-card" + (l.active ? " active" : (l.inWorkflow ? " in-wf" : ""));
  card.dataset.relPath = l.rel_path || "";
  card.appendChild(makeThumb(l));

  const body = document.createElement("div");
  body.className = "lm-body";

  // Card shows the FILENAME (sans extension), not the CivitAI title — same
  // post can have multiple versions with identical names, only the filename
  // distinguishes them. The CivitAI name is still in l.name for the edit
  // dialog + search.
  const name = document.createElement("div");
  name.className = "lm-name";
  name.textContent = (l.file_name || l.rel_path || "").replace(/\.(safetensors|ckpt|pt)$/i, "");
  name.title = l.name ? `${l.name}\n${l.rel_path}` : l.rel_path;
  body.appendChild(name);

  const baseLabel = l.base_model || l.base_category;
  const base = document.createElement("div");
  base.className = "lm-base";
  base.textContent = baseLabel || "No base model info";
  body.appendChild(base);

  const triggers = triggerList(l);
  const wrap = document.createElement("div");
  wrap.className = "lm-triggers";
  if (triggers.length) {
    renderTriggers(wrap, triggers, loraTriggerExpanded.get(l.rel_path) || false, l.rel_path);
  } else {
    const none = document.createElement("span");
    none.className = "lm-chip empty";
    none.textContent = "No trigger words found";
    wrap.appendChild(none);
  }
  body.appendChild(wrap);

  // "Used in N styles" badge — clickable, jumps to Styles tab filtered to
  // this LoRA. Hidden when count is 0 to avoid clutter.
  if (l.style_count && l.style_count > 0) {
    const refWrap = document.createElement("div");
    refWrap.className = "lm-triggers";
    const badge = document.createElement("span");
    badge.className = "lm-chip styles-badge";
    badge.textContent = `Used in ${l.style_count} style${l.style_count !== 1 ? "s" : ""}`;
    badge.title = "Click to filter Styles tab by this LoRA";
    badge.onclick = (e) => { e.stopPropagation(); jumpToStylesUsingLora(l.rel_path); };
    refWrap.appendChild(badge);
    body.appendChild(refWrap);
  }

  const actions = document.createElement("div");
  actions.className = "lm-actions";
  const allTriggers = triggers.join(", ");
  actions.appendChild(iconBtn("pi pi-plus", "Add to the Workbench LoRA stack",
    () => {
      lmOpts.onAddLora(l.rel_path);
      toast("Added to stack: " + (l.file_name || l.rel_path || "").replace(/\.(safetensors|ckpt|pt)$/i, ""));
    }));
  actions.appendChild(iconBtn("pi pi-copy", "Copy all triggers", () => copy(allTriggers), !allTriggers));
  actions.appendChild(iconBtn("pi pi-external-link", "Open on CivitAI",
    () => window.open(l.civitai_url, "_blank"), !l.civitai_url));
  actions.appendChild(iconBtn("pi pi-pencil", "Edit", () => openEdit(l)));
  body.appendChild(actions);

  card.appendChild(body);
  return card;
}

function iconBtn(icon, title, onclick, disabled) {
  const b = document.createElement("div");
  b.className = "lm-iconbtn";
  b.innerHTML = `<i class="${icon}"></i>`;
  b.title = title;
  if (disabled) b.setAttribute("disabled", "");
  else b.onclick = onclick;
  return b;
}

let scrollEl, metaEl, progressEl;
// Held so jumpToLora() (called from a Styles-card LoRA chip) can mirror the
// programmatic filter back into the visible search box.
let searchInputEl = null;
// Styles toolbar's search input — same purpose as searchInputEl, for the
// reverse jump (LoRA card → Styles tab filtered by that LoRA).
let stylesSearchInputEl = null;
// Check-updates split-button menu + its wrapper — kept at module scope (not as
// closure locals) so the single global outside-click listener always targets
// the CURRENT menu, even after the panel is unmounted/remounted. ComfyUI's
// sidebar rarely re-rendered, but PeroPixComfy's drawer opens/closes often.
let checkMenuEl = null;
let checkWrapEl = null;

function makeGrid(list) {
  const g = document.createElement("div");
  g.className = "lm-grid";
  if (loraViewMode === "list") g.classList.add("list-mode");
  list.forEach(l => g.appendChild(makeCard(l)));
  return g;
}

function sectionHeader(text, cls) {
  const h = document.createElement("div");
  h.className = "lm-section " + cls;
  h.textContent = text;
  return h;
}

// Within each section, float active → in-workflow → rest to the top.
// Array.sort is stable since ES2019 so the rest preserve alphabetical order.
function workflowRank(l) { return l.active ? 0 : (l.inWorkflow ? 1 : 2); }
function sortByWorkflow(list) {
  return [...list].sort((a, b) => workflowRank(a) - workflowRank(b));
}

function sortLoras(list) {
  // Default mode keeps the 3-rank ordering (active → inWorkflow → rest).
  if (sortMode === "default") return sortByWorkflow(list);

  // Name/date modes use a BINARY workflow rank (in-workflow vs not), so
  // active and inWorkflow-only cards share the top bucket and the chosen
  // sort applies across them. Otherwise alphabetical/date order gets broken
  // up by the active/inWorkflow sub-distinction.
  let secondary;
  if (sortMode === "name") {
    secondary = (a, b) =>
      (a.file_name || a.rel_path || "").toLowerCase()
        .localeCompare((b.file_name || b.rel_path || "").toLowerCase());
  } else {  // date
    const key = l => l.ctime || l.updated_at || 0;
    secondary = (a, b) => key(b) - key(a);
  }
  return [...list].sort((a, b) => {
    const ar = a.inWorkflow ? 0 : 1;
    const br = b.inWorkflow ? 0 : 1;
    return ar !== br ? ar - br : secondary(a, b);
  });
}

// FLIP 재정렬 애니메이션 — 카드를 옛 위치로 순간이동시켰다가 원위치로 트랜지션해 슬라이드시킨다.
// (rel_path로 매칭하므로 innerHTML 재생성 후에도 같은 카드를 추적해 움직임을 연출.)
function _flipFrom(oldRects) {
  const moves = [];
  for (const card of scrollEl.querySelectorAll(".lm-card[data-rel-path]")) {
    const old = oldRects.get(card.dataset.relPath);
    if (!old) continue;            // 이전에 없던(새로 들어온) 카드는 슬라이드 없이 표시
    const now = card.getBoundingClientRect();
    const dx = old.left - now.left, dy = old.top - now.top;
    if (dx || dy) moves.push([card, dx, dy]);
  }
  if (!moves.length) return;
  for (const [card, dx, dy] of moves) {
    card.style.transition = "none";
    card.style.transform = `translate(${dx}px, ${dy}px)`;
    // 위로 올라가는 카드(dy가 클수록 더 많이 상승)를 위 레이어로 올려, 내려오는 카드에
    // 가려지지 않게 한다. (z-index는 position이 있어야 적용되므로 relative 부여.)
    card.style.position = "relative";
    card.style.zIndex = String(Math.max(1, Math.round(dy)));
  }
  void scrollEl.offsetWidth;       // 강제 리플로우로 역변환을 먼저 커밋
  for (const [card] of moves) {
    card.style.transition = "transform 0.5s ease";  // 동작이 보이도록 충분히 느리게
    card.style.transform = "";
    setTimeout(() => {
      card.style.transition = "";
      card.style.position = "";
      card.style.zIndex = "";
    }, 560);
  }
}

function renderGrid(animate = false) {
  if (!scrollEl) return;
  // 스택 추가 등 재정렬 시 부드럽게: 지우기 전 카드 위치를 rel_path별로 캡처.
  const oldRects = animate
    ? new Map([...scrollEl.querySelectorAll(".lm-card[data-rel-path]")].map((c) => [c.dataset.relPath, c.getBoundingClientRect()]))
    : null;
  scrollEl.innerHTML = "";
  const visible = loras.filter(matches);
  const favs = sortLoras(visible.filter(l => l.favorite));
  const rest = sortLoras(visible.filter(l => !l.favorite));
  if (favs.length) {
    scrollEl.appendChild(sectionHeader(`★ Favorites ${favs.length}`, "fav"));
    scrollEl.appendChild(makeGrid(favs));
  }
  if (rest.length) {
    if (favs.length) scrollEl.appendChild(sectionHeader(`All ${rest.length}`, "rest"));
    scrollEl.appendChild(makeGrid(rest));
  }
  if (oldRects) _flipFrom(oldRects);
  if (metaEl) {
    const scanned = loras.filter(l => l.source === "civitai").length;
    const updates = loras.filter(hasUpdate).length;
    metaEl.innerHTML = "";
    metaEl.appendChild(document.createTextNode(
      `${visible.length}/${loras.length} shown · ${scanned} matched`
    ));
    if (updates > 0) {
      metaEl.appendChild(document.createTextNode(" · "));
      const link = document.createElement("a");
      link.className = "lm-update-link";
      link.textContent = `${updates} update${updates > 1 ? "s" : ""}`;
      link.title = updateOnlyFilter ? "Show all" : "Show only LoRAs with updates available";
      link.href = "#";
      if (updateOnlyFilter) link.classList.add("active");
      link.onclick = (e) => {
        e.preventDefault();
        updateOnlyFilter = !updateOnlyFilter;
        renderGrid();
      };
      metaEl.appendChild(link);
    } else if (updateOnlyFilter) {
      // safety: if no updates and filter was on, turn it off
      updateOnlyFilter = false;
    }
  }
}

// --- edit modal ------------------------------------------------------------
function openEdit(l) {
  const overlay = document.createElement("div");
  overlay.className = "lm-overlay";
  attachBackdropClose(overlay);

  const modal = document.createElement("div");
  modal.className = "lm-modal";
  modal.innerHTML = `<h3>Edit LoRA</h3>`;

  const fields = {};
  const addField = (key, label, value, textarea) => {
    const f = document.createElement("div");
    f.className = "lm-field";
    const lab = document.createElement("label"); lab.textContent = label;
    const inp = textarea ? document.createElement("textarea") : document.createElement("input");
    if (!textarea) inp.type = "text";
    else inp.rows = 2;
    inp.value = value || "";
    f.appendChild(lab); f.appendChild(inp);
    modal.appendChild(f);
    fields[key] = inp;
  };
  // Filename — read-only display, matches what the card shows. Renaming the
  // file is intentionally not supported (would diverge from the actual file).
  const fnField = document.createElement("div");
  fnField.className = "lm-field";
  const fnLabel = document.createElement("label");
  fnLabel.textContent = "Filename";
  const fnInput = document.createElement("input");
  fnInput.type = "text";
  fnInput.value = (l.file_name || l.rel_path || "").replace(/\.(safetensors|ckpt|pt)$/i, "");
  fnInput.readOnly = true;
  fnInput.style.opacity = "0.7";
  fnInput.style.cursor = "default";
  fnField.append(fnLabel, fnInput);
  modal.appendChild(fnField);

  addField("name", "CivitAI title", l.name);

  // Base category — text + datalist of categories already present in the DB
  const catField = document.createElement("div");
  catField.className = "lm-field";
  const catLabel = document.createElement("label");
  catLabel.textContent = "Base model";
  const catInput = document.createElement("input");
  catInput.type = "text";
  catInput.value = l.base_category || "";
  catInput.setAttribute("list", "lm-cat-suggest");
  const datalist = document.createElement("datalist");
  datalist.id = "lm-cat-suggest";
  const knownCats = [...new Set(loras.map(x => x.base_category).filter(Boolean))].sort();
  for (const c of knownCats) {
    const opt = document.createElement("option");
    opt.value = c;
    datalist.appendChild(opt);
  }
  catField.append(catLabel, catInput, datalist);
  modal.appendChild(catField);
  fields.base_category = catInput;

  addField("base_model", "Trained on", l.base_model);
  addField("trigger_words", "Trigger words (comma-separated)", l.trigger_words, true);
  addField("civitai_url", "CivitAI link", l.civitai_url);
  addField("thumb_url", "Thumbnail URL", l.thumb_url);

  // nsfw toggle
  const nf = document.createElement("div");
  nf.className = "lm-field";
  const nsfwLabel = document.createElement("label");
  const nsfwCb = document.createElement("input");
  nsfwCb.type = "checkbox"; nsfwCb.checked = !!l.nsfw;
  nsfwLabel.style.flexDirection = "row";
  nsfwLabel.append(nsfwCb, document.createTextNode(" Mark as NSFW"));
  nf.appendChild(nsfwLabel);
  modal.appendChild(nf);

  // thumbnail upload — hide the native file input (its button text is drawn by
  // the browser in the OS language) and drive it from a custom English button.
  const upf = document.createElement("div");
  upf.className = "lm-field";
  const upLabel = document.createElement("label"); upLabel.textContent = "Upload thumbnail image";
  const upInput = document.createElement("input");
  upInput.type = "file"; upInput.accept = "image/*"; upInput.style.display = "none";
  const upRow = document.createElement("div"); upRow.className = "lm-row";
  const upBtn = document.createElement("button");
  upBtn.type = "button"; upBtn.className = "lm-btn";
  upBtn.innerHTML = `<i class="pi pi-upload"></i> Choose image`;
  upBtn.onclick = () => upInput.click();
  const upName = document.createElement("span");
  upName.className = "lm-base"; upName.textContent = "No file chosen";
  upInput.onchange = () => { upName.textContent = upInput.files[0] ? upInput.files[0].name : "No file chosen"; };
  upRow.append(upBtn, upName);
  upf.append(upLabel, upInput, upRow);
  modal.appendChild(upf);

  const actions = document.createElement("div");
  actions.className = "lm-modal-actions";
  const cancel = document.createElement("button");
  cancel.className = "lm-btn"; cancel.textContent = "Cancel";
  cancel.onclick = () => overlay.remove();
  const save = document.createElement("button");
  save.className = "lm-btn active"; save.textContent = "Save";
  save.onclick = async () => {
    save.textContent = "Saving...";
    if (upInput.files && upInput.files[0]) {
      const up = await api.uploadThumb(l.rel_path, upInput.files[0]);
      if (up.ok) fields.thumb_url.value = up.thumb_url;
    }
    const body = {
      rel_path: l.rel_path,
      name: fields.name.value,
      base_category: fields.base_category.value,
      base_model: fields.base_model.value,
      trigger_words: fields.trigger_words.value,
      civitai_url: fields.civitai_url.value,
      thumb_url: fields.thumb_url.value,
      nsfw: nsfwCb.checked ? 1 : 0,
    };
    const res = await api.update(body);
    if (res.ok) {
      Object.assign(l, res.lora);
      renderGrid();
      overlay.remove();
      toast("Saved");
    } else {
      save.textContent = "Save";
      toast("Save failed");
    }
  };
  const rescanBtn = document.createElement("button");
  rescanBtn.type = "button";
  rescanBtn.className = "lm-btn";
  rescanBtn.innerHTML = `<i class="pi pi-refresh"></i> Rescan`;
  rescanBtn.title = "Re-fetch metadata from CivitAI, overwriting existing data";
  rescanBtn.style.marginRight = "auto";   // pushes Cancel/Save to the right
  rescanBtn.onclick = async () => {
    rescanBtn.disabled = true;
    rescanBtn.textContent = "Rescanning...";
    // Preview-only: DB stays untouched until the user clicks Save.
    // Cancel discards everything.
    const res = await api.previewRescan(l.rel_path);
    if (res && res.ok && res.preview) {
      const p = res.preview;
      fields.name.value = p.name || "";
      fields.base_category.value = p.base_category || "";
      fields.base_model.value = p.base_model || "";
      fields.trigger_words.value = p.trigger_words || "";
      fields.civitai_url.value = p.civitai_url || "";
      fields.thumb_url.value = p.thumb_url || "";
      nsfwCb.checked = !!p.nsfw;
      toast("Rescanned — review and Save to apply");
    } else {
      toast((res && res.error) || "Rescan failed");
    }
    rescanBtn.disabled = false;
    rescanBtn.innerHTML = `<i class="pi pi-refresh"></i> Rescan`;
  };
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "lm-btn danger";
  deleteBtn.innerHTML = `<i class="pi pi-trash"></i> Delete`;
  deleteBtn.title = "Permanently delete this LoRA file (no Recycle Bin)";
  deleteBtn.onclick = async () => {
    if (deleteBtn.disabled) return;
    const ok = window.confirm(
      `Permanently delete this LoRA?\n\n${l.file_name || l.rel_path}\n\n` +
      `This deletes the file from disk and CANNOT be undone (no Recycle Bin).`
    );
    if (!ok) return;
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting...";
    const res = await api.remove(l.rel_path);
    if (res && res.ok) {
      // remove from local array + close modal + repaint
      const idx = loras.indexOf(l);
      if (idx >= 0) loras.splice(idx, 1);
      overlay.remove();
      renderGrid();
      toast("Deleted");
    } else {
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = `<i class="pi pi-trash"></i> Delete`;
      toast((res && res.error) || "Delete failed");
    }
  };
  actions.append(deleteBtn, rescanBtn, cancel, save);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// --- scan / polling --------------------------------------------------------
async function refresh() {
  const data = await api.list();
  loras = data.loras || [];
  applyWorkflow(getLorasInWorkflow());   // seed inWorkflow + active before paint
  refreshFilterUI();
  renderGrid();
  // React 쪽(로라 드롭다운 썸네일 등)이 같은 목록을 공유하도록 동기화 — 엔진이
  // 로라 목록을 새로 받을 때마다(마운트·스캔 폴링·완료) 호출된다.
  if (lmOpts.onLorasRefreshed) lmOpts.onLorasRefreshed(loras);
  return data;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const s = await api.status();
    if (progressEl) progressEl.style.width = s.total ? `${(s.done / s.total) * 100}%` : "0%";
    if (metaEl && s.scanning) metaEl.textContent = `Scanning ${s.done}/${s.total} · ${s.current}`;
    await refresh();
    if (!s.scanning) {
      clearInterval(pollTimer); pollTimer = null;
      if (progressEl) progressEl.style.width = "0%";
      renderGrid();
    }
  }, 1000);
}

async function doScan(force) {
  const r = await api.scan(force);
  if (r.started) startPolling();
}

function pollUpdateCheck(btn) {
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  btn.disabled = true;
  const origHtml = btn.innerHTML;
  btn.innerHTML = `<i class="pi pi-spin pi-spinner"></i>`;
  updateCheckTimer = setInterval(async () => {
    const s = await api.checkUpdatesStatus();
    if (s.checking && s.total > 0 && metaEl) {
      metaEl.textContent = `Checking updates ${s.done}/${s.total}...`;
    }
    if (!s.checking) {
      clearInterval(updateCheckTimer);
      updateCheckTimer = null;
      btn.disabled = false;
      btn.innerHTML = origHtml;
      // toast result with wording that distinguishes 0-updates from failure
      let msg;
      if (s.total === 0) msg = "Nothing to check (no CivitAI-matched LoRAs)";
      else if (s.errors === s.total) msg = "Update check failed · CivitAI unreachable";
      else if (s.errors > 0) msg = `Checked: ${s.updates} update${s.updates !== 1 ? "s" : ""} · ${s.errors} error${s.errors !== 1 ? "s" : ""}`;
      else if (s.updates === 0) msg = "Update check complete · all up to date";
      else msg = `Found ${s.updates} update${s.updates !== 1 ? "s" : ""}`;
      toast(msg);
      await refresh();   // pull latest_version_id into the cards
    }
  }, 1000);
}

// --- main render (called by the sidebar tab) -------------------------------
function buildPanel(el) {
  injectStyle();
  sidebarRootEl = el;
  el.innerHTML = "";
  const root = document.createElement("div");
  root.className = "lm-root";
  cachedRoot = root;

  // Mode switcher at the very top, then a per-mode panel below.
  root.appendChild(buildModeBar());
  root.appendChild(buildStylesPanel());

  // LoRAs panel — wraps the existing toolbar + scroll. Toolbar still
  // position:sticky inside this panel's flex column so it pins to top while
  // the scroll area below it scrolls.
  const lorasPanel = document.createElement("div");
  lorasPanel.className = "lm-mode-panel";
  lorasPanel.dataset.mode = "loras";
  lorasPanelEl = lorasPanel;

  const toolbar = document.createElement("div");
  toolbar.className = "lm-toolbar";

  const row1 = document.createElement("div");
  row1.className = "lm-row";
  const search = document.createElement("input");
  search.className = "lm-search";
  search.placeholder = "Search name / trigger / base model...";
  search.value = filter;
  search.oninput = () => {
    if (exactLoraKey && search.value === "") {
      exactLoraKey = null;
      activeJump = null;
      setExactLockState(search, false);
    }
    if (!exactLoraKey) filter = search.value;
    renderGrid();
  };
  search.addEventListener("click", () => {
    if (!exactLoraKey) return;
    exactLoraKey = null;
    activeJump = null;
    setExactLockState(search, false);
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.focus();
  });
  row1.appendChild(makeClearableSearch(search));
  searchInputEl = search;

  toolbar.appendChild(row1);

  const filterWrap = document.createElement("div");
  filterWrap.className = "lm-filter";
  filterBtnEl = document.createElement("button");
  filterBtnEl.type = "button";
  filterBtnEl.className = "lm-filter-btn";
  filterBtnEl.title = "Filter by base model";
  filterPanelEl = document.createElement("div");
  filterPanelEl.className = "lm-filter-panel";
  filterBtnEl.onclick = (e) => {
    e.stopPropagation();
    filterPanelEl.style.display = filterPanelEl.style.display === "block" ? "none" : "block";
  };
  // close panel on outside click — bind once globally; resolves the current
  // wrapper via `filterPanelEl.parentElement` so rebuilds stay correct.
  if (!filterOutsideBound) {
    document.addEventListener("mousedown", (e) => {
      if (!filterPanelEl || filterPanelEl.style.display !== "block") return;
      const wrap = filterPanelEl.parentElement;
      if (!wrap || !wrap.contains(e.target)) filterPanelEl.style.display = "none";
    });
    filterOutsideBound = true;
  }
  filterWrap.append(filterBtnEl, filterPanelEl);
  refreshFilterUI();

  const row2 = document.createElement("div");
  row2.className = "lm-row";
  // Base-model filter sits inline with the other controls (compact width)
  // rather than claiming a full-width row of its own.
  row2.appendChild(filterWrap);
  metaEl = document.createElement("div");
  metaEl.className = "lm-meta";
  metaEl.style.flex = "1";
  metaEl.textContent = "Loading...";
  row2.appendChild(metaEl);

  const sortSel = document.createElement("select");
  sortSel.className = "lm-sort";
  sortSel.title = "Sort";
  [["default", "Default"], ["name", "Name (A-Z)"], ["date", "Recently added"]]
    .forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = t;
      if (v === sortMode) o.selected = true;
      sortSel.appendChild(o);
    });
  sortSel.onchange = () => { sortMode = sortSel.value; saveLibPrefs(); renderGrid(); };
  row2.appendChild(sortSel);

  const scanBtn = document.createElement("button");
  scanBtn.className = "lm-btn";
  scanBtn.innerHTML = `<i class="pi pi-refresh"></i> Scan`;
  scanBtn.title = "Scan (changed only) · Shift+click = force full metadata refetch";
  scanBtn.onclick = (e) => doScan(e.shiftKey);
  row2.appendChild(scanBtn);

  // Check Updates as a split-button: click → opens scope menu (all / favorites
  // / in-workflow). Each scope triggers /check-updates with a filtered list.
  const checkWrap = document.createElement("div");
  checkWrap.style.position = "relative";
  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "lm-btn";
  checkBtn.innerHTML = `<i class="pi pi-sync"></i> Check <span style="font-size:9px;opacity:.6">▾</span>`;
  checkBtn.title = "Check CivitAI for new LoRA versions";

  const checkMenu = document.createElement("div");
  checkMenu.className = "lm-popmenu";
  checkMenuEl = checkMenu;
  checkWrapEl = checkWrap;
  const header = document.createElement("div");
  header.className = "lm-popmenu-header";
  header.textContent = "Check for updates";
  checkMenu.appendChild(header);

  const startCheck = async (targets) => {
    checkMenu.style.display = "none";
    if (checkBtn.disabled) return;
    const r = await api.checkUpdates(targets);
    if (r.started) pollUpdateCheck(checkBtn);
    else toast(r.reason || "Already running");
  };

  const scopes = [
    ["all",       "All",                () => null],
    ["favorites", "Favorites only",     () => loras.filter(l => l.favorite && l.civitai_url).map(l => l.rel_path)],
    ["workflow",  "In-stack only",      () => loras.filter(l => l.inWorkflow && l.civitai_url).map(l => l.rel_path)],
  ];
  const menuItems = {};
  for (const [id, label, getter] of scopes) {
    const item = document.createElement("div");
    item.className = "lm-popmenu-item";
    item.textContent = label;
    item.onclick = (e) => {
      e.stopPropagation();
      if (item.hasAttribute("disabled")) return;
      const targets = getter();
      if (targets !== null && targets.length === 0) {
        toast(id === "favorites" ? "No CivitAI-matched favorites" : "No CivitAI-matched LoRAs in stack");
        checkMenu.style.display = "none";
        return;
      }
      startCheck(targets);
    };
    menuItems[id] = item;
    checkMenu.appendChild(item);
  }

  checkBtn.onclick = (e) => {
    e.stopPropagation();
    if (checkBtn.disabled) return;
    const opening = checkMenu.style.display !== "block";
    // refresh disabled state for menu items based on current data
    const favCount = loras.filter(l => l.favorite && l.civitai_url).length;
    const wfCount  = loras.filter(l => l.inWorkflow && l.civitai_url).length;
    menuItems.favorites.toggleAttribute("disabled", favCount === 0);
    menuItems.workflow.toggleAttribute("disabled", wfCount === 0);
    checkMenu.style.display = opening ? "block" : "none";
  };

  // close on outside click — one global listener, looks up current menu dynamically
  if (!window.__lmCheckMenuBound) {
    document.addEventListener("mousedown", (e) => {
      if (!checkMenuEl || !checkMenuEl.parentElement) return;
      if (checkMenuEl.style.display !== "block") return;
      if (!checkWrapEl || !checkWrapEl.contains(e.target)) checkMenuEl.style.display = "none";
    });
    window.__lmCheckMenuBound = true;
  }

  checkWrap.append(checkBtn, checkMenu);
  row2.appendChild(checkWrap);

  // View density toggle (per-tab — Styles and LoRAs each have their own mode).
  row2.appendChild(makeViewToggleButton("loras"));
  // NSFW blur toggle — placed at the right end to match the Styles toolbar.
  row2.appendChild(makeBlurButton());

  toolbar.appendChild(row2);

  progressEl = document.createElement("div");
  progressEl.className = "lm-progress";
  toolbar.appendChild(progressEl);

  lorasPanel.appendChild(toolbar);

  scrollEl = document.createElement("div");
  scrollEl.className = "lm-scroll";
  lorasPanel.appendChild(scrollEl);

  root.appendChild(lorasPanel);
  el.appendChild(root);

  // Apply persisted mode (defaults to "loras" on first ever open).
  setMode(currentMode);

  // initial load; auto-scan on first ever open (nothing indexed yet)
  refresh().then(data => {
    const scanning = data.scan && data.scan.scanning;
    const unscanned = loras.filter(l => !l.scanned).length;
    if (scanning) startPolling();
    else if (!loras.length || unscanned > 0) doScan(false);
  });

  // Styles load is independent of the LoRA scan — they're separate stores.
  refreshStyles();

  // Drop handler is global (document-level) so it isn't bound to a panel
  // size; only fires when Styles mode is active and a file is being dragged.
  bindStyleDropHandlers();

  // The Workbench stack is pushed in by the React wrapper via the handle's
  // setStack(); there is no canvas to poll.
}

// --- mount / unmount -------------------------------------------------------
// PeroPixComfy mounts this panel into a plain container (the Library tab, or
// the Workbench/Batch drawer) through a thin React wrapper. Only one instance
// is live at a time (the SPA renders one tab at a time), so the module-level
// state is safe — and is intentionally preserved across mounts so filters,
// search text, sort, and view mode survive opening/closing the drawer.
export function mountLibrary(container, opts = {}) {
  lmOpts = { onApplyStyle: () => {}, onAddLora: () => {}, onLorasRefreshed: () => {}, ...opts };
  if (opts.initialMode) currentMode = opts.initialMode;
  destroyLibrary();              // tear down any previous instance first
  buildPanel(container);
  return { setStack, refresh, refreshStyles, destroy: destroyLibrary };
}

function destroyLibrary() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (updateCheckTimer) { clearInterval(updateCheckTimer); updateCheckTimer = null; }
  if (cachedRoot && cachedRoot.parentNode) cachedRoot.remove();
  cachedRoot = null;
  // Null the element refs so a late async callback (a slow fetch resolving
  // after unmount) can't paint into a detached tree.
  stylesGridEl = stylesScrollEl = scrollEl = metaEl = progressEl = null;
  filterBtnEl = filterPanelEl = null;
  searchInputEl = stylesSearchInputEl = null;
  stylesPanelEl = lorasPanelEl = modeBarEl = sidebarRootEl = null;
  checkMenuEl = checkWrapEl = null;
}
