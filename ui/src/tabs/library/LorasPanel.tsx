import { useEffect, useMemo, useRef, useState } from 'react'
import { hasUpdate, thumbLargeUrl, type LoraRecord } from '../../api/library'
import { Lightbox } from '../../components/Lightbox'
import { LoraEditModal } from '../../components/LoraEditModal'
import { useLibrary, type LoraSort } from '../../stores/library'

const SORTS: { id: LoraSort; label: string }[] = [
  { id: 'recent', label: 'Recently added' },
  { id: 'name', label: 'Name' },
  { id: 'favorite', label: 'Favorites first' },
]

const displayName = (l: LoraRecord) => l.name || l.file_name

export interface PreviewState {
  url: string
  video: boolean
  x: number
  y: number
}

/** 리스트 모드 썸네일 호버 시 240px 프리뷰 위치 계산 (Style-Manager 로직) */
export function previewPosition(rect: DOMRect): { x: number; y: number } {
  let x = rect.right + 8
  if (x + 240 > window.innerWidth) x = Math.max(8, rect.left - 248)
  const y = Math.min(Math.max(rect.top + rect.height / 2 - 120, 8), window.innerHeight - 248)
  return { x, y }
}

export function LorasPanel() {
  const {
    loras, loraView, nsfwBlur, category, favOnly, updatesOnly, sort, loraExactFilter,
    scan, update,
    setLoraView, setNsfwBlur, setCategory, setFavOnly, setUpdatesOnly, setSort, clearJumps,
    load, toggleFavorite, saveLora, rescan, checkUpdates, jumpToStylesUsing, addLoraToWorkbench,
  } = useLibrary()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<LoraRecord | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const exactRef = useRef<HTMLDivElement>(null)

  const categories = useMemo(
    () => [...new Set(loras.map((l) => l.base_category).filter(Boolean))].sort(),
    [loras],
  )

  const filtered = useMemo(() => {
    if (loraExactFilter) return loras.filter((l) => l.rel_path === loraExactFilter)
    const q = query.toLowerCase()
    const arr = loras.filter((l) => {
      if (favOnly && !l.favorite) return false
      if (updatesOnly && !hasUpdate(l)) return false
      if (category && l.base_category !== category) return false
      if (!q) return true
      return [l.name, l.rel_path, l.trigger_words, l.base_model]
        .some((f) => f?.toLowerCase().includes(q))
    })
    const byName = (a: LoraRecord, b: LoraRecord) => displayName(a).localeCompare(displayName(b))
    if (sort === 'name') arr.sort(byName)
    else if (sort === 'recent') arr.sort((a, b) => (b.ctime || 0) - (a.ctime || 0))
    else arr.sort((a, b) => b.favorite - a.favorite || byName(a, b))
    return arr
  }, [loras, query, category, favOnly, updatesOnly, sort, loraExactFilter])

  const favs = useMemo(() => filtered.filter((l) => l.favorite), [filtered])
  const rest = useMemo(() => filtered.filter((l) => !l.favorite), [filtered])

  useEffect(() => {
    if (loraExactFilter) exactRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [loraExactFilter])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1500)
  }

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text)
    showToast(`Copied: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`)
  }

  const isBlurred = (l: LoraRecord) => nsfwBlur && !!l.nsfw && !revealed.has(l.rel_path)
  const reveal = (l: LoraRecord) => setRevealed((r) => new Set(r).add(l.rel_path))
  const toggleExpand = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const onThumbClick = (l: LoraRecord) => {
    if (isBlurred(l)) reveal(l)
    else if (l.thumb_url) setZoom(thumbLargeUrl(l.rel_path))
  }

  const onThumbEnter = (e: React.MouseEvent, l: LoraRecord) => {
    if (loraView !== 'list' || !l.thumb_url || isBlurred(l)) return
    const pos = previewPosition(e.currentTarget.getBoundingClientRect())
    setPreview({ url: l.thumb_url, video: l.thumb_type === 'video', ...pos })
  }

  const card = (l: LoraRecord) => {
    const triggers = l.trigger_words
      ? l.trigger_words.split(',').map((t) => t.trim()).filter(Boolean)
      : []
    const isExp = expanded.has(l.rel_path)
    const shown = isExp ? triggers : triggers.slice(0, 1)
    const blurred = isBlurred(l)
    return (
      <div key={l.rel_path} ref={l.rel_path === loraExactFilter ? exactRef : undefined}
        className={`lora-card${l.rel_path === loraExactFilter ? ' highlighted' : ''}`}>
        <div className={`thumb-wrap${blurred ? ' blurred' : ''}`}
          onMouseEnter={(e) => onThumbEnter(e, l)}
          onMouseLeave={() => setPreview(null)}>
          {l.thumb_url ? (
            l.thumb_type === 'video'
              ? <video src={l.thumb_url} muted loop autoPlay playsInline onClick={() => onThumbClick(l)} />
              : <img src={l.thumb_url} alt="" loading="lazy" onClick={() => onThumbClick(l)} />
          ) : (
            <div className="thumb-missing">{l.file_name}</div>
          )}
          {blurred && <div className="reveal-overlay" onClick={() => reveal(l)}>Click to reveal</div>}
          <button className={`fav${l.favorite ? ' on' : ''}`} title="Favorite"
            onClick={() => toggleFavorite(l.rel_path)}>★</button>
          {!!l.nsfw && <span className="nsfw-tag">NSFW</span>}
          {hasUpdate(l) && (
            <span className="update-tag" title={`New version: ${l.latest_version_name}`}>⬆ UPDATE</span>
          )}
        </div>
        <div className="card-body">
          <div className="card-name" title={l.rel_path}>{displayName(l)}</div>
          {l.base_model && <div className="card-base">{l.base_model}</div>}
          {triggers.length > 0 && (
            <div className="chips">
              {shown.map((t) => (
                <span key={t} className="chip" title="Click to copy" onClick={() => copyText(t)}>{t}</span>
              ))}
              {triggers.length > 1 && (
                <span className="chip toggle" onClick={() => toggleExpand(l.rel_path)}>
                  {isExp ? 'collapse ▲' : `+${triggers.length - 1} ▼`}
                </span>
              )}
            </div>
          )}
          {l.style_count > 0 && (
            <div className="chips">
              <span className="chip styles-badge" title="Show styles using this LoRA"
                onClick={() => jumpToStylesUsing(l.rel_path)}>
                Used in {l.style_count} style{l.style_count > 1 ? 's' : ''}
              </span>
            </div>
          )}
          <div className="card-actions">
            <button title="Add to workbench LoRA stack" onClick={() => addLoraToWorkbench(l.rel_path)}>＋ Stack</button>
            <button title="Copy all trigger words" disabled={!l.trigger_words}
              onClick={() => copyText(l.trigger_words)}>⧉</button>
            <button title="Open on CivitAI" disabled={!l.civitai_url}
              onClick={() => window.open(l.civitai_url, '_blank')}>↗</button>
            <button title="Edit" onClick={() => setEditing(l)}>✎</button>
          </div>
        </div>
      </div>
    )
  }

  const grid = (items: LoraRecord[]) => (
    <div className={`lora-grid${loraView === 'list' ? ' list-mode' : ''}`}>{items.map(card)}</div>
  )

  const progress = scan?.scanning
    ? (scan.total ? scan.done / scan.total : 0)
    : update?.checking
      ? (update.total ? update.done / update.total : 0)
      : null

  return (
    <section className="lib-panel">
      <div className="lib-header">
        <h3>LoRAs ({filtered.length}/{loras.length})</h3>
        <span className="search-wrap">
          <input placeholder="Search (name/trigger/base)" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="search-clear" onClick={() => setQuery('')}>×</button>}
        </span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All bases</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as LoraSort)}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="checkbox"><input type="checkbox" checked={favOnly}
          onChange={(e) => setFavOnly(e.target.checked)} /> ★ only</label>
        <label className="checkbox" title="Only LoRAs with a newer version on CivitAI">
          <input type="checkbox" checked={updatesOnly}
            onChange={(e) => setUpdatesOnly(e.target.checked)} /> Updates</label>
        <button onClick={() => rescan()} disabled={scan?.scanning} title="Rescan LoRA folders">
          {scan?.scanning ? `Scanning ${scan.done}/${scan.total}` : 'Scan'}
        </button>
        <button onClick={checkUpdates} disabled={update?.checking} title="Check CivitAI for new versions">
          {update?.checking ? `Checking ${update.done}/${update.total}` : 'Check updates'}
        </button>
        <button onClick={() => setLoraView(loraView === 'grid' ? 'list' : 'grid')}
          title="Toggle grid/list">{loraView === 'grid' ? '☰' : '▦'}</button>
        <label className="checkbox" title="Blur NSFW thumbnails">
          <input type="checkbox" checked={nsfwBlur} onChange={(e) => setNsfwBlur(e.target.checked)} /> Blur
        </label>
      </div>

      {progress !== null && <div className="lib-progress" style={{ width: `${Math.round(progress * 100)}%` }} />}

      {update && !update.checking && update.total > 0 && (
        <div className="lib-meta">
          Update check done: {update.updates} new version{update.updates !== 1 ? 's' : ''}
          {update.errors > 0 && `, ${update.errors} errors`}
        </div>
      )}

      {loraExactFilter && (
        <div className="jump-banner">
          Showing selected LoRA only
          <button onClick={clearJumps}>clear</button>
        </div>
      )}

      <div className="lib-scroll">
        {loraExactFilter || favOnly || sort === 'favorite' ? (
          grid(filtered)
        ) : (
          <>
            {favs.length > 0 && (
              <>
                <div className="grid-section fav">★ Favorites {favs.length}</div>
                {grid(favs)}
              </>
            )}
            <div className={`grid-section${favs.length > 0 ? ' rest' : ''}`}>All {rest.length}</div>
            {grid(rest)}
          </>
        )}
      </div>

      {editing && (
        <LoraEditModal lora={editing}
          onSave={(fields) => saveLora(editing.rel_path, fields)}
          onDeleted={load}
          onClose={() => setEditing(null)} />
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      {preview && (
        <div className="hover-preview" style={{ left: preview.x, top: preview.y }}>
          {preview.video ? <video src={preview.url} muted loop autoPlay playsInline /> : <img src={preview.url} alt="" />}
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </section>
  )
}
