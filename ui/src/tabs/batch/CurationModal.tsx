import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { activeTabOf, useBatch } from '../../stores/batch'

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * 에셋 선별(큐레이션) 모달 — 한 슬롯의 결과들을 Single처럼 큰 이미지 + 썸네일 리스트로
 * 비교하며, 마음에 드는 것만 남기고 나머지를 지운다. 휠로 이미지 넘기기, 확대/축소는
 * 버튼·슬라이더·넘패드 +/-. 줌 상태는 이미지를 넘겨도 유지된다. 결과는 스토어에서
 * 라이브로 읽어 삭제가 즉시 반영된다.
 */
export function CurationModal({ slotId, onClose }: { slotId: string; onClose: () => void }) {
  const t = useT()
  const results = useBatch((s) => activeTabOf(s)?.results ?? [])
  const slotName = useBatch((s) => activeTabOf(s)?.slots.find((sl) => sl.id === slotId)?.name ?? '')
  const removeResults = useBatch((s) => s.removeResults)
  const [idx, setIdx] = useState(0)

  const items = results.filter((r) => r.slotId === slotId && r.status === 'done' && r.imageUrls[0])
  const safeIdx = Math.min(idx, Math.max(0, items.length - 1))
  const cur = items[safeIdx]
  const lenRef = useRef(items.length)
  lenRef.current = items.length

  // 이미지 뷰어식 확대/축소·패닝. 이미지를 넘겨도 줌 상태는 유지한다(리셋 안 함).
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 })
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const panning = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  // 패닝 경계 제한: 확대된 이미지가 스테이지보다 큰 만큼만 이동 허용(가장자리가 스테이지
  // 가장자리에 닿는 선까지). 스테이지보다 작으면(=100% 이하 포함) 0으로 → 중앙 고정.
  const applyClamp = (s: number, x: number, y: number) => {
    const stage = stageRef.current
    const img = imgRef.current
    if (!stage || !img || !img.clientWidth) return { scale: s, x, y }
    const maxX = Math.max(0, (img.clientWidth * s - stage.clientWidth) / 2)
    const maxY = Math.max(0, (img.clientHeight * s - stage.clientHeight) / 2)
    return { scale: s, x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
  }
  // 중심 기준 확대/축소 + 경계 클램프.
  const setScale = (ns: number) =>
    setZoom((z) => { const s = clamp(ns, 0.2, 8); const k = s / z.scale; return applyClamp(s, z.x * k, z.y * k) })
  const zoomBy = (f: number) => setScale(zoomRef.current.scale * f)
  const resetZoom = () => setZoom({ scale: 1, x: 0, y: 0 })

  const onPanStart = (e: React.PointerEvent) => {
    if (zoomRef.current.scale <= 1) return
    panning.current = { sx: e.clientX, sy: e.clientY, ox: zoomRef.current.x, oy: zoomRef.current.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPanMove = (e: React.PointerEvent) => {
    const p = panning.current
    if (!p) return
    setZoom((z) => applyClamp(z.scale, p.ox + (e.clientX - p.sx), p.oy + (e.clientY - p.sy)))
  }
  const onPanEnd = () => { panning.current = null }

  // 남은 게 없으면 닫는다.
  useEffect(() => {
    if (items.length === 0) onClose()
  }, [items.length, onClose])

  // 휠 = 이미지 넘기기 (Single과 동일, 1이벤트=1장).
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      setIdx((i) => clamp(i + (e.deltaY > 0 ? 1 : -1), 0, Math.max(0, lenRef.current - 1)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 키보드: ←/→ 넘기기, 넘패드 +/-(및 +/-) 확대축소, Delete 현재 삭제, Esc 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setIdx((i) => clamp(i - 1, 0, Math.max(0, lenRef.current - 1))) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setIdx((i) => clamp(i + 1, 0, Math.max(0, lenRef.current - 1))) }
      else if (e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25) }
      else if (e.code === 'NumpadSubtract' || e.key === '-') { e.preventDefault(); zoomBy(0.8) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (cur) void removeResults([cur.id]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, removeResults, onClose])

  if (!cur) return null

  const keepOnlyThis = () => {
    const others = items.filter((it) => it.id !== cur.id).map((it) => it.id)
    if (others.length && confirm(t('Keep only this image and delete the other {n}?', { n: others.length }))) {
      void removeResults(others)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="curate" onClick={(e) => e.stopPropagation()}>
        <div className="curate-head">
          <span className="curate-title">{slotName || t('(untitled)')} · {safeIdx + 1}/{items.length}</span>
          <div className="curate-zoom">
            <button onClick={() => zoomBy(0.8)} title={t('Zoom out (Numpad -)')}>－</button>
            <input type="range" min={20} max={800} step={5} value={Math.round(zoom.scale * 100)}
              onChange={(e) => setScale(Number(e.target.value) / 100)} />
            <button onClick={() => zoomBy(1.25)} title={t('Zoom in (Numpad +)')}>＋</button>
            <span className="curate-pct">{Math.round(zoom.scale * 100)}%</span>
            <button onClick={resetZoom} title={t('Reset zoom')}>{t('Reset')}</button>
          </div>
          <button className="generate" onClick={keepOnlyThis} disabled={items.length <= 1}>
            {t('Keep only this · delete others ({n})', { n: items.length - 1 })}
          </button>
          <button onClick={onClose}>{t('Close')}</button>
        </div>
        <div className="curate-main">
          <button className="curate-nav" onClick={() => setIdx(Math.max(0, safeIdx - 1))} disabled={safeIdx === 0}>‹</button>
          <div className="curate-stage" ref={stageRef}
            onPointerDown={onPanStart} onPointerMove={onPanMove} onPointerUp={onPanEnd} onPointerLeave={onPanEnd}
            onDoubleClick={resetZoom}
            style={{ cursor: zoom.scale > 1 ? 'grab' : 'default' }}
            title={t('Wheel: prev/next image · Drag (when zoomed): pan · Double-click: reset zoom')}>
            <img ref={imgRef} src={cur.imageUrls[0]} alt="" draggable={false}
              onLoad={() => setZoom((z) => applyClamp(z.scale, z.x, z.y))}
              style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }} />
          </div>
          <button className="curate-nav" onClick={() => setIdx(Math.min(items.length - 1, safeIdx + 1))} disabled={safeIdx >= items.length - 1}>›</button>
        </div>
        <div className="curate-strip">
          {items.map((it, i) => (
            <div key={it.id} className={`curate-thumb${i === safeIdx ? ' active' : ''}`} onClick={() => setIdx(i)}>
              <img src={it.imageUrls[0]} alt="" />
              <button className="curate-del" title={t('Delete this image')}
                onClick={(e) => { e.stopPropagation(); void removeResults([it.id]) }}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
