import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { DEFAULT_W, useRefBoard } from '../../stores/refboard'

/**
 * PureRef 스타일 레퍼런스 캔버스.
 *  - 좌클릭 배경 드래그 = 마퀴 다중선택 / 좌클릭 이미지 = 선택+드래그(선택 그룹 이동)
 *  - Ctrl/⌘+클릭 = 선택 토글 / Delete = 선택 제거 / Backspace = 선택 크기 초기화 / Esc = 선택 해제
 *  - 휠클릭·우클릭 드래그 = 팬(손 커서) / 휠 = 커서 기준 줌 / 우하단 핸들 = 크기(단일 선택)
 *  - 히스토리 썸네일 드롭 = 추가(이미 있으면 그 이미지를 강조). enabled일 때만 마운트.
 *
 * 이미지는 transform:scale 없이 실제 화면 픽셀 크기(w*scale)로 직접 렌더 → 줌해도 선명.
 * 팬/드래그는 '증분' 방식이라 드래그 중 휠 줌이 섞여도 뷰가 안 튄다.
 */
export function RefCanvas() {
  const t = useT()
  const items = useRefBoard((s) => s.items)
  const view = useRefBoard((s) => s.view)
  const setView = useRefBoard((s) => s.setView)
  const updateItem = useRefBoard((s) => s.updateItem)
  const removeItem = useRefBoard((s) => s.removeItem)
  const bringFront = useRefBoard((s) => s.bringFront)
  const clear = useRefBoard((s) => s.clear)
  const disable = useRefBoard((s) => s.disable)
  const dropHint = useRefBoard((s) => s.dropHint) // 썸네일을 캔버스 위로 드래그 중(WorkbenchTab이 세팅)
  const ref = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const selRef = useRef(sel)
  selRef.current = sel
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [panning, setPanning] = useState(false)

  // Delete=선택 제거, Backspace=선택 크기 초기화, Esc=선택 해제 (원본 파일은 안 건드림).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (selRef.current.size === 0) { if (e.key === 'Escape') setSel(new Set()); return }
      if (e.key === 'Delete') { e.preventDefault(); selRef.current.forEach((id) => removeItem(id)); setSel(new Set()) }
      else if (e.key === 'Backspace') { e.preventDefault(); selRef.current.forEach((id) => updateItem(id, { w: DEFAULT_W })) }
      else if (e.key === 'Escape') setSel(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeItem, updateItem])

  const rectOf = () => ref.current!.getBoundingClientRect()

  // 드래그 세션 — 진행 중 다른 패널 텍스트 선택 방지 + 커서 지정.
  const beginDrag = (onMove: (ev: MouseEvent) => void, onEnd?: () => void, cursor?: string) => {
    const pus = document.body.style.userSelect
    const pcur = document.body.style.cursor
    document.body.style.userSelect = 'none'
    if (cursor) document.body.style.cursor = cursor
    const up = () => {
      document.body.style.userSelect = pus
      document.body.style.cursor = pcur
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', up)
      onEnd?.()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', up)
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const r = rectOf()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const v = useRefBoard.getState().view
    const ns = Math.min(8, Math.max(0.05, v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
    setView({ x: mx - ((mx - v.x) / v.scale) * ns, y: my - ((my - v.y) / v.scale) * ns, scale: ns })
  }

  // 증분 팬(휠클릭·우클릭).
  const startPan = (e: React.MouseEvent) => {
    setPanning(true)
    let lx = e.clientX, ly = e.clientY
    beginDrag((ev) => {
      const v = useRefBoard.getState().view
      setView({ ...v, x: v.x + (ev.clientX - lx), y: v.y + (ev.clientY - ly) })
      lx = ev.clientX; ly = ev.clientY
    }, () => setPanning(false), 'grabbing')
  }

  // 좌클릭 배경 = 마퀴 다중선택.
  const startMarquee = (e: React.MouseEvent) => {
    const r = rectOf()
    const x0 = e.clientX - r.left, y0 = e.clientY - r.top
    setSel(new Set())
    setMarquee({ x0, y0, x1: x0, y1: y0 })
    beginDrag((ev) => {
      const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top
      setMarquee({ x0, y0, x1, y1 })
      const rx0 = Math.min(x0, x1), ry0 = Math.min(y0, y1), rx1 = Math.max(x0, x1), ry1 = Math.max(y0, y1)
      const st = useRefBoard.getState()
      const next = new Set<string>()
      for (const it of st.items) {
        const node = ref.current?.querySelector(`[data-id="${it.id}"]`) as HTMLElement | null
        const iw = it.w * st.view.scale
        const ih = node ? node.offsetHeight : iw
        const ix = st.view.x + it.x * st.view.scale
        const iy = st.view.y + it.y * st.view.scale
        if (ix < rx1 && ix + iw > rx0 && iy < ry1 && iy + ih > ry0) next.add(it.id)
      }
      setSel(next)
    }, () => setMarquee(null))
  }

  const onCanvasDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) { e.preventDefault(); startPan(e); return } // 휠클릭·우클릭 = 팬
    if (e.button === 0) startMarquee(e) // 좌클릭 배경 = 마퀴 선택
  }

  // 이미지 좌클릭 = 선택(+드래그로 그룹 이동). Ctrl/⌘=토글. 휠클릭·우클릭은 버블시켜 팬.
  const onItemDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    bringFront(id)
    if (e.ctrlKey || e.metaKey) {
      setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
      return
    }
    const group = selRef.current.has(id) ? new Set(selRef.current) : new Set([id])
    setSel(group)
    let lx = e.clientX, ly = e.clientY
    beginDrag((ev) => {
      const st = useRefBoard.getState()
      const dxw = (ev.clientX - lx) / st.view.scale
      const dyw = (ev.clientY - ly) / st.view.scale
      for (const gid of group) {
        const it = st.items.find((i) => i.id === gid)
        if (it) updateItem(gid, { x: it.x + dxw, y: it.y + dyw })
      }
      lx = ev.clientX; ly = ev.clientY
    }, undefined, 'move')
  }

  const onResizeDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    let lx = e.clientX
    beginDrag((ev) => {
      const st = useRefBoard.getState()
      const it = st.items.find((i) => i.id === id)
      if (!it) return
      updateItem(id, { w: Math.max(48, it.w + (ev.clientX - lx) / st.view.scale) })
      lx = ev.clientX
    }, undefined, 'nwse-resize')
  }

  const fitAll = () => {
    const el = ref.current
    if (!el || items.length === 0) return
    const r = el.getBoundingClientRect()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const it of items) {
      const node = el.querySelector(`[data-id="${it.id}"]`) as HTMLElement | null
      const h = node ? node.offsetHeight / view.scale : it.w
      minX = Math.min(minX, it.x); minY = Math.min(minY, it.y)
      maxX = Math.max(maxX, it.x + it.w); maxY = Math.max(maxY, it.y + h)
    }
    const bw = maxX - minX, bh = maxY - minY
    if (bw <= 0 || bh <= 0) return
    const pad = 40
    const scale = Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh, 4)
    setView({ scale, x: (r.width - bw * scale) / 2 - minX * scale, y: (r.height - bh * scale) / 2 - minY * scale })
  }

  return (
    <div ref={ref} className={`ref-canvas${dropHint ? ' drop' : ''}${panning ? ' panning' : ''}`}
      onWheel={onWheel} onMouseDown={onCanvasDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <div key={it.id} data-id={it.id}
          className={`ref-item${sel.has(it.id) ? ' sel' : ''}`}
          style={{ left: view.x + it.x * view.scale, top: view.y + it.y * view.scale, width: it.w * view.scale, zIndex: it.z }}
          onMouseDown={(e) => onItemDown(e, it.id)} onDragStart={(e) => e.preventDefault()}>
          <img src={it.url} draggable={false} alt="" />
          {sel.has(it.id) && sel.size === 1 && (
            <>
              <span className="ref-del" title={t('Remove from canvas')}
                onMouseDown={(e) => { e.stopPropagation(); removeItem(it.id); setSel(new Set()) }}>✕</span>
              <span className="ref-resize" onMouseDown={(e) => onResizeDown(e, it.id)} />
            </>
          )}
        </div>
      ))}
      {marquee && (
        <div className="ref-marquee" style={{
          left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
          width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
        }} />
      )}
      {items.length === 0 && <div className="ref-empty">{t('Drag result thumbnails here to add them')}</div>}
      <div className="ref-toolbar" onMouseDown={(e) => e.stopPropagation()}>
        <span className="ref-hint">{t('Drag = select · Del = remove · Backspace = reset size · right/wheel-drag = pan · wheel = zoom')}</span>
        {sel.size > 0 && (
          <button onClick={() => { sel.forEach((id) => removeItem(id)); setSel(new Set()) }}
            title={t('Remove selected from canvas')}>🗑 {sel.size}</button>
        )}
        <button onClick={fitAll} title={t('Fit all')}>⤢</button>
        <button onClick={() => { if (confirm(t('Remove all images from the canvas? (the original files are kept)'))) clear() }}
          title={t('Clear canvas')}>🗑</button>
        <button onClick={disable} title={t('Close canvas (back to preview)')}>✕</button>
      </div>
    </div>
  )
}
