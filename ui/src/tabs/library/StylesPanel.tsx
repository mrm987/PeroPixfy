import { useMemo, useRef, useState } from 'react'
import { styleImageUrl, uploadStyle, type StyleRecord } from '../../api/library'
import { StyleEditModal } from '../../components/StyleEditModal'
import { useLibrary } from '../../stores/library'

const parseTags = (tags: string) => tags.split(',').map((t) => t.trim()).filter(Boolean)

export function StylesPanel() {
  const {
    styles, loras, styleView, nsfwBlur, tagFilter, styleLoraFilter,
    setStyleView, setNsfwBlur, toggleTag, clearJumps, jumpToLora,
    load, applyStyle,
  } = useLibrary()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<StyleRecord | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const allTags = useMemo(
    () => [...new Set(styles.flatMap((s) => parseTags(s.tags)))].sort(),
    [styles],
  )

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

  const blurredClass = (s: StyleRecord) =>
    nsfwBlur && s.nsfw && !revealed.has(s.id) ? ' blurred' : ''
  const reveal = (s: StyleRecord) => setRevealed((r) => new Set(r).add(s.id))

  const filterLoraName = styleLoraFilter
    ? loras.find((l) => l.rel_path === styleLoraFilter)?.name || styleLoraFilter
    : null

  return (
    <section className="lib-panel">
      <div className="lib-header">
        <h3>스타일 ({filtered.length}/{styles.length})</h3>
        <input placeholder="검색 (이름/태그/프롬프트)" value={query}
          onChange={(e) => setQuery(e.target.value)} />
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

      {allTags.length > 0 && (
        <div className="tag-bar">
          {allTags.map((t) => (
            <button key={t} className={`chip clickable${tagFilter.includes(t) ? ' active' : ''}`}
              onClick={() => toggleTag(t)}>{t}</button>
          ))}
        </div>
      )}

      {filterLoraName && (
        <div className="jump-banner">
          로라 <b>{filterLoraName}</b> 사용 스타일만 표시
          <button onClick={clearJumps}>해제</button>
        </div>
      )}

      {styleView === 'grid' ? (
        <div className="style-grid">
          {filtered.map((s) => (
            <div key={s.id} className="style-card">
              <div className={`card-media${blurredClass(s)}`}
                onClick={() => blurredClass(s) && reveal(s)}>
                {s.image_file && !s.image_missing ? (
                  <img src={styleImageUrl(s.image_file)} alt={s.name} loading="lazy" />
                ) : (
                  <div className="thumb-missing">이미지 없음</div>
                )}
                <div className="card-hover">
                  {(s.loras ?? []).length > 0 && (
                    <div className="lora-chips">
                      {(s.loras ?? []).map((l, i) => (
                        <span key={i}
                          className={`chip${l.enabled ? '' : ' off'}${l.lora_rel_path ? ' clickable' : ''}`}
                          title={l.lora_rel_path ? `${l.lora_rel_path} — 클릭해서 로라로 이동` : `${l.display_name} (DB에 없음)`}
                          onClick={(e) => {
                            if (!l.lora_rel_path) return
                            e.stopPropagation()
                            jumpToLora(l.lora_rel_path)
                          }}>
                          {(l.display_name || l.lora_rel_path).replace(/\.safetensors$/, '')} · {l.strength}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="card-actions">
                    <button onClick={(e) => { e.stopPropagation(); applyStyle(s) }}>작업대에 적용</button>
                    <button onClick={(e) => { e.stopPropagation(); setEditing(s) }}>편집</button>
                  </div>
                </div>
              </div>
              <div className="card-info">
                <div className="card-name" title={s.name}>{s.name || '(이름 없음)'}</div>
                <div className="card-sub" title={s.checkpoint}>{s.checkpoint || s.tags || ' '}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="list-view">
          {filtered.map((s) => (
            <div key={s.id} className="list-row">
              <div className={`list-thumb${blurredClass(s)}`} onClick={() => reveal(s)}>
                {s.image_file && !s.image_missing && <img src={styleImageUrl(s.image_file)} alt="" loading="lazy" />}
              </div>
              <div className="list-main">
                <div className="card-name">{s.name || '(이름 없음)'}</div>
                <div className="card-sub">{s.checkpoint} {s.tags && `· ${s.tags}`}</div>
              </div>
              <button onClick={() => applyStyle(s)}>적용</button>
              <button onClick={() => setEditing(s)}>편집</button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <StyleEditModal style={editing} onSaved={load} onClose={() => setEditing(null)} />
      )}
    </section>
  )
}
