import { useEffect, useMemo, useRef, useState } from 'react'
import { hasUpdate, thumbLargeUrl, type LoraRecord } from '../../api/library'
import { Lightbox } from '../../components/Lightbox'
import { LoraEditModal } from '../../components/LoraEditModal'
import { useLibrary, type LoraSort } from '../../stores/library'

const SORTS: { id: LoraSort; label: string }[] = [
  { id: 'recent', label: '추가순' },
  { id: 'name', label: '이름순' },
  { id: 'favorite', label: '즐겨찾기 우선' },
]

const displayName = (l: LoraRecord) => l.name || l.file_name

function Thumb({ lora, onZoom }: { lora: LoraRecord; onZoom: () => void }) {
  if (!lora.thumb_url) return <div className="thumb-missing">{lora.file_name}</div>
  if (lora.thumb_type === 'video') {
    return <video src={lora.thumb_url} muted loop autoPlay playsInline onClick={onZoom} />
  }
  return <img src={lora.thumb_url} alt="" loading="lazy" onClick={onZoom} />
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
  const [copied, setCopied] = useState<string | null>(null)
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

  useEffect(() => {
    if (loraExactFilter) exactRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [loraExactFilter])

  const copyTriggers = async (l: LoraRecord) => {
    await navigator.clipboard.writeText(l.trigger_words)
    setCopied(l.rel_path)
    setTimeout(() => setCopied(null), 1200)
  }

  const blurredClass = (l: LoraRecord) =>
    nsfwBlur && l.nsfw && !revealed.has(l.rel_path) ? ' blurred' : ''
  const reveal = (l: LoraRecord) => setRevealed((r) => new Set(r).add(l.rel_path))

  const onZoom = (l: LoraRecord) => {
    if (blurredClass(l)) reveal(l)
    else if (l.thumb_url) setZoom(thumbLargeUrl(l.rel_path))
  }

  const badges = (l: LoraRecord) => (
    <>
      {hasUpdate(l) && (
        <a className="badge update" href={l.civitai_url} target="_blank" rel="noreferrer"
          title={`새 버전: ${l.latest_version_name}`} onClick={(e) => e.stopPropagation()}>NEW</a>
      )}
      {l.style_count > 0 && (
        <button className="badge styles" title="이 로라를 쓰는 스타일 보기"
          onClick={(e) => { e.stopPropagation(); jumpToStylesUsing(l.rel_path) }}>
          스타일 {l.style_count}
        </button>
      )}
    </>
  )

  return (
    <section className="lib-panel">
      <div className="lib-header">
        <h3>로라 ({filtered.length}/{loras.length})</h3>
        <input placeholder="검색 (이름/트리거/베이스)" value={query}
          onChange={(e) => setQuery(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">모든 베이스</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as LoraSort)}>
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <label className="checkbox"><input type="checkbox" checked={favOnly}
          onChange={(e) => setFavOnly(e.target.checked)} /> ★만</label>
        <label className="checkbox" title="새 버전이 있는 로라만">
          <input type="checkbox" checked={updatesOnly}
            onChange={(e) => setUpdatesOnly(e.target.checked)} /> 업데이트만</label>
        <button onClick={() => rescan()} disabled={scan?.scanning}
          title="로라 폴더 재스캔">{scan?.scanning ? `스캔 ${scan.done}/${scan.total}` : '스캔'}</button>
        <button onClick={checkUpdates} disabled={update?.checking}
          title="CivitAI에서 새 버전 확인">
          {update?.checking ? `확인 ${update.done}/${update.total}` : '업데이트 체크'}
        </button>
        <button onClick={() => setLoraView(loraView === 'grid' ? 'list' : 'grid')}
          title="그리드/리스트 전환">{loraView === 'grid' ? '☰' : '▦'}</button>
        <label className="checkbox" title="NSFW 썸네일 블러">
          <input type="checkbox" checked={nsfwBlur} onChange={(e) => setNsfwBlur(e.target.checked)} /> 블러
        </label>
      </div>

      {update && !update.checking && update.total > 0 && (
        <div className="jump-banner subtle">
          업데이트 체크 완료: {update.updates}개 새 버전{update.errors > 0 && `, 오류 ${update.errors}`}
        </div>
      )}

      {loraExactFilter && (
        <div className="jump-banner">
          선택한 로라만 표시 중
          <button onClick={clearJumps}>해제</button>
        </div>
      )}

      {loraView === 'grid' ? (
        <div className="lora-grid">
          {filtered.map((l) => (
            <div key={l.rel_path} ref={l.rel_path === loraExactFilter ? exactRef : undefined}
              className={`lora-card${l.rel_path === loraExactFilter ? ' highlighted' : ''}`}>
              <div className={`card-media${blurredClass(l)}`}>
                <Thumb lora={l} onZoom={() => onZoom(l)} />
                <button className={`fav${l.favorite ? ' on' : ''}`}
                  onClick={() => toggleFavorite(l.rel_path)}>★</button>
                <div className="badge-row">{badges(l)}</div>
                <div className="card-hover">
                  {l.trigger_words && (
                    <div className="card-sub trigger" title={`${l.trigger_words} (클릭해서 복사)`}
                      onClick={() => copyTriggers(l)}>
                      {copied === l.rel_path ? '✓ 복사됨' : l.trigger_words}
                    </div>
                  )}
                  <div className="card-actions">
                    <button onClick={() => addLoraToWorkbench(l.rel_path)}>+ 스택에 추가</button>
                    <button onClick={() => setEditing(l)}>편집</button>
                  </div>
                </div>
              </div>
              <div className="card-info">
                <div className="card-name" title={l.rel_path}>{displayName(l)}</div>
                <div className="card-sub" title={l.base_model}>{l.base_model || ' '}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="list-view">
          {filtered.map((l) => (
            <div key={l.rel_path} ref={l.rel_path === loraExactFilter ? exactRef : undefined}
              className={`list-row${l.rel_path === loraExactFilter ? ' highlighted' : ''}`}>
              <div className={`list-thumb${blurredClass(l)}`} onClick={() => onZoom(l)}>
                {l.thumb_url && (l.thumb_type === 'video'
                  ? <video src={l.thumb_url} muted loop autoPlay playsInline />
                  : <img src={l.thumb_url} alt="" loading="lazy" />)}
              </div>
              <div className="list-main">
                <div className="card-name">
                  {displayName(l)} {badges(l)}
                </div>
                <div className="card-sub">
                  {l.base_model}
                  {l.trigger_words && (
                    <span className="trigger" onClick={() => copyTriggers(l)}>
                      {' · '}{copied === l.rel_path ? '✓ 복사됨' : l.trigger_words}
                    </span>
                  )}
                </div>
              </div>
              <button className={`fav inline${l.favorite ? ' on' : ''}`}
                onClick={() => toggleFavorite(l.rel_path)}>★</button>
              <button onClick={() => addLoraToWorkbench(l.rel_path)}>+ 스택</button>
              <button onClick={() => setEditing(l)}>편집</button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <LoraEditModal lora={editing}
          onSave={(fields) => saveLora(editing.rel_path, fields)}
          onDeleted={load}
          onClose={() => setEditing(null)} />
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </section>
  )
}
