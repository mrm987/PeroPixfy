// 배치 캔버스의 단일 <canvas> 2D 렌더러 (PeroPixfy CanvasRenderer 구조 이식).
// 슬롯 행 × 결과 카드 레이아웃을 직접 그린다. 뷰포트 컬링 + 썸네일/풀해상도
// LOD + 이미지 캐시로, 줌아웃해 수백 장을 한 화면에 깔아도 가볍게 동작한다.
import { parseViewUrl, thumbUrl } from '../../api/comfy'

export interface SlotLike {
  id: string
  name: string
}
export interface ResultLike {
  id: string
  slotId: string
  status: string
  imageUrls: string[]
  seed?: number | null
  promptId?: string | null
  placeholder?: boolean // 한 번도 생성 안 한 슬롯의 빈 자리(영역 예약). 실제 대기 결과와 구분.
}
export interface Viewport {
  x: number
  y: number
  scale: number
}

const CARD_H = 205 // 카드 높이 고정, 너비는 base 종횡비로 결정(아래 computeLayout cardW).
const CARD_GAP = 10
const ROW_HEADER_H = 24
const ROW_GAP = 28
const MARGIN_X = 24
const TOP = 16

// 카드의 화면상 가로 px가 이 값을 넘으면 풀해상도(/view)를 로드(디테일 확인용).
const FULL_RES_THRESHOLD = 260
// 화면상 너무 작으면 이미지 로드 자체를 생략 — 사람이 볼 수 없는 크기, 대역폭/CPU 절약.
const MIN_LOAD_SCREEN_SIZE = 36
const THUMB_W = 360

export interface LayoutNode {
  result: ResultLike
  x: number
  y: number
  w: number
  h: number
}
export interface LayoutRow {
  label: string
  slotId: string
  x: number
  y: number
  nodes: LayoutNode[]
}

// 슬롯 타이틀 옆 큐레이션 버튼의 화면상 크기(px). BatchCanvas 히트테스트와 공유.
export const ROW_BTN = 18
export function rowHasDone(row: LayoutRow): boolean {
  return row.nodes.some((n) => n.result.status === 'done' && n.result.imageUrls[0])
}

// fit/줌 전환 중에는 풀해상도 로드를 막아 무거운 동시 로드를 피한다.
let forceLowRes = false
export function setForceLowRes(value: boolean) {
  forceLowRes = value
}

const imageCache = new Map<string, HTMLImageElement>()
function loadImage(src: string): HTMLImageElement | null {
  const cached = imageCache.get(src)
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null
  const img = new Image()
  img.onerror = () => imageCache.delete(src) // 실패하면 캐시에서 빼 재시도 가능하게.
  img.src = src
  imageCache.set(src, img)
  return null
}

function getImageForNode(viewUrlStr: string, screenSize: number, bust = ''): HTMLImageElement | null {
  // bust: 결과별 고유 키(result.id, 큐 등록 시점 확정)를 URL에 붙여 캐시를 분리.
  // 생성 중 기존 이미지를 지우면 ComfyUI 카운터가 같은 파일명을 재사용할 수 있는데,
  // src가 같으면 imageCache(와 브라우저 캐시)가 지워진 옛 이미지를 그대로 반환한다.
  // 고유 키를 붙이면 결과마다 다른 src가 되어 항상 현재 파일을 새로 불러온다.
  const v = bust ? `&v=${encodeURIComponent(bust)}` : ''
  if (!forceLowRes && screenSize > FULL_RES_THRESHOLD) {
    const full = loadImage(viewUrlStr + v)
    if (full) return full // 풀해상도 준비됐으면 그걸로, 아니면 아래 썸네일로 폴백.
  }
  const parsed = parseViewUrl(viewUrlStr)
  return loadImage((parsed ? thumbUrl(parsed, THUMB_W) : viewUrlStr) + v)
}

const pad3 = (n: number) => String(n).padStart(3, '0')

export function computeLayout(slots: SlotLike[], results: ResultLike[], cardW = 140, slotStart = 1): LayoutRow[] {
  const w = Math.max(60, Math.min(400, Math.round(cardW)))
  const rows: LayoutRow[] = []
  let y = TOP
  slots.forEach((slot, i) => {
    const rs = results.filter((r) => r.slotId === slot.id)
    if (rs.length === 0) return
    const nodeY = y + ROW_HEADER_H
    const nodes: LayoutNode[] = rs.map((r, j) => ({
      result: r,
      x: MARGIN_X + j * (w + CARD_GAP),
      y: nodeY,
      w,
      h: CARD_H,
    }))
    rows.push({ label: `${pad3(slotStart + i)} ${slot.name || '(untitled)'}`, slotId: slot.id, x: MARGIN_X, y, nodes })
    y = nodeY + CARD_H + ROW_GAP
  })
  return rows
}

export function contentBounds(
  rows: LayoutRow[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (rows.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const row of rows) {
    minX = Math.min(minX, row.x)
    minY = Math.min(minY, row.y)
    for (const n of row.nodes) {
      maxX = Math.max(maxX, n.x + n.w)
      maxY = Math.max(maxY, n.y + n.h)
    }
  }
  return { minX, minY, maxX, maxY }
}

export function render(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  vp: Viewport,
  rows: LayoutRow[],
  selected: Set<string>,
  hovered: string | null,
  activePromptId: string | null,
  hoverTitle: string | null = null,
) {
  const s = vp.scale
  ctx.save()
  ctx.translate(vp.x, vp.y)
  ctx.scale(s, s)

  // 가시 영역(월드 좌표) — 이 밖의 노드는 그리지 않는다(컬링).
  const visLeft = -vp.x / s
  const visTop = -vp.y / s
  const visRight = visLeft + canvasWidth / s
  const visBottom = visTop + canvasHeight / s

  for (const row of rows) {
    for (const node of row.nodes) {
      if (
        node.x + node.w < visLeft || node.x > visRight ||
        node.y + node.h < visTop || node.y > visBottom
      ) {
        continue
      }

      const isSel = selected.has(node.result.id)
      const isHov = hovered === node.result.id

      ctx.fillStyle = '#15151c'
      ctx.strokeStyle = isSel ? '#c084fc' : isHov ? '#64748b' : '#2a2a35'
      ctx.lineWidth = (isSel ? 2.5 : 1) / s // 선 굵기도 역스케일해 줌아웃에도 보이게.
      ctx.beginPath()
      ctx.roundRect(node.x, node.y, node.w, node.h, 6)
      ctx.fill()
      ctx.stroke()

      if (node.result.status === 'done' && node.result.imageUrls[0]) {
        const screenSize = node.w * s
        if (screenSize < MIN_LOAD_SCREEN_SIZE) {
          ctx.fillStyle = '#2a2a35'
          ctx.fillRect(node.x + 3, node.y + 3, node.w - 6, node.h - 6)
        } else {
          const img = getImageForNode(node.result.imageUrls[0], screenSize, node.result.id)
          if (img) {
            const pad = 4
            const sc = Math.min(
              (node.w - pad * 2) / img.naturalWidth,
              (node.h - pad * 2) / img.naturalHeight,
            )
            const dw = img.naturalWidth * sc
            const dh = img.naturalHeight * sc
            ctx.drawImage(img, node.x + (node.w - dw) / 2, node.y + (node.h - dh) / 2, dw, dh)
            // 실제 해상도 표기 — 카드가 화면에서 충분히 클 때만(줌아웃 시 클러터 방지).
            if (screenSize > 90) {
              ctx.font = `${11 / s}px sans-serif`
              ctx.textAlign = 'left'
              ctx.textBaseline = 'bottom'
              ctx.shadowColor = 'rgba(0,0,0,0.9)'
              ctx.shadowBlur = 3 / s
              ctx.fillStyle = '#e2e8f0'
              ctx.fillText(`${img.naturalWidth}×${img.naturalHeight}`, node.x + 6, node.y + node.h - 5)
              ctx.shadowColor = 'transparent'
              ctx.shadowBlur = 0
            }
          } else {
            // 로딩 중 자리표시 — 다음 RAF 프레임에서 캐시가 채워지면 자동으로 그려진다.
            ctx.fillStyle = '#2a2a35'
            ctx.fillRect(node.x + 3, node.y + 3, node.w - 6, node.h - 6)
          }
        }
      } else if (node.result.placeholder) {
        // 한 번도 생성 안 한 슬롯 자리 — 빈 카드 박스로 영역만 미리 잡아둔다.
        ctx.fillStyle = '#23232c'
        ctx.fillRect(node.x + 3, node.y + 3, node.w - 6, node.h - 6)
      } else {
        // 실제 생성 예정/진행 결과: ComfyUI는 1개씩 실행하므로, 지금 도는 1개만
        // 'generating…', 제출만 됐거나(queued) 차례 기다리는(idle) 건 'queued'.
        const running = !!node.result.promptId && node.result.promptId === activePromptId
        const label = node.result.status === 'error' ? '✕' : running ? 'generating…' : 'queued'
        ctx.fillStyle = node.result.status === 'error' ? '#f87171' : '#64748b'
        ctx.font = `${13 / s}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, node.x + node.w / 2, node.y + node.h / 2)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
      }

      if (isSel) {
        ctx.fillStyle = 'rgba(192, 132, 252, 0.15)'
        ctx.beginPath()
        ctx.roundRect(node.x, node.y, node.w, node.h, 6)
        ctx.fill()
      }
    }
  }

  ctx.restore()

  // 슬롯 타이틀 — 카드(이미지)를 모두 그린 뒤 화면 좌표 고정 크기(13px)로 맨 위에 그린다.
  // (월드 패스에서 그리면 줌아웃 시 카드에 가려지고 텍스트가 거대해지는 문제가 있어 분리.)
  ctx.font = '600 13px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  for (const row of rows) {
    const sx = vp.x + row.x * s
    const sy = vp.y + row.y * s
    if (sy > canvasHeight || sy < -20 || sx > canvasWidth) continue
    let tx = sx
    // 큐레이션 버튼 — 결과가 있는 슬롯에만. 클릭 시 비교/선별 모달(BatchCanvas에서 히트테스트).
    if (rowHasDone(row)) {
      ctx.fillStyle = '#3a3550'
      ctx.beginPath()
      ctx.roundRect(sx, sy, ROW_BTN, ROW_BTN, 3)
      ctx.fill()
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('⛶', sx + ROW_BTN / 2, sy + ROW_BTN / 2 + 0.5)
      tx = sx + ROW_BTN + 5
    }
    // 타이틀 — 카드 위에 겹쳐도 읽히게 그림자. 호버 시 밝게 + 보라 밑줄(클릭=확대 표시).
    const hot = row.slotId === hoverTitle
    ctx.font = '600 16px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)'
    ctx.shadowBlur = 3
    ctx.fillStyle = hot ? '#ffffff' : '#e2e8f0'
    ctx.fillText(row.label, tx, sy + 2)
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    if (hot) {
      const tw = ctx.measureText(row.label).width
      ctx.strokeStyle = '#a78bfa'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(tx, sy + 19)
      ctx.lineTo(tx + tw, sy + 19)
      ctx.stroke()
    }
  }

  // 줌 레벨 표시 (화면 좌표)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(canvasWidth - 78, canvasHeight - 30, 68, 22)
  ctx.fillStyle = '#94a3b8'
  ctx.font = '12px monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`${Math.round(s * 100)}%`, canvasWidth - 70, canvasHeight - 14)
}

/** 월드 좌표에 있는 done 결과 id (선택 대상은 done만). */
export function hitTest(rows: LayoutRow[], worldX: number, worldY: number): string | null {
  for (const row of rows) {
    for (const n of row.nodes) {
      if (n.result.status !== 'done') continue
      if (worldX >= n.x && worldX <= n.x + n.w && worldY >= n.y && worldY <= n.y + n.h) {
        return n.result.id
      }
    }
  }
  return null
}

/** 월드 좌표 사각형과 겹치는 done 결과 id 목록. */
export function hitTestRect(
  rows: LayoutRow[],
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): string[] {
  const ids: string[] = []
  const left = Math.min(rx, rx + rw)
  const right = Math.max(rx, rx + rw)
  const top = Math.min(ry, ry + rh)
  const bottom = Math.max(ry, ry + rh)
  for (const row of rows) {
    for (const n of row.nodes) {
      if (n.result.status !== 'done') continue
      if (n.x + n.w > left && n.x < right && n.y + n.h > top && n.y < bottom) {
        ids.push(n.result.id)
      }
    }
  }
  return ids
}

/** 드래그 선택 마키 (ctx.restore 후 화면 좌표에서 호출). */
export function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save()
  ctx.strokeStyle = '#c084fc'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.fillStyle = 'rgba(192, 132, 252, 0.08)'
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
