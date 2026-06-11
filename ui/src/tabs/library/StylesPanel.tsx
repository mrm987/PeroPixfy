import { useMemo, useRef, useState } from 'react'
import { styleImageUrl, uploadStyle, type StyleRecord } from '../../api/library'
import { Lightbox } from '../../components/Lightbox'
import { StyleEditModal } from '../../components/StyleEditModal'
import { useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { previewPosition, type PreviewState } from './LorasPanel'

const parseTags = (tags: string) => tags.split(',').map((t) => t.trim()).filter(Boolean)

/** embedded: 드로어 안에서 사용 — Apply가 탭 전환 없이 적용만 하고 피드백을 표시 */
export function StylesPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    styles, loras, styleView, nsfwBlur, tagFilter, styleLoraFilter,
    setStyleView, setNsfwBlur, toggleTag, clearJumps, jumpToLora,
    load, applyStyle, renameStyle,
  } = useLibrary()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<StyleRecord | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [uploading, setUploading] = useState(false)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [appliedId, setAppliedId] = useState<number | null>(null)
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
      if (!r.ok) alert(`Upload failed (${f.name}): ${r.error ?? 'no embedded workflow metadata?'}`)
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

  const commitRename = async (id: number) => {
    const name = renameVal.trim()
    setRenaming(null)
    if (name) await renameStyle(id, name)
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
            <div className="thumb-missing">no image</div>
          )}
          {blurred && <div className="reveal-overlay" onClick={() => reveal(s)}>Click to reveal</div>}
          {!!s.nsfw && <span className="nsfw-tag">NSFW</span>}
        </div>
        <div className="card-body">
          {renaming === s.id ? (
            <input className="rename-input" autoFocus value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={() => commitRename(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(s.id)
                if (e.key === 'Escape') setRenaming(null)
              }} />
          ) : (
            <div className="card-name" title={`${s.name || '(untitled)'} — double-click to rename`}
              onDoubleClick={() => { setRenaming(s.id); setRenameVal(s.name) }}>
              {s.name || '(untitled)'}
            </div>
          )}
          {tags.length > 0 && (
            <div className="chips">
              {tags.map((t) => (
                <span key={t} className={`chip tag${tagFilter.includes(t) ? ' active' : ''}`}
                  title="Filter by tag" onClick={() => toggleTag(t)}>{t}</span>
              ))}
            </div>
          )}
          <div className="chips">
            {s.checkpoint
              ? <span className="chip ckpt" title={s.checkpoint}>{s.checkpoint}</span>
              : <span className="chip empty">base model not detected</span>}
          </div>
          <div className="chips">
            {styleLoraList.length === 0 ? (
              <span className="chip empty">no LoRAs detected</span>
            ) : (
              <>
                {shownLoras.map((l, i) => (
                  <span key={i}
                    className={`chip${l.enabled ? '' : ' off'}`}
                    title={l.lora_rel_path
                      ? `${l.lora_rel_path} — click to jump to LoRA`
                      : `${l.display_name} (not in library)`}
                    onClick={() => l.lora_rel_path && jumpToLora(l.lora_rel_path)}>
                    <span className="strength">{l.strength}</span>
                    {(l.display_name || l.lora_rel_path).replace(/\.safetensors$/, '')}
                  </span>
                ))}
                {styleLoraList.length > 1 && (
                  <span className="chip toggle" onClick={() => toggleExpand(s.id)}>
                    {isExp ? 'collapse ▲' : `+${styleLoraList.length - 1} ▼`}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="card-actions">
            <button title={embedded
              ? "Apply this style's settings to the current setup"
              : "Apply this style's settings and open the Workbench"}
              onClick={() => {
                applyStyle(s)
                if (embedded) {
                  setAppliedId(s.id)
                  setTimeout(() => setAppliedId(null), 1400)
                } else {
                  useUi.getState().setTab('workbench')
                }
              }}>
              {appliedId === s.id ? '✓ Applied' : 'Apply'}
            </button>
            <button title="Edit" onClick={() => setEditing(s)}>✎</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="lib-panel">
      <div className="lib-header">
        <h3>Styles ({filtered.length}/{styles.length})</h3>
        <span className="search-wrap">
          <input placeholder="Search (name/tags/prompt)" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="search-clear" onClick={() => setQuery('')}>×</button>}
        </span>
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          title="Register a ComfyUI output PNG as a style (drag & drop also works)">
          {uploading ? 'Uploading…' : '+ Add'}
        </button>
        <input ref={fileRef} type="file" accept="image/png" multiple hidden
          onChange={(e) => e.target.files && doUpload(e.target.files)} />
        <button onClick={() => setStyleView(styleView === 'grid' ? 'list' : 'grid')}
          title="Toggle grid/list">{styleView === 'grid' ? '☰' : '▦'}</button>
        <label className="checkbox" title="Blur NSFW thumbnails">
          <input type="checkbox" checked={nsfwBlur} onChange={(e) => setNsfwBlur(e.target.checked)} /> Blur
        </label>
      </div>

      {tagFilter.length > 0 && (
        <div className="filter-bar">
          <span className="filter-label">Tag filter:</span>
          {tagFilter.map((t) => (
            <span key={t} className="chip tag active" onClick={() => toggleTag(t)}>{t}</span>
          ))}
          <button className="filter-clear" onClick={() => tagFilter.forEach(toggleTag)}>clear all</button>
        </div>
      )}

      {filterLoraName && (
        <div className="jump-banner">
          Showing styles using <b>{filterLoraName}</b>
          <button onClick={clearJumps}>clear</button>
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
