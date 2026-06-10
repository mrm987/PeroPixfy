import { useEffect, useRef, useState } from 'react'

/**
 * 인페인트 마스크 에디터. 브러시로 칠한 영역의 알파를 0으로 만든 PNG를 돌려준다
 * (LoadImage의 MASK 출력 = 1 - alpha → 칠한 곳이 인페인트 대상).
 */
export function MaskEditor({
  imageUrl, onApply, onClose,
}: {
  imageUrl: string
  onApply: (blob: Blob) => void
  onClose: () => void
}) {
  const viewRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const [brush, setBrush] = useState(64)
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
      setReady(true)
      redraw()
    }
    img.src = imageUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

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
    lastPos.current = pos
    redraw()
  }

  const apply = () => {
    const img = imgRef.current!
    const out = document.createElement('canvas')
    out.width = img.naturalWidth
    out.height = img.naturalHeight
    const ctx = out.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(maskRef.current, 0, 0)
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
          <label>
            브러시 {brush}px{' '}
            <input type="range" min={8} max={256} value={brush}
              onChange={(e) => setBrush(Number(e.target.value))} />
          </label>
          <button onClick={clear}>지우기</button>
          <button onClick={onClose}>취소</button>
          <button className="generate" onClick={apply} disabled={!ready}>마스크 적용</button>
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
