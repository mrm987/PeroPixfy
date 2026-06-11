import { useMemo, useRef, useState } from 'react'
import { styleImageUrl, uploadStyle, type StyleRecord } from '../../api/library'
import { Lightbox } from '../../components/Lightbox'
import { StyleEditModal } from '../../components/StyleEditModal'
import { useLibrary } from '../../stores/library'
import { previewPosition, type PreviewState } from './LorasPanel'

const parseTags = (tags: string) => tags.split(',').map((t) => t.trim()).filter(Boolean)

export function StylesPanel() {
  const {
    styles, loras, styleView, nsfwBlur, tagFilter, styleLoraFilter,
    setStyleView, setNsfwBlur, toggleTag, clearJumps, jumpToLora,
    load, applyStyle,
  } = useLibrary()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<StyleRecord | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return styles.filter((s) => {
      if (styleLoraFilter && !(s.loras ?? []).some((l) => l.enabled && l.lora_rel_path === styleLoraFilter)) {
        return false
      }
      if (tagFilter.length > 0) {
        const tags = parseTags(s.tags)
        if (!tagFilter.every((t) => tags.includes(t))) return false
      }
      if (!q) return true
      return [s.name, s.tags, s.checkpoint, s.positive_prompt].some((f) => f?.toLowerCase().includes(q))
    })
  }, [styles, query, tagFilter, styleLoraFilter])

  const doUpload = async (files: FileList | File[]) => {
    setUploading(true)
    for (const f of files) {
      const r = await uploadStyle(f)
      if (!r.ok) alert(`업로드 실패 (${f.name}): ${r.error ?? '워크플로우 메타데이터 없음?'}`)
    }
    setUploading(false)
    load()
  }

  const isBlurred = (s: StyleRecord) => nsfwBlur && !!s.nsfw && !revealed.has(s.id)
  const reveal = (s: StyleRecord) => setRevealed((r) => new Set(r).add(s.id))
  const toggleExpand = (id: number) =>
    setExpanded((set) => {
      const next = new Set(set)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onThumbClick = (s: StyleRecord) => {
    if (isBlurred(s)) reveal(s)
    else if (s.image_file && !s.image_missing) setZoom(styleImageUrl(s.image_file))
  }

  const onThumbEnter = (e: React.MouseEvent, s: StyleRecord) => {
    if (styleView !== 'list' || !s.image_file || s.image_missing || isBlurred(s)) return
    const pos = previewPosition(e.currentTarget.getBoundingClientRect())
    setPreview({ url: styleImageUrl(s.image_file), video: false, ...pos })
  }

  const filterLoraName = styleLoraFilter
    ? loras.find((l) => l.rel_path === styleLoraFilter)?.name || styleLoraFilter
    : null

  const card = (s: StyleRecord) => {
    const tags = parseTags(s.tags)
    const styleLoraList = s.loras ?? []
    const isExp = expanded.has(s.id)
    const shownLoras = isExp ? styleLoraList : styleLoraList.slice(0, 1)
    const blurred = isBlurred(s)
    return (
      <div key={s.id} className="style-card">
        <div className={`thumb-wrap${blurred ? ' blurred' : ''}`}
          onMouseEnter={(e) => onThumbEnter(e, s)}
          onMouseLeave={() => setPreview(null)}>
          {s.image_file && !s.image_missing ? (
            <img src={styleImageUrl(s.image_file)} alt={s.name} loading="lazy"
              onClick={() => onThumbClick(s)} />
          ) : (
            <div className="thumb-missing">이미지 없음</div>
          )}
          {blurred && <div className="reveal-overlay" onClick={() => reveal(s)}>클릭해서 표시</div>}
          {!!s.nsfw && <span className="nsfw-tag">NSFW</span>}
        </div>
        <div className="card-body">
          <div className="card-name" title={s.name}>{s.name || '(이름 없음)'}</div>
          {tags.length > 0 && (
            <div className="chips">
              {tags.map((t) => (
                <span key={t} className={`chip tag${tagFilter.includes(t) ? ' active' : ''}`}
                  title="태그로 필터" onClick={() => toggleTag(t)}>{t}</span>
              ))}
            </div>
          )}
          <div className="chips">
            {s.checkpoint
              ? <span className="chip ckpt" title={s.checkpoint}>{s.checkpoint}</span>
              : <span className="chip empty">베이스 모델 없음</span>}
          </div>
          <div className="chips">
            {styleLoraList.length === 0 ? (
              <span className="chip empty">로라 없음</span>
            ) : (
              <>
                {shownLoras.map((l, i) => (
                  <span key={i}
                    className={`chip${l.enabled ? '' : ' off'}`}
                    title={l.lora_rel_path
                      ? `${l.lora_rel_path} — 클릭해서 로라로 이동`
                      : `${l.display_name} (DB에 없음)`}
                    onClick={() => l.lora_rel_path && jumpToLora(l.lora_rel_path)}>
                    <span className="strength">{l.strength}</span>
                    {(l.display_name || l.lora_rel_path).replace(/\.safetensors$/, '')}
                  </span>
                ))}
                {styleLoraList.length > 1 && (
                  <span className="chip toggle" onClick={() => toggleExpand(s.id)}>
                    {isExp ? '접기 ▲' : `+${styleLoraList.length - 1} ▼`}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="card-actions">
            <button title="이 스타일의 설정을 작업대에 적용" onClick={() => applyStyle(s)}>작업대에 적용</button>
            <button title="편집" onClick={() => setEditing(s)}>✎</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="lib-panel">
      <div className="lib-header">
        <h3>스타일 ({filtered.length}/{styles.length})</h3>
        <span className="search-wrap">
          <input placeholder="검색 (이름/태그/프롬프트)" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="search-clear" onClick={() => setQuery('')}>×</button>}
        </span>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          title="ComfyUI 출력 PNG에서 워크플로우를 추출해 스타일로 등록 (드래그앤드롭도 가능)">
          {uploading ? '업로드 중…' : '+ 등록'}
        </button>
        <input ref={fileRef} type="file" accept="image/png" multiple hidden
          onChange={(e) => e.target.files && doUpload(e.target.files)} />
        <button onClick={() => setStyleView(styleView === 'grid' ? 'list' : 'grid')}
          title="그리드/리스트 전환">{styleView === 'grid' ? '☰' : '▦'}</button>
        <label className="checkbox" title="NSFW 썸네일 블러">
          <input type="checkbox" checked={nsfwBlur} onChange={(e) => setNsfwBlur(e.target.checked)} /> 블러
        </label>
      </div>

      {tagFilter.length > 0 && (
        <div className="filter-bar">
          <span className="filter-label">태그 필터:</span>
          {tagFilter.map((t) => (
            <span key={t} className="chip tag active" onClick={() => toggleTag(t)}>{t}</span>
          ))}
          <button className="filter-clear" onClick={() => tagFilter.forEach(toggleTag)}>모두 해제</button>
        </div>
      )}

      {filterLoraName && (
        <div className="jump-banner">
          로라 <b>{filterLoraName}</b> 사용 스타일만 표시
          <button onClick={clearJumps}>해제</button>
        </div>
      )}

      <div className="lib-scroll">
        <div className={`style-grid${styleView === 'list' ? ' list-mode' : ''}`}>
          {filtered.map(card)}
        </div>
      </div>

      {editing && (
        <StyleEditModal style={editing} onSaved={load} onClose={() => setEditing(null)} />
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      {preview && (
        <div className="hover-preview" style={{ left: preview.x, top: preview.y }}>
          <img src={preview.url} alt="" />
        </div>
      )}
    </section>
  )
}
