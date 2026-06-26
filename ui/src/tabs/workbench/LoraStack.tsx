import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { useLibrary } from '../../stores/library'
import { useWorkbench } from '../../stores/workbench'
import type { LoraEntry } from '../../workflow/types'
import { addTriggerWords, parseTriggerWords, removeTriggerWords } from '../../tags/triggerWords'
import { LoraPicker } from './LoraPicker'

const normPath = (s: string) => s.replace(/\\/g, '/').toLowerCase()

interface Props {
  available: string[]
  loras: LoraEntry[]
  setLoras: (loras: LoraEntry[]) => void
  positive: string
  setPositive: (positive: string) => void
}

export function LoraStack({ available, loras, setLoras, positive, setPositive }: Props) {
  const t = useT()
  const flashLora = useWorkbench((s) => s.flashLora)
  const setFlashLora = useWorkbench((s) => s.setFlashLora)
  const autoTriggers = useWorkbench((s) => s.autoTriggers)
  const setAutoTriggers = useWorkbench((s) => s.setAutoTriggers)
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

  // 로라의 트리거워드를 프롬프트에 삽입(add)하거나 삭제한다. 라이브러리에 등록된
  // trigger_words 기준. 구독 추가 없이 호출 시점에 getState로 읽는다.
  const applyTriggers = async (relPath: string, add: boolean) => {
    if (!autoTriggers) return // 자동 트리거워드 off면 추가·제거 모두 하지 않음
    const findRec = (rp: string) =>
      useLibrary.getState().loras.find((l) => normPath(l.rel_path) === normPath(rp))
    let rec = findRec(relPath)
    // 스캔 직후 등 useLibrary 캐시가 아직 없거나 비어 있으면 한 번 새로 불러와 재시도한다
    // — 새로 추가/스캔한 로라의 트리거워드가 '새로고침해야만' 등록되던 문제 방지.
    if (!rec || !rec.trigger_words) {
      await useLibrary.getState().load()
      rec = findRec(relPath)
    }
    const triggers = parseTriggerWords(rec?.trigger_words || '')
    if (triggers.length === 0) return
    if (add) {
      setPositive(addTriggerWords(positive, triggers))
      return
    }
    // 끄는 경우: 같은 트리거워드를 쓰는 다른 active 로라가 남아 있으면 유지한다(전부 꺼야 제거).
    const stillUsed = new Set(
      useWorkbench.getState().params.loras
        .filter((l) => l.enabled && normPath(l.relPath) !== normPath(relPath))
        .flatMap((l) => parseTriggerWords(findRec(l.relPath)?.trigger_words || '').map((w) => w.toLowerCase())),
    )
    const toRemove = triggers.filter((w) => !stillUsed.has(w.toLowerCase()))
    if (toRemove.length) setPositive(removeTriggerWords(positive, toRemove))
  }

  // active 토글 시 해당 로라의 트리거워드를 자동 삽입/삭제한다.
  const toggleEnabled = (i: number, enabled: boolean) => {
    update(i, { enabled })
    applyTriggers(loras[i].relPath, enabled)
  }
  const remove = (i: number) => {
    const removed = loras[i]
    setLoras(loras.filter((_, j) => j !== i))
    // active였던 로라를 빼면 그 트리거워드도 프롬프트에서 제거한다.
    if (removed.enabled) applyTriggers(removed.relPath, false)
  }
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
      <div className="lora-stack-head">
        <span className="field-label">{t('LoRAs ({n}/{m})', { n: loras.filter((l) => l.enabled).length, m: loras.length })}</span>
        <label className="auto-trig" title={t('Auto-add/remove a LoRA’s trigger words to the prompt when toggling it on/off')}>
          <input type="checkbox" checked={autoTriggers} onChange={(e) => setAutoTriggers(e.target.checked)} />
          {t('Auto trigger words')}
        </label>
      </div>
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
