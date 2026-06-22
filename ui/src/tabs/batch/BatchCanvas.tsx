import { useCallback, useEffect, useRef } from 'react'
import { useT } from '../../i18n'
import {
  computeLayout,
  contentBounds,
  drawSelectionRect,
  hitTest,
  hitTestRect,
  render,
  ROW_BTN,
  rowHasDone,
  setForceLowRes,
  type LayoutRow,
  type ResultLike,
  type SlotLike,
  type Viewport,
} from './batchCanvasRenderer'

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const MIN = 0.05
const MAX = 10 // 최대 1000% 확대
const CARD_H = 205 // 렌더러 카드 높이와 동일 — 종횡비로 너비 계산.
// 타이틀 클릭 히트테스트용 텍스트 폭 측정 (변환 없는 별도 컨텍스트 — 화면 CSS px 기준).
const _measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null

interface Props {
  slots: SlotLike[]
  results: ResultLike[]
  selected: Set<string>
  onSelectionChange: (next: Set<string>) => void
  aspect: number // base 종횡비(width/height) — 카드 모양을 실제 생성 해상도에 맞춤
  activePromptId: string | null // 지금 실제로 실행 중인 프롬프트(나머지 제출분은 'queued')
  initialViewport?: Viewport // 탭 전환 시 복원할 마지막 줌/위치
  onViewportChange: (vp: Viewport) => void
  onCurate: (slotId: string) => void // 슬롯 타이틀 옆 버튼 → 비교/선별 모달
  onOpenFolder: () => void // 줌 툴바의 폴더 열기 버튼
  slotStart: number // 슬롯 번호 시작값(타이틀 표시)
}

/**
 * 단일 <canvas>로 슬롯 행 × 결과 카드를 렌더링한다. 뷰포트는 ref로만 들고
 * 상시 RAF 루프가 매 프레임 그린다(상호작용 중 React 리렌더 없음 → 매끄러운 줌/팬).
 * 선택 상태는 부모(BatchTab)가 소유 — 멀티바/삭제와 그대로 연동된다.
 */
export function BatchCanvas({ slots, results, selected, onSelectionChange, aspect, activePromptId, initialViewport, onViewportChange, onCurate, onOpenFolder, slotStart }: Props) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layoutRef = useRef<LayoutRow[]>([])
  const vp = useRef<Viewport>(initialViewport ?? { x: 0, y: 0, scale: 1 })
  const selRef = useRef(selected)
  selRef.current = selected
  const activeRef = useRef(activePromptId)
  activeRef.current = activePromptId
  const hover = useRef<string | null>(null)
  const hoverTitle = useRef<string | null>(null) // 호버 중인 슬롯 타이틀(강조용)
  const rafRef = useRef(0)
  const lowResTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onViewportChangeRef = useRef(onViewportChange)
  onViewportChangeRef.current = onViewportChange
  const didFit = useRef(!!initialViewport) // 복원할 뷰포트가 있으면 자동 맞춤 생략
  const cardW = Math.max(60, Math.min(400, Math.round(CARD_H * (aspect > 0 ? aspect : 0.684))))

  // 상호작용 상태
  const panning = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const selecting = useRef(false)
  const selStart = useRef({ x: 0, y: 0 })
  const selRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const selPrior = useRef<Set<string>>(new Set())

  const kickLowRes = () => {
    setForceLowRes(true)
    if (lowResTimer.current) clearTimeout(lowResTimer.current)
    lowResTimer.current = setTimeout(() => {
      setForceLowRes(false)
      lowResTimer.current = null
    }, 500)
  }

  // 줌/팬 변화는 매 프레임 ref로만 반영하고, 잠잠해지면 한 번 스토어에 커밋(탭 전환 복원용).
  const commitViewport = () => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      onViewportChangeRef.current(vp.current)
      commitTimer.current = null
    }, 300)
  }

  // 언마운트(탭 전환) 시 마지막 뷰포트를 즉시 저장하고 타이머 정리.
  useEffect(() => () => {
    if (lowResTimer.current) clearTimeout(lowResTimer.current)
    if (commitTimer.current) clearTimeout(commitTimer.current)
    onViewportChangeRef.current(vp.current)
  }, [])

  // 초기 정렬 + '맞춤' 버튼: 모든 슬롯이 다 보이게 가로·세로 둘 다 맞춘 배율(100% 초과 확대는
  // 안 함)로, 위치는 좌상단(중앙 정렬 아님)에 맞춘다.
  const alignTopLeft = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const b = contentBounds(layoutRef.current)
    if (!b) return
    const rect = canvas.getBoundingClientRect()
    const pad = 24
    const cw = b.maxX - b.minX || 1
    const ch = b.maxY - b.minY || 1
    const scale = clamp(Math.min((rect.width - pad * 2) / cw, (rect.height - pad * 2) / ch, 1), MIN, MAX)
    vp.current = { scale, x: pad - b.minX * scale, y: pad - b.minY * scale }
    kickLowRes()
    commitViewport()
  }, [])

  // 슬롯 타이틀 클릭 → 그 슬롯을 280%로 확대(슬롯 콘텐츠 중심을 화면 중앙에).
  const focusSlot = useCallback((row: LayoutRow) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    let minX = row.x, minY = row.y, maxX = row.x, maxY = row.y
    for (const n of row.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h)
    }
    const scale = clamp(2.8, MIN, MAX)
    const ccx = (minX + maxX) / 2
    const ccy = (minY + maxY) / 2
    vp.current = { scale, x: rect.width / 2 - ccx * scale, y: rect.height / 2 - ccy * scale }
    kickLowRes()
    commitViewport()
  }, [])

  // 화면 좌표 pos가 어떤 슬롯 타이틀 위인지(클릭=확대). 큐레이트 버튼은 별도. 없으면 null.
  const titleHitAt = useCallback((px: number, py: number): LayoutRow | null => {
    const vpc = vp.current
    if (_measure) _measure.font = '600 16px sans-serif'
    for (const row of layoutRef.current) {
      const bx = vpc.x + row.x * vpc.scale
      const by = vpc.y + row.y * vpc.scale
      const tx = bx + (rowHasDone(row) ? ROW_BTN + 5 : 0)
      const tw = _measure ? _measure.measureText(row.label).width : 200
      if (px >= tx && px <= tx + tw && py >= by && py <= by + ROW_BTN) return row
    }
    return null
  }, [])

  // 큐레이트 버튼(⛶) 위인지. 없으면 null.
  const curateHitAt = useCallback((px: number, py: number): LayoutRow | null => {
    const vpc = vp.current
    for (const row of layoutRef.current) {
      if (!rowHasDone(row)) continue
      const bx = vpc.x + row.x * vpc.scale
      const by = vpc.y + row.y * vpc.scale
      if (px >= bx && px <= bx + ROW_BTN && py >= by && py <= by + ROW_BTN) return row
    }
    return null
  }, [])

  // 레이아웃 재계산 — 첫 진입(저장된 뷰포트 없음) 시 한 번 좌상단 정렬.
  useEffect(() => {
    layoutRef.current = computeLayout(slots, results, cardW, slotStart)
    if (!didFit.current && layoutRef.current.length) {
      alignTopLeft()
      didFit.current = true
    }
  }, [slots, results, cardW, slotStart, alignTopLeft])

  // 상시 RAF 렌더 루프
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      render(
        ctx,
        canvas.width / dpr,
        canvas.height / dpr,
        vp.current,
        layoutRef.current,
        selRef.current,
        hover.current,
        activeRef.current,
        hoverTitle.current,
      )
      if (selRect.current) {
        const s = selRect.current
        drawSelectionRect(ctx, s.x, s.y, s.w, s.h)
      }
    }
    const animate = () => {
      draw()
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // DPR 대응 리사이즈 — ResizeObserver로 컨테이너 크기 변화를 직접 감지한다.
  // (스타일 패널 펼침/접힘처럼 window resize 없이 캔버스 폭만 바뀌는 경우까지 처리 →
  //  백킹스토어가 안 맞아 이미지가 늘어나 보이던 버그 수정.)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.round(rect.width * dpr)
      const h = Math.round(rect.height * dpr)
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w
        canvas.height = h
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // 휠 줌 — React onWheel은 passive일 수 있어 native non-passive로 preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      // 커서 위치 기준으로 줌인/아웃 (커서 아래 지점이 고정).
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const cur = vp.current
      // 부드러운 줌: 지수식(틱당 변화량 작게, deltaY가 커도 음수 배율 없이 안전).
      const ns = clamp(cur.scale * Math.exp(-e.deltaY * 0.0007), MIN, MAX)
      const k = ns / cur.scale
      vp.current = { scale: ns, x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k }
      // 줌 중에는 강제 저해상도를 쓰지 않는다 — LOD 임계값(FULL_RES_THRESHOLD)이
      // 알아서 특정 배율에서 한 번만 썸네일↔풀해상도를 전환한다. (매 틱 강제 저해상도로
      // 떨어뜨리면 줌할 때마다 흐려졌다 선명해졌다 깜빡이는 문제가 생긴다.)
      commitViewport()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const canvasPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const toWorld = (sx: number, sy: number) => ({
    x: (sx - vp.current.x) / vp.current.scale,
    y: (sy - vp.current.y) / vp.current.scale,
  })

  const onMouseDown = (e: React.MouseEvent) => {
    const pos = canvasPos(e)
    // 우클릭/휠클릭 = 팬
    if (e.button === 2 || e.button === 1) {
      panning.current = true
      lastMouse.current = { x: e.clientX, y: e.clientY }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return

    // 화면 좌표 고정 UI: 큐레이션 버튼(⛶) → 모달, 타이틀 텍스트 → 슬롯 280% 확대.
    const cu = curateHitAt(pos.x, pos.y)
    if (cu) { onCurate(cu.slotId); return }
    const ti = titleHitAt(pos.x, pos.y)
    if (ti) { focusSlot(ti); return }

    const w = toWorld(pos.x, pos.y)
    const hit = hitTest(layoutRef.current, w.x, w.y)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (hit) {
      const next = new Set(selRef.current)
      if (additive) {
        if (next.has(hit)) next.delete(hit)
        else next.add(hit)
      } else if (next.has(hit) && next.size === 1) {
        next.delete(hit)
      } else {
        next.clear()
        next.add(hit)
      }
      onSelectionChange(next)
    } else {
      // 빈 곳 = 드래그 마키 선택 시작
      selPrior.current = additive ? new Set(selRef.current) : new Set()
      if (!additive) onSelectionChange(new Set())
      selecting.current = true
      selStart.current = pos
      selRect.current = { x: pos.x, y: pos.y, w: 0, h: 0 }
    }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (panning.current) {
      vp.current = {
        ...vp.current,
        x: vp.current.x + (e.clientX - lastMouse.current.x),
        y: vp.current.y + (e.clientY - lastMouse.current.y),
      }
      lastMouse.current = { x: e.clientX, y: e.clientY }
      return
    }
    const pos = canvasPos(e)
    if (selecting.current) {
      const sx = selStart.current.x
      const sy = selStart.current.y
      selRect.current = {
        x: Math.min(sx, pos.x),
        y: Math.min(sy, pos.y),
        w: Math.abs(pos.x - sx),
        h: Math.abs(pos.y - sy),
      }
      const a = toWorld(Math.min(sx, pos.x), Math.min(sy, pos.y))
      const b = toWorld(Math.max(sx, pos.x), Math.max(sy, pos.y))
      const ids = hitTestRect(layoutRef.current, a.x, a.y, b.x - a.x, b.y - a.y)
      // 가산 드래그: 시작 선택 XOR 사각형에 든 것
      const res = new Set(selPrior.current)
      for (const id of ids) {
        if (selPrior.current.has(id)) res.delete(id)
        else res.add(id)
      }
      onSelectionChange(res)
      return
    }
    // 타이틀/큐레이트 버튼 위면 클릭 가능 표시(포인터) + 타이틀 강조.
    const tRow = titleHitAt(pos.x, pos.y)
    hoverTitle.current = tRow ? tRow.slotId : null
    const overUI = !!(tRow || curateHitAt(pos.x, pos.y))
    if (canvasRef.current) canvasRef.current.style.cursor = overUI ? 'pointer' : 'default'
    const w = toWorld(pos.x, pos.y)
    hover.current = hitTest(layoutRef.current, w.x, w.y)
  }

  const onMouseUp = () => {
    if (panning.current) commitViewport() // 팬 끝났으면 위치 저장
    panning.current = false
    if (selecting.current) {
      selecting.current = false
      selRect.current = null
    }
  }
  const onMouseLeave = () => {
    onMouseUp()
    hoverTitle.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }

  const zoomBy = (f: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const cur = vp.current
    const ns = clamp(cur.scale * f, MIN, MAX)
    const k = ns / cur.scale
    vp.current = { scale: ns, x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k }
    commitViewport()
  }

  return (
    <div className="batch-canvas-wrap">
      <div className="zoom-toolbar">
        <button onClick={() => zoomBy(1.25)} title={t('Zoom in')}>＋</button>
        <button onClick={() => zoomBy(0.8)} title={t('Zoom out')}>－</button>
        <button onClick={alignTopLeft} title={t('Fit all')}>{t('Fit')}</button>
        <button onClick={onOpenFolder} title={t('Open output folder')}>📂</button>
      </div>
      <canvas
        ref={canvasRef}
        className="batch-canvas-el"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}
