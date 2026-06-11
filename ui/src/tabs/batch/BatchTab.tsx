import { useState } from 'react'
import { NumberField } from '../../components/controls'
import { StyleDrawer } from '../../components/StyleDrawer'
import { useBatch } from '../../stores/batch'

export function BatchTab() {
  const {
    variations, count, slots, running, confirmed,
    setCount, addVariation, updateVariation, removeVariation,
    start, stop, confirmSlot,
  } = useBatch()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const total = slots.length
  const done = slots.filter((s) => s.status === 'done').length
  const confirmedCount = Object.keys(confirmed).length

  return (
    <div className="batch">
      <div className="batch-panel">
        <div className="preset-row">
          <button className="styles-open" onClick={() => setDrawerOpen(true)}
            title="Browse styles and apply to the base settings">▤ Styles</button>
        </div>
        <div className="field-label">Variations (workbench settings + extra prompt)</div>
        {variations.map((v) => (
          <div key={v.id} className="variation-row">
            <input className="var-label" value={v.label}
              onChange={(e) => updateVariation(v.id, { label: e.target.value })} />
            <textarea rows={2} value={v.prompt} placeholder="Extra prompt (e.g. standing, smile)"
              onChange={(e) => updateVariation(v.id, { prompt: e.target.value })} />
            <button onClick={() => removeVariation(v.id)} disabled={running}>✕</button>
          </div>
        ))}
        <button onClick={addVariation} disabled={running}>+ Add variation</button>

        <NumberField label="Images per variation" value={count} min={1} max={64}
          onChange={setCount} />

        {running ? (
          <button className="generate stop" onClick={stop}>Stop</button>
        ) : (
          <button className="generate" onClick={start}>
            Generate all ({variations.length} × {count} = {variations.length * count})
          </button>
        )}
        {total > 0 && (
          <div className="batch-progress">
            Generated {done}/{total} · Confirmed {confirmedCount}/{variations.length}
          </div>
        )}
      </div>

      <div className="batch-grid">
        {variations.map((v) => {
          const rowSlots = slots.filter((s) => s.variationId === v.id)
          if (rowSlots.length === 0) return null
          return (
            <div key={v.id} className="batch-row">
              <div className="batch-row-header">
                {v.label}
                {confirmed[v.id] && <span className="confirmed-mark"> ✓ confirmed</span>}
              </div>
              <div className="batch-slots">
                {rowSlots.map((s) => (
                  <button key={s.id}
                    className={`batch-slot ${s.status}${confirmed[v.id] === s.id ? ' confirmed' : ''}`}
                    onClick={() => confirmSlot(s)}
                    title={s.seed != null ? `seed ${s.seed} — click to confirm` : ''}>
                    {s.status === 'done' && s.imageUrls[0] ? (
                      <img src={s.imageUrls[0]} alt="" loading="lazy" />
                    ) : (
                      <span className="slot-state">
                        {s.status === 'idle' ? 'waiting' : s.status === 'queued' ? 'generating…' : '✕'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {slots.length === 0 && (
          <div className="placeholder" style={{ padding: 40 }}>
            Set up your style and parameters in the Workbench, define variations here,
            then hit Generate all.
          </div>
        )}
      </div>

      <StyleDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
