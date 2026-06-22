import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { useLibrary } from '../../stores/library'

const norm = (s: string) => s.replace(/\\/g, '/')
const short = (s: string) => norm(s).split('/').pop()!.replace(/\.(safetensors|ckpt|pt)$/i, '')

type PreviewState = { url: string | null; video: boolean; x: number; y: number } | null

// 호버한 요소 오른쪽에 220px 프리뷰. 화면 밖이면 왼쪽으로 뒤집는다.
function placeBox(rect: DOMRect, size = 220): { x: number; y: number } {
  let x = rect.right + 8
  if (x + size > window.innerWidth) x = Math.max(8, rect.left - size - 8)
  const y = Math.min(Math.max(rect.top - 16, 8), window.innerHeight - size - 8)
  return { x, y }
}

/**
 * 로라 선택 드롭다운 (네이티브 select 대체). 닫힌 버튼 또는 목록 항목에 호버하면
 * Style-Manager 라이브러리에 저장된 해당 로라의 썸네일을 띄운다. 드롭다운 패널과
 * 프리뷰는 portal로 body에 렌더해 스크롤 컨테이너의 overflow 클리핑을 피한다.
 */
export function LoraPicker({
  value,
  options,
  onChange,
  missing,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  missing?: boolean
}) {
  const t = useT()
  const loras = useLibrary((s) => s.loras)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<PreviewState>(null)
  const [panelPos, setPanelPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const byPath = useMemo(() => {
    const m = new Map<string, (typeof loras)[number]>()
    for (const l of loras) m.set(norm(l.rel_path), l)
    return m
  }, [loras])
  const recOf = (p: string) => byPath.get(norm(p))

  const showPreview = (el: HTMLElement, p: string) => {
    const rec = recOf(p)
    // 썸네일이 없어도 'no preview' 플레이스홀더를 띄운다 (url=null).
    setPreview({ url: rec?.thumb_url || null, video: rec?.thumb_type === 'video', ...placeBox(el.getBoundingClientRect()) })
  }

  const openPanel = () => {
    const r = btnRef.current!.getBoundingClientRect()
    const width = Math.max(r.width, 280)
    const maxH = 360
    let top = r.bottom + 2
    if (top + maxH > window.innerHeight) top = Math.max(8, r.top - maxH - 2)
    const left = Math.min(r.left, window.innerWidth - width - 8)
    setPanelPos({ left, top, width })
    setQuery('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) {
        setOpen(false)
        setPreview(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setPreview(null)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => norm(o).toLowerCase().includes(q) || (recOf(o)?.name || '').toLowerCase().includes(q),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query, byPath])

  return (
    <div className="lora-picker">
      <button type="button" ref={btnRef} className={`lora-picker-btn${missing ? ' missing' : ''}`}
        title={missing ? t('{name} — not installed (excluded on generate)', { name: value }) : value || undefined}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onMouseEnter={(e) => showPreview(e.currentTarget, value)}
        onMouseLeave={() => setPreview(null)}>
        <span className="lora-picker-label">{missing ? '⚠ ' : ''}{value ? short(value) : t('— select LoRA —')}</span>
        <span className="lora-picker-caret">▾</span>
      </button>

      {open && panelPos && createPortal(
        <div className="lora-picker-panel" ref={panelRef}
          style={{ left: panelPos.left, top: panelPos.top, width: panelPos.width }}>
          <input className="lora-picker-search" autoFocus placeholder={t('Search LoRA…')}
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="lora-picker-list">
            {filtered.map((o) => (
              <button type="button" key={o}
                className={`lora-picker-item${o === value ? ' active' : ''}`}
                title={o}
                onClick={() => { onChange(o); setOpen(false); setPreview(null) }}
                onMouseEnter={(e) => showPreview(e.currentTarget, o)}
                onMouseLeave={() => setPreview(null)}>
                {short(o)}
              </button>
            ))}
            {filtered.length === 0 && <div className="lora-picker-empty">{t('no match')}</div>}
          </div>
        </div>,
        document.body,
      )}

      {preview && createPortal(
        <div className="lora-hover-preview" style={{ left: preview.x, top: preview.y }}>
          {preview.url == null ? (
            <div className="lora-hover-empty">{t('no preview')}</div>
          ) : preview.video ? (
            <video src={preview.url} muted loop autoPlay playsInline />
          ) : (
            <img src={preview.url} alt="" />
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
