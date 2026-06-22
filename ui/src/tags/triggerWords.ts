// 로라 active 토글 시 프롬프트의 트리거워드를 자동 삽입/삭제하는 유틸.
// 삽입 규칙: 마지막 '@'로 시작하는 태그 뒤에 추가, @태그가 없으면 맨 앞에.

export function parseTriggerWords(csv: string): string[] {
  return (csv || '').split(',').map((s) => s.trim()).filter(Boolean)
}

/** 트리거워드를 마지막 @태그 뒤(없으면 맨 앞)에 삽입. 이미 있는 건 건너뛴다. */
export function addTriggerWords(prompt: string, triggers: string[]): string {
  const existing = new Set(prompt.split(',').map((t) => t.trim().toLowerCase()))
  const toAdd = triggers.filter((t) => !existing.has(t.toLowerCase()))
  if (toAdd.length === 0) return prompt
  const seg = toAdd.join(', ')

  const tokens = prompt.split(',')
  let lastAt = -1
  tokens.forEach((t, i) => { if (t.trim().startsWith('@')) lastAt = i })

  if (lastAt === -1) {
    // @태그가 없으면 맨 위에 추가 (원문은 그대로 보존).
    return prompt.trim() ? `${seg}, ${prompt}` : seg
  }
  // 마지막 @태그의 '내용 끝'(뒤 공백/개행 직전) 위치를 원문에서 계산해, 그 자리에만
  // ", seg"를 끼워 넣는다. 뒤따르는 공백·개행·다른 태그는 절대 건드리지 않는다.
  // (split(',')의 토큰은 원본 공백을 유지하므로 beforeStr 길이가 곧 원문 오프셋.)
  const beforeStr = tokens.slice(0, lastAt + 1).join(',')
  const trailingWs = tokens[lastAt].length - tokens[lastAt].replace(/\s+$/, '').length
  const insertAt = beforeStr.length - trailingWs
  return prompt.slice(0, insertAt) + `, ${seg}` + prompt.slice(insertAt)
}

/** 트리거워드와 일치하는 태그 토큰들을 제거. */
export function removeTriggerWords(prompt: string, triggers: string[]): string {
  const set = new Set(triggers.map((t) => t.toLowerCase()))
  const kept = prompt.split(',').filter((t) => !set.has(t.trim().toLowerCase()))
  return kept.join(',').replace(/,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '')
}
