import type { LoraRecord } from '../api/library'
import type { LoraEntry } from '../workflow/types'

// 활성 로라의 트리거워드 수집 — TriggerBadges(표시·토글)와 스타일 적용(칩 위치 복원)이
// 동일한 dedup·순서·on/off 규칙을 쓰도록 공유한다.

export const normPath = (s: string) => s.replace(/\\/g, '/').toLowerCase()
export const splitCsv = (csv: string) => (csv || '').split(',').map((s) => s.trim()).filter(Boolean)

export interface CollectedTriggers {
  recByPath: Map<string, LoraRecord>
  info: Map<string, { display: string; on: boolean }> // key=소문자 단어
  ordered: string[] // 순서 적용된 key 목록 (order 우선 + 첫등장 순)
}

/** enabled 로라들의 트리거워드를 중복 제거(공유=1개)하고 order로 정렬해 모은다. */
export function collectTriggers(loras: LoraEntry[], libLoras: LoraRecord[], order: string[]): CollectedTriggers {
  const recByPath = new Map(libLoras.map((l) => [normPath(l.rel_path), l]))
  const info = new Map<string, { display: string; on: boolean }>()
  for (const le of loras) {
    if (!le.enabled) continue
    const rec = recByPath.get(normPath(le.relPath))
    if (!rec) continue
    const off = new Set(splitCsv(rec.disabled_triggers).map((w) => w.toLowerCase()))
    for (const w of splitCsv(rec.trigger_words)) {
      const k = w.toLowerCase()
      const onHere = !off.has(k)
      const cur = info.get(k)
      if (!cur) info.set(k, { display: w, on: onHere })
      else if (onHere) cur.on = true
    }
  }
  const present = [...info.keys()]
  const ordered = [...order.filter((k) => info.has(k)), ...present.filter((k) => !order.includes(k))]
  return { recByPath, info, ordered }
}

/** on 상태인 트리거워드만 표시 문자열(원문)로, 순서대로 반환. */
export const activeTriggerWords = (c: CollectedTriggers): string[] =>
  c.ordered.filter((k) => c.info.get(k)!.on).map((k) => c.info.get(k)!.display)
