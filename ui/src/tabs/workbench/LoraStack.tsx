import { useWorkbench } from '../../stores/workbench'
import type { LoraEntry } from '../../workflow/types'

export function LoraStack({ available }: { available: string[] }) {
  const loras = useWorkbench((s) => s.params.loras)
  const setLoras = useWorkbench((s) => s.setLoras)

  const update = (i: number, patch: Partial<LoraEntry>) =>
    setLoras(loras.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const remove = (i: number) => setLoras(loras.filter((_, j) => j !== i))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= loras.length) return
    const next = [...loras]
    ;[next[i], next[j]] = [next[j], next[i]]
    setLoras(next)
  }
  const add = () =>
    setLoras([...loras, { relPath: available[0] ?? '', strength: 0.8, enabled: true }])

  return (
    <div className="lora-stack">
      <div className="field-label">로라 ({loras.filter((l) => l.enabled).length}/{loras.length})</div>
      {loras.map((l, i) => (
        <div key={i} className={`lora-row${l.enabled ? '' : ' disabled'}`}>
          <input
            type="checkbox"
            checked={l.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            title="활성화"
          />
          <select value={l.relPath} onChange={(e) => update(i, { relPath: e.target.value })}>
            {!available.includes(l.relPath) && l.relPath && <option value={l.relPath}>{l.relPath}</option>}
            {available.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <input
            type="number"
            value={l.strength}
            step={0.05}
            min={-2}
            max={2}
            onChange={(e) => update(i, { strength: Number(e.target.value) })}
            title="강도"
          />
          <button onClick={() => move(i, -1)} disabled={i === 0} title="위로">↑</button>
          <button onClick={() => move(i, 1)} disabled={i === loras.length - 1} title="아래로">↓</button>
          <button onClick={() => remove(i)} title="제거">✕</button>
        </div>
      ))}
      <button className="add-lora" onClick={add}>+ 로라 추가</button>
    </div>
  )
}
