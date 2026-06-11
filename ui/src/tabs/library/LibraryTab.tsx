import { useEffect, useMemo, useState } from 'react'
import { styleImageUrl, type LoraRecord } from '../../api/library'
import { LoraEditModal } from '../../components/LoraEditModal'
import { useLibrary, type LoraSort } from '../../stores/library'

const SORTS: { id: LoraSort; label: string }[] = [
  { id: 'recent', label: '추가순' },
  { id: 'name', label: '이름순' },
  { id: 'favorite', label: '즐겨찾기 우선' },
]

const displayName = (l: LoraRecord) => l.name || l.file_name

export function LibraryTab() {
  const {
    loras, styles, loaded, category, favOnly, sort,
    setCategory, setFavOnly, setSort,
    load, toggleFavorite, saveLora, rescan, applyStyle, addLoraToWorkbench,
  } = useLibrary()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<LoraRecord | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (!loaded) load()
  }, [loaded, load])

  const categories = useMemo(
    () => [...new Set(loras.map((l) => l.base_category).filter(Boolean))].sort(),
    [loras],
  )

  const filteredLoras = useMemo(() => {
    const q = query.toLowerCase()
    const filtered = loras.filter((l) => {
      if (favOnly && !l.favorite) return false
      if (category && l.base_category !== category) return false
      if (!q) return true
      return [l.name, l.rel_path, l.trigger_words, l.base_model]
        .some((f) => f?.toLowerCase().includes(q))
    })
    const byName = (a: LoraRecord, b: LoraRecord) => displayName(a).localeCompare(displayName(b))
    if (sort === 'name') filtered.sort(byName)
    else if (sort === 'recent') filtered.sort((a, b) => (b.ctime || 0) - (a.ctime || 0))
    else filtered.sort((a, b) => b.favorite - a.favorite || byName(a, b))
    return filtered
  }, [loras, query, category, favOnly, sort])

  const copyTriggers = async (l: LoraRecord) => {
    await navigator.clipboard.writeText(l.trigger_words)
    setCopied(l.rel_path)
    setTimeout(() => setCopied(null), 1200)
  }

  return (
    <div className="library">
      <section className="lib-section">
        <div className="lib-header">
          <h3>스타일 ({styles.length})</h3>
        </div>
        <div className="style-grid">
          {styles.map((s) => (
            <div key={s.id} className="style-card">
              {s.image_file && !s.image_missing ? (
                <img src={styleImageUrl(s.image_file)} alt={s.name} loading="lazy" />
              ) : (
                <div className="thumb-missing">이미지 없음</div>
              )}
              <div className="card-overlay">
                <div className="card-name" title={s.name}>{s.name || '(이름 없음)'}</div>
                {s.checkpoint && <div className="card-sub" title={s.checkpoint}>{s.checkpoint}</div>}
                {(s.loras ?? []).length > 0 && (
                  <div className="lora-chips">
                    {(s.loras ?? []).map((l, i) => (
                      <span key={i} className={`chip${l.enabled ? '' : ' off'}`}
                        title={l.lora_rel_path || l.display_name}>
                        {(l.display_name || l.lora_rel_path).replace(/\.safetensors$/, '')} · {l.strength}
                      </span>
                    ))}
                  </div>
                )}
                <button onClick={() => applyStyle(s)}>작업대에 적용</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lib-section">
        <div className="lib-header">
          <h3>로라 ({filteredLoras.length}/{loras.length})</h3>
          <input placeholder="검색 (이름/트리거/베이스)" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">모든 베이스</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as LoraSort)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /> ★만
          </label>
          <button onClick={rescan} title="로라 폴더 재스캔">스캔</button>
        </div>
        <div className="lora-grid">
          {filteredLoras.map((l) => (
            <div key={l.rel_path} className="lora-card">
              {l.thumb_url ? (
                <img src={l.thumb_url} alt={l.name} loading="lazy" />
              ) : (
                <div className="thumb-missing">{l.file_name}</div>
              )}
              <button className={`fav${l.favorite ? ' on' : ''}`}
                onClick={() => toggleFavorite(l.rel_path)}>★</button>
              <div className="card-overlay">
                <div className="card-name" title={l.rel_path}>{displayName(l)}</div>
                {l.base_model && <div className="card-sub" title={l.base_model}>{l.base_model}</div>}
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
          ))}
        </div>
      </section>

      {editing && (
        <LoraEditModal lora={editing}
          onSave={(fields) => saveLora(editing.rel_path, fields)}
          onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
