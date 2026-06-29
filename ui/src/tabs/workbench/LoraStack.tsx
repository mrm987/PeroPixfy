import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { useLibrary } from '../../stores/library'
import { useWorkbench } from '../../stores/workbench'
import type { LoraEntry } from '../../workflow/types'
import { LoraPicker } from './LoraPicker'

interface Props {
  available: string[]
  loras: LoraEntry[]
  setLoras: (loras: LoraEntry[]) => void
}

export function LoraStack({ available, loras, setLoras }: Props) {
  const t = useT()
  const flashLora = useWorkbench((s) => s.flashLora)
  const setFlashLora = useWorkbench((s) => s.setFlashLora)
  const libLoaded = useLibrary((s) => s.loaded)
  const libLoad = useLibrary((s) => s.load)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // 라이브러리에서 ＋Stack으로 추가하면 해당 행을 잠깐 강조한 뒤 해제한다.
  useEffect(() => {
    if (!flashLora) return
    const t = setTimeout(() => setFlashLora(null), 1400)
    return () => clearTimeout(t)
  }, [flashLora, setFlashLora])

  // 로라 썸네일(LoraPicker 호버 프리뷰)용 라이브러리 데이터 1회 로드.
  useEffect(() => {
    if (!libLoaded) libLoad()
  }, [libLoaded, libLoad])

  const update = (i: number, patch: Partial<LoraEntry>) =>
    setLoras(loras.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  // 트리거워드는 더 이상 프롬프트에 직접 삽입하지 않는다 — 스택 하단의 TriggerBadges에서
  // 따로 관리하고, 빌더가 positive의 @triggers 위치에 넣는다.
  const toggleEnabled = (i: number, enabled: boolean) => update(i, { enabled })
  const remove = (i: number) => setLoras(loras.filter((_, j) => j !== i))
  // 드래그한 행(from)을 드롭한 행(to) 위치로 옮긴다.
  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = [...loras]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setLoras(next)
  }
  const add = () =>
    setLoras([...loras, { relPath: available[0] ?? '', strength: 0.8, enabled: false }])

  return (
    <div className="lora-stack">
      <div className="field-label">{t('LoRAs ({n}/{m})', { n: loras.filter((l) => l.enabled).length, m: loras.length })}</div>
      {loras.map((l, i) => (
        <div key={i}
          className={`lora-row${l.enabled ? '' : ' disabled'}${l.relPath === flashLora ? ' flash' : ''}${available.length > 0 && l.relPath && !available.includes(l.relPath) ? ' missing' : ''}${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== null && dragIndex !== i ? ' drag-over' : ''}`}
          onDragOver={(e) => { if (dragIndex !== null) { e.preventDefault(); setOverIndex(i) } }}
          onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) reorder(dragIndex, i); setDragIndex(null); setOverIndex(null) }}>
          <span className="lora-drag" draggable title={t('Drag to reorder')}
            onDragStart={(e) => {
              setDragIndex(i)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(i))
              const row = (e.currentTarget as HTMLElement).parentElement
              if (row) e.dataTransfer.setDragImage(row, 20, 16)
            }}
            onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}>⠿</span>
          <input
            type="checkbox"
            checked={l.enabled}
            onChange={(e) => toggleEnabled(i, e.target.checked)}
            title={t('Enable')}
          />
          <LoraPicker value={l.relPath} options={available}
            missing={available.length > 0 && !!l.relPath && !available.includes(l.relPath)}
            onChange={(v) => update(i, { relPath: v })} />
          <input
            type="number"
            value={l.strength}
            step={0.05}
            min={-2}
            max={2}
            onChange={(e) => update(i, { strength: Number(e.target.value) })}
            title={t('Strength')}
          />
          <button onClick={() => remove(i)} title={t('Remove')}>✕</button>
        </div>
      ))}
      <button className="add-lora" onClick={add}>{t('+ Add LoRA')}</button>
    </div>
  )
}
