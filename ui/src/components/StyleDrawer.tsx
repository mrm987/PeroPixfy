import { useEffect, useState } from 'react'
import { styleImageUrl } from '../api/library'
import { useLibrary } from '../stores/library'

/**
 * Slide-over style browser for the Workbench/Batch tabs — pick a style and
 * apply it onto the current settings without leaving the tab. Stays open so
 * styles can be compared back-to-back.
 */
export function StyleDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { styles, loaded, load, applyStyle, nsfwBlur } = useLibrary()
  const [query, setQuery] = useState('')
  const [appliedId, setAppliedId] = useState<number | null>(null)

  useEffect(() => {
    if (open && !loaded) load()
  }, [open, loaded, load])

  if (!open) return null

  const q = query.toLowerCase()
  const filtered = styles.filter(
    (s) => !q || [s.name, s.tags, s.checkpoint].some((f) => f?.toLowerCase().includes(q)),
  )

  const apply = (id: number) => {
    const style = styles.find((s) => s.id === id)
    if (!style) return
    applyStyle(style)
    setAppliedId(id)
    setTimeout(() => setAppliedId(null), 1400)
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="style-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h3>Styles</h3>
          <input placeholder="Search styles" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button onClick={onClose} title="Close">✕</button>
        </div>
        <div className="drawer-list">
          {filtered.length === 0 && <div className="placeholder">No styles found</div>}
          {filtered.map((s) => (
            <div key={s.id} className="drawer-card">
              <div className={`thumb-wrap${nsfwBlur && s.nsfw ? ' blurred' : ''}`}>
                {s.image_file && !s.image_missing ? (
                  <img src={styleImageUrl(s.image_file)} alt={s.name} loading="lazy" />
                ) : (
                  <div className="thumb-missing">no image</div>
                )}
              </div>
              <div className="drawer-card-body">
                <div className="card-name" title={s.name}>{s.name || '(untitled)'}</div>
                {s.checkpoint && <div className="card-base" title={s.checkpoint}>{s.checkpoint}</div>}
                <div className="chips">
                  {(s.loras ?? []).slice(0, 3).map((l, i) => (
                    <span key={i} className={`chip${l.enabled ? '' : ' off'}`}
                      title={l.lora_rel_path || l.display_name}>
                      <span className="strength">{l.strength}</span>
                      {(l.display_name || l.lora_rel_path).replace(/\.safetensors$/, '')}
                    </span>
                  ))}
                  {(s.loras ?? []).length > 3 && (
                    <span className="chip toggle">+{(s.loras ?? []).length - 3}</span>
                  )}
                </div>
                <button className="apply" onClick={() => apply(s.id)}>
                  {appliedId === s.id ? '✓ Applied' : 'Apply to current'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
