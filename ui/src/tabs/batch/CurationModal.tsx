import { useCallback, useEffect, useRef, useState } from 'react'
import { parseViewUrl, thumbUrl } from '../../api/comfy'
import { useT } from '../../i18n'
import { activeTabOf, useBatch } from '../../stores/batch'

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
// 생성 중 삭제로 파일 번호가 재사용돼도 옛(삭제된) 이미지가 캐시에서 나오지 않도록
// 결과별 고유 키(result.id)를 URL에 붙인다. (캔버스 렌더러·Single과 동일한 방식.)
const bust = (url: string, key: string) => `${url}&v=${encodeURIComponent(key)}`
// 하단 스트립은 다운스케일 thumb 엔드포인트로 로드 — 다수 이미지(슬롯당 최대 64장)일 때
// 풀해상도 N장 대신 가벼운 썸네일 N장만 받는다. 큰 이미지는 현재 1장만 풀해상도.
// 폭은 싱글 하단 스트립과 통일(150) — 둘 다 작게 표시되고, 같은 폭이면 캐시도 공유된다.
const stripSrc = (url: string, key: string) => {
  const p = parseViewUrl(url)
  return `${p ? thumbUrl(p, 150) : url}&v=${encodeURIComponent(key)}`
}

/**
 * 에셋 선별(큐레이션) 모달 — 한 슬롯의 결과들을 Single처럼 큰 이미지 + 썸네일 리스트로
 * 비교하며, 마음에 드는 것만 남기고 나머지를 지운다. 휠로 이미지 넘기기, 확대/축소는
 * 버튼·슬라이더·넘패드 +/-. 줌 상태는 이미지를 넘겨도 유지된다. 결과는 스토어에서
 * 라이브로 읽어 삭제가 즉시 반영된다.
 */
export function CurationModal({ slotId, initialId, aspect, onClose }: { slotId: string; initialId?: string; aspect: number; onClose: () => void }) {
  const t = useT()
  // 큐레이션 대상 슬롯은 내부 상태 — 상/하 방향키로 다른 슬롯으로 전환한다. 모달은 캔버스를 덮는
  // 오버레이라 열려있는 동안 외부에서 prop slotId가 바뀌지 않으므로, 프롭으로 1회 초기화해도 안전.
  const [curSlotId, setCurSlotId] = useState(slotId)
  const results = useBatch((s) => activeTabOf(s)?.results ?? [])
  const slots = useBatch((s) => activeTabOf(s)?.slots ?? [])
  const removeResults = useBatch((s) => s.removeResults)
  const setCharBase = useBatch((s) => s.setCharBase)
  const [seedFlash, setSeedFlash] = useState(false)
  const flashTimer = useRef<number | null>(null)
  const slotName = slots.find((sl) => sl.id === curSlotId)?.name ?? ''

  const items = results.filter((r) => r.slotId === curSlotId && r.status === 'done' && r.imageUrls[0])
  // 더블클릭으로 진입했으면 그 이미지(initialId)가 선택된 상태로 시작한다. (없으면 첫 이미지.)
  const [idx, setIdx] = useState(() => {
    const i = initialId ? items.findIndex((it) => it.id === initialId) : -1
    return i >= 0 ? i : 0
  })
  const safeIdx = Math.min(idx, Math.max(0, items.length - 1))
  const cur = items[safeIdx]
  const lenRef = useRef(items.length)
  lenRef.current = items.length

  // 상/하 방향키 슬롯 전환용 — 결과가 있는 슬롯만(빈 슬롯은 열면 바로 닫히므로 제외) 슬롯 순서대로.
  // 안정적 키보드 핸들러가 읽도록 이전/다음 슬롯 id를 ref에 담는다. 끝에서는 undefined(=정지).
  const curatableIds = slots
    .filter((sl) => results.some((r) => r.slotId === sl.id && r.status === 'done' && r.imageUrls[0]))
    .map((sl) => sl.id)
  const slotPos = curatableIds.indexOf(curSlotId)
  const slotNavRef = useRef<{ up?: string; down?: string }>({})
  slotNavRef.current = {
    up: slotPos > 0 ? curatableIds[slotPos - 1] : undefined,
    down: slotPos >= 0 && slotPos < curatableIds.length - 1 ? curatableIds[slotPos + 1] : undefined,
  }

  // 휠 내비게이션(이미지 넘기기)을 모달 루트에 건다 — 삭제 직후 포인터가 썸네일 스트립 위에 있어도
  // 넘길 수 있고, 콜백 ref라 노드가 리마운트돼도 리스너를 다시 붙여 '삭제 후 잠깐 휠이 안 먹는' 문제를
  // 없앤다. deltaY만 소비하므로 shift+휠(가로 스크롤)로 스트립을 넘기는 동작은 그대로 유지된다.
  const wheelCleanup = useRef<(() => void) | null>(null)
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    wheelCleanup.current?.()
    wheelCleanup.current = null
    if (!node) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      setIdx((i) => clamp(i + (e.deltaY > 0 ? 1 : -1), 0, Math.max(0, lenRef.current - 1)))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    wheelCleanup.current = () => node.removeEventListener('wheel', onWheel)
  }, [])

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

  // 시드 적용 ✓ 플래시 타이머 정리(언마운트 시).
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  // 삭제 등으로 항목 수가 줄면 idx가 범위를 벗어난 채 남는다(표시는 클램프한 safeIdx라 정상이지만,
  // 이동은 원본 idx 기준이라 첫 입력이 idx를 유효범위로 되돌리기만 하고 화면은 안 바뀜 = "두 번 눌러야
  // 전환"). 항목 수가 바뀔 때마다 idx를 safeIdx로 즉시 맞춰 이 어긋남을 없앤다.
  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, items.length - 1)))
  }, [items.length])

  // 키보드: ←/→ 전후 이미지, ↑/↓ 전후 슬롯, 넘패드 +/-(및 +/-) 확대축소, Delete 현재 삭제, Esc 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 텍스트 입력(슬롯 프롬프트 등)에 포커스가 있으면 큐레이션 단축키를 가로채지 않는다 —
      // Delete=텍스트 삭제, 화살표=커서 이동, +/-·Esc=그 입력/자동완성이 처리하게.
      const fel = document.activeElement as HTMLElement | null
      if (fel && (fel.tagName === 'INPUT' || fel.tagName === 'TEXTAREA' || fel.isContentEditable)) return
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setIdx((i) => clamp(i - 1, 0, Math.max(0, lenRef.current - 1))) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setIdx((i) => clamp(i + 1, 0, Math.max(0, lenRef.current - 1))) }
      // ↑/↓ = 전후 슬롯으로 전환. 전환 시 새 슬롯의 첫 이미지(idx 0)에서 시작하고 줌은 초기화한다.
      else if (e.key === 'ArrowUp') { e.preventDefault(); const up = slotNavRef.current.up; if (up) { setCurSlotId(up); setIdx(0); resetZoom() } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); const dn = slotNavRef.current.down; if (dn) { setCurSlotId(dn); setIdx(0); resetZoom() } }
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

  // 현재 이미지의 시드를 생성 옵션(활성 캐릭터 Base seed)에 반영. Single의 시드 클릭과 동일하게
  // 시드만 바꾸고 Random 토글은 건드리지 않는다. 적용 확인용으로 버튼을 잠깐 ✓로 바꾼다.
  const applySeed = () => {
    if (cur.seed == null) return
    setCharBase({ seed: cur.seed })
    setSeedFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setSeedFlash(false), 1200)
  }

  return (
    <div className="curate" ref={rootRef}>
        <div className="curate-head">
          <span className="curate-title">{slotName || t('(untitled)')} · {safeIdx + 1}/{items.length}</span>
          {cur.seed != null && (
            <button className={`curate-seed${seedFlash ? ' applied' : ''}`} onClick={applySeed}
              title={t('Click to use this seed for generation')}>
              {seedFlash ? t('✓ seed applied') : `🎲 ${cur.seed}`}
            </button>
          )}
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
            title={t('Wheel / ←→: prev/next image · ↑↓: prev/next slot · Drag (when zoomed): pan · Double-click: reset zoom')}>
            <img ref={imgRef} src={bust(cur.imageUrls[0], cur.id)} alt="" draggable={false}
              onLoad={() => setZoom((z) => applyClamp(z.scale, z.x, z.y))}
              style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }} />
          </div>
          <button className="curate-nav" onClick={() => setIdx(Math.min(items.length - 1, safeIdx + 1))} disabled={safeIdx >= items.length - 1}>›</button>
        </div>
        <div className="curate-strip">
          {items.map((it, i) => (
            <div key={it.id} className={`curate-thumb${i === safeIdx ? ' active' : ''}`}
              style={{ aspectRatio: String(aspect) }} onClick={() => setIdx(i)}>
              <img src={stripSrc(it.imageUrls[0], it.id)} alt="" loading="lazy" />
              <button className="curate-del" title={t('Delete this image')}
                onClick={(e) => { e.stopPropagation(); void removeResults([it.id]) }}>✕</button>
            </div>
          ))}
        </div>
    </div>
  )
}
