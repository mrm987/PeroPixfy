import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

/**
 * 인페인트 마스크 에디터. 칠한 영역을 흰색, 나머지를 검정으로 한 마스크 PNG를
 * 돌려준다 (ImageToMask로 변환 — 원본 이미지는 손대지 않음).
 * initialMask가 주어지면 기존 마스크(흑백 PNG)를 불러와 이어서 편집한다. 지우개 지원.
 */
export function MaskEditor({
  imageUrl, initialMask, onApply, onClose,
}: {
  imageUrl: string
  initialMask?: string
  onApply: (blob: Blob) => void
  onClose: () => void
}) {
  const t = useT()
  const viewRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const [brush, setBrush] = useState(64)
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      const view = viewRef.current!
      view.width = img.naturalWidth
      view.height = img.naturalHeight
      maskRef.current.width = img.naturalWidth
      maskRef.current.height = img.naturalHeight
      const finish = () => { setReady(true); redraw() }
      // 기존 마스크(흰색=마스크 영역)를 빨강 스트로크로 maskRef에 복원해 이어 그리게 한다.
      if (initialMask) {
        const m = new Image()
        m.onload = () => {
          const w = img.naturalWidth, h = img.naturalHeight
          const tmp = document.createElement('canvas')
          tmp.width = w; tmp.height = h
          const tctx = tmp.getContext('2d')!
          tctx.drawImage(m, 0, 0, w, h)
          const md = tctx.getImageData(0, 0, w, h)
          const mctx = maskRef.current.getContext('2d')!
          const out = mctx.createImageData(w, h)
          for (let i = 0; i < md.data.length; i += 4) {
            if (md.data[i] > 128) { // 흰색 = 마스크
              out.data[i] = 255; out.data[i + 1] = 51; out.data[i + 2] = 85; out.data[i + 3] = 255
            }
          }
          mctx.putImageData(out, 0, 0)
          finish()
        }
        m.onerror = finish
        m.src = initialMask
      } else finish()
    }
    img.src = imageUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, initialMask])

  const redraw = () => {
    const view = viewRef.current
    const img = imgRef.current
    if (!view || !img) return
    const ctx = view.getContext('2d')!
    ctx.globalAlpha = 1
    ctx.drawImage(img, 0, 0)
    ctx.globalAlpha = 0.55
    ctx.drawImage(maskRef.current, 0, 0)
    ctx.globalAlpha = 1
  }

  const toCanvasPos = (e: React.PointerEvent) => {
    const view = viewRef.current!
    const rect = view.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * view.width,
      y: ((e.clientY - rect.top) / rect.height) * view.height,
    }
  }

  const paint = (e: React.PointerEvent) => {
    const pos = toCanvasPos(e)
    const ctx = maskRef.current.getContext('2d')!
    // 지우개는 destination-out으로 마스크 픽셀을 제거.
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = ctx.fillStyle = '#ff3355'
    ctx.lineWidth = brush
    ctx.lineCap = ctx.lineJoin = 'round'
    if (lastPos.current) {
      ctx.beginPath()
      ctx.moveTo(lastPos.current.x, lastPos.current.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, brush / 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    lastPos.current = pos
    redraw()
  }

  const apply = () => {
    const img = imgRef.current!
    const w = img.naturalWidth
    const h = img.naturalHeight
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const strokes = maskRef.current.getContext('2d')!.getImageData(0, 0, w, h)
    const o = ctx.getImageData(0, 0, w, h)
    for (let i = 3; i < strokes.data.length; i += 4) {
      if (strokes.data[i] > 0) {
        o.data[i - 3] = o.data[i - 2] = o.data[i - 1] = 255
      }
    }
    ctx.putImageData(o, 0, 0)
    out.toBlob((blob) => blob && onApply(blob), 'image/png')
  }

  const clear = () => {
    const ctx = maskRef.current.getContext('2d')!
    ctx.clearRect(0, 0, maskRef.current.width, maskRef.current.height)
    redraw()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="mask-editor" onClick={(e) => e.stopPropagation()}>
        <div className="mask-toolbar">
          <button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>{t('Brush')}</button>
          <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>{t('Eraser')}</button>
          <label>
            {brush}px{' '}
            <input type="range" min={8} max={256} value={brush}
              onChange={(e) => setBrush(Number(e.target.value))} />
          </label>
          <button onClick={clear}>{t('Clear all')}</button>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="generate" onClick={apply} disabled={!ready}>{t('Apply mask')}</button>
        </div>
        <canvas
          ref={viewRef}
          onPointerDown={(e) => { drawing.current = true; lastPos.current = null; paint(e) }}
          onPointerMove={(e) => { if (drawing.current) paint(e) }}
          onPointerUp={() => { drawing.current = false; lastPos.current = null }}
          onPointerLeave={() => { drawing.current = false; lastPos.current = null }}
        />
      </div>
    </div>
  )
}
