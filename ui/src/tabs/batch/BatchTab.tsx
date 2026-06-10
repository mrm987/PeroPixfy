import { NumberField } from '../../components/controls'
import { useBatch } from '../../stores/batch'

export function BatchTab() {
  const {
    variations, count, slots, running, confirmed,
    setCount, addVariation, updateVariation, removeVariation,
    start, stop, confirmSlot,
  } = useBatch()

  const total = slots.length
  const done = slots.filter((s) => s.status === 'done').length
  const confirmedCount = Object.keys(confirmed).length

  return (
    <div className="batch">
      <div className="batch-panel">
        <div className="field-label">변형 목록 (현재 작업대 설정 + 변형 프롬프트)</div>
        {variations.map((v) => (
          <div key={v.id} className="variation-row">
            <input className="var-label" value={v.label}
              onChange={(e) => updateVariation(v.id, { label: e.target.value })} />
            <textarea rows={2} value={v.prompt} placeholder="추가 프롬프트 (예: standing, smile)"
              onChange={(e) => updateVariation(v.id, { prompt: e.target.value })} />
            <button onClick={() => removeVariation(v.id)} disabled={running}>✕</button>
          </div>
        ))}
        <button onClick={addVariation} disabled={running}>+ 변형 추가</button>

        <NumberField label="변형당 수량" value={count} min={1} max={64}
          onChange={setCount} />

        {running ? (
          <button className="generate stop" onClick={stop}>중단</button>
        ) : (
          <button className="generate" onClick={start}>
            전체 생성 ({variations.length} × {count} = {variations.length * count}장)
          </button>
        )}
        {total > 0 && (
          <div className="batch-progress">
            생성 {done}/{total} · 확정 {confirmedCount}/{variations.length}
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
                {confirmed[v.id] && <span className="confirmed-mark"> ✓ 확정됨</span>}
              </div>
              <div className="batch-slots">
                {rowSlots.map((s) => (
                  <button key={s.id}
                    className={`batch-slot ${s.status}${confirmed[v.id] === s.id ? ' confirmed' : ''}`}
                    onClick={() => confirmSlot(s)}
                    title={s.seed != null ? `seed ${s.seed} — 클릭해서 확정` : ''}>
                    {s.status === 'done' && s.imageUrls[0] ? (
                      <img src={s.imageUrls[0]} alt="" loading="lazy" />
                    ) : (
                      <span className="slot-state">
                        {s.status === 'idle' ? '대기' : s.status === 'queued' ? '생성 중…' : '✕'}
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
            작업대에서 스타일·파라미터를 설정한 뒤, 변형 목록을 만들고 전체 생성을 누르세요.
          </div>
        )}
      </div>
    </div>
  )
}
