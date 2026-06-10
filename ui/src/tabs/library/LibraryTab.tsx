import { useEffect, useMemo, useState } from 'react'
import { styleImageUrl } from '../../api/library'
import { useLibrary } from '../../stores/library'

export function LibraryTab() {
  const { loras, styles, loaded, load, toggleFavorite, rescan, applyStyle, addLoraToWorkbench } = useLibrary()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [favOnly, setFavOnly] = useState(false)

  useEffect(() => {
    if (!loaded) load()
  }, [loaded, load])

  const categories = useMemo(
    () => [...new Set(loras.map((l) => l.base_category).filter(Boolean))].sort(),
    [loras],
  )

  const filteredLoras = useMemo(() => {
    const q = query.toLowerCase()
    return loras.filter((l) => {
      if (favOnly && !l.favorite) return false
      if (category && l.base_category !== category) return false
      if (!q) return true
      return [l.name, l.rel_path, l.trigger_words, l.base_model]
        .some((f) => f?.toLowerCase().includes(q))
    })
  }, [loras, query, category, favOnly])

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
                <div className="card-name" title={l.rel_path}>{l.name || l.file_name}</div>
                {l.trigger_words && <div className="card-sub" title={l.trigger_words}>{l.trigger_words}</div>}
                <button onClick={() => addLoraToWorkbench(l.rel_path)}>+ 작업대 스택에 추가</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
