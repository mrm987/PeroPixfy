import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { useLibrary } from '../../stores/library'
import { useWorkbench } from '../../stores/workbench'
import { activeTriggerWords, collectTriggers, normPath, splitCsv } from '../../tags/triggers'

/**
 * 활성 로라들의 트리거워드를 뱃지로 보여주고(중복 제거), 클릭으로 on/off(로라 정보에 영구
 * 저장), 드래그로 순서 변경한다. on인 단어들을 순서대로 params.triggers에 동기화 →
 * 빌더가 positive의 @triggers 위치에 삽입한다. 포지티브 프롬프트와 완전히 분리.
 */
export function TriggerBadges() {
  const t = useT()
  const loras = useWorkbench((s) => s.params.loras)
  const order = useWorkbench((s) => s.triggerOrder)
  const setOrder = useWorkbench((s) => s.setTriggerOrder)
  const setParams = useWorkbench((s) => s.set)
  const libLoras = useLibrary((s) => s.loras)
  const toggleDisabled = useLibrary((s) => s.toggleTriggerDisabled)
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  // 활성 로라들의 트리거워드 수집(중복 제거·순서) — 스타일 적용과 동일 로직 공유.
  const { recByPath, info, ordered } = collectTriggers(loras, libLoras, order)
  const onWords = activeTriggerWords({ recByPath, info, ordered })
  const orderedKey = ordered.join('|')
  const onKey = onWords.join('|')

  // params.triggers(빌더용) 동기화 + order에서 사라진/새 단어 반영.
  useEffect(() => {
    setParams({ triggers: onWords })
    if (orderedKey !== order.join('|')) setOrder(ordered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKey, onKey])

  if (ordered.length === 0) return null

  // 중복 제거된 단어 토글 → 그 단어를 제공하는 모든 활성 로라에 저장(중복모델 전체 적용).
  const toggle = (key: string, turnOff: boolean) => {
    for (const le of loras) {
      if (!le.enabled) continue
      const rec = recByPath.get(normPath(le.relPath))
      if (!rec || !splitCsv(rec.trigger_words).some((w) => w.toLowerCase() === key)) continue
      toggleDisabled(rec.rel_path, key, turnOff)
    }
  }
  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = [...ordered]
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    setOrder(next)
  }

  return (
    <div className="trigger-badges">
      <div className="trig-row">
        {ordered.map((key, i) => {
          const it = info.get(key)!
          return (
            <span key={key} draggable
              className={`trig-badge${it.on ? '' : ' off'}${over === i && drag !== null && drag !== i ? ' over' : ''}`}
              title={it.on ? t('Click to turn off (saved to the LoRA)') : t('Click to turn on')}
              onClick={() => toggle(key, it.on)}
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(i) } }}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) reorder(drag, i); setDrag(null); setOver(null) }}
              onDragEnd={() => { setDrag(null); setOver(null) }}>
              {it.display}
            </span>
          )
        })}
      </div>
    </div>
  )
}
