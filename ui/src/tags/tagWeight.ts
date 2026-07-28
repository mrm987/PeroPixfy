// 프롬프트 태그의 가중치 — (tag:1.2) 표기를 만들고 읽고 지운다.
//
// 텍스트만 다룬다. 앱은 프롬프트를 파싱하지 않고 ComfyUI에 그대로 넘기므로,
// 가중치는 순수하게 편집 문제다.
//
// ★ promptTags.ts의 splitTags와 나누는 기준이 다르다. 저쪽은 콤마만 보지만
// 여기는 괄호 깊이를 센다 — 여러 태그를 한 괄호로 묶으면 (a, b:1.2) 안에
// 콤마가 들어가고, 콤마로만 자르면 그 묶음을 다시 읽을 수 없기 때문이다.
// 트리거워드 자리 찾기 등 기존 용도는 저쪽을 그대로 쓴다.

export interface TagSpan {
  text: string
  start: number
  end: number
}

/** 괄호 밖(최상위)의 콤마에서만 자른다. 원본 offset을 보존한다. */
export function splitWeightTags(text: string): TagSpan[] {
  const out: TagSpan[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
    if (i === text.length || (c === ',' && depth === 0)) {
      const raw = text.slice(start, i)
      const lead = raw.length - raw.trimStart().length
      const t = raw.trim()
      if (t) out.push({ text: t, start: start + lead, end: start + lead + t.length })
      start = i + 1
    }
  }
  return out
}

/** 바깥 괄호 한 쌍이 문자열 전체를 감싸는가. "(a:1.2), b" 를 통째로 벗기지 않기 위한 검사. */
function wrapsWhole(s: string): boolean {
  if (!s.startsWith('(') || !s.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0) return i === s.length - 1
    }
  }
  return false
}

/**
 * (tag:1.2) → {name:'tag', weight:1.2} · ((tag)) → 한 겹당 1.1배(옛 강조 표기) ·
 * 그 외 → weight 1. name에는 콤마가 들어갈 수 있다(묶음).
 */
export function parseWeighted(s: string): { name: string; weight: number } {
  if (wrapsWhole(s)) {
    const body = s.slice(1, -1)
    // 마지막 최상위 ':' 뒤가 숫자면 가중치 표기다.
    let depth = 0
    let colon = -1
    for (let i = 0; i < body.length; i++) {
      const c = body[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === ':' && depth === 0) colon = i
    }
    if (colon >= 0) {
      const num = body.slice(colon + 1).trim()
      if (/^-?[0-9]*\.?[0-9]+$/.test(num)) {
        return { name: body.slice(0, colon).trim(), weight: parseFloat(num) }
      }
    }
    const inner = parseWeighted(body.trim())
    return { name: inner.name, weight: Math.round(inner.weight * 1.1 * 100) / 100 }
  }
  return { name: s, weight: 1 }
}

/** 1.10 → "1.1", 2.00 → "2". 손으로 적은 것과 같은 모양으로. */
const fmt = (w: number) => String(Math.round(w * 100) / 100)

/** 1.0이면 괄호를 지운다 — (tag:1)은 효과 없는 군더더기다. */
export function buildWeighted(name: string, weight: number): string {
  return Math.abs(weight - 1) < 1e-9 ? name : `(${name}:${fmt(weight)})`
}

/** 선택/커서 범위를 태그 경계까지 넓힌다. 걸친 태그가 여럿이면 그 전체가 한 덩어리다. */
export function snapToTags(text: string, from: number, to: number): { start: number; end: number } | null {
  const tags = splitWeightTags(text)
  const hit = tags.filter((t) => t.start <= to && t.end >= from)
  if (!hit.length) return null
  return { start: hit[0].start, end: hit[hit.length - 1].end }
}

export interface WeightEdit {
  text: string
  span: { start: number; end: number }
  newLen: number
}

/**
 * 범위를 통째로 읽어 가중치에 delta를 더한다. 단일 태그든 여러 태그 묶음이든 같은 경로다 —
 * 여러 개면 각각이 아니라 (a, b, c:1.05) 처럼 전체에 한 괄호를 씌운다.
 * ★ 상한·하한 없음. 극단값 시험을 앱이 막지 않는다.
 */
export function adjustWeight(text: string, from: number, to: number, delta: number): WeightEdit | null {
  const span = snapToTags(text, from, to)
  if (!span) return null
  const { name, weight } = parseWeighted(text.slice(span.start, span.end))
  const next = buildWeighted(name, Math.round((weight + delta) * 100) / 100)
  return { text: text.slice(0, span.start) + next + text.slice(span.end), span, newLen: next.length }
}

/** 가중치를 통째로 벗긴다(1.0으로). 묶음이면 바깥 괄호만 풀리고 안쪽 값은 남는다. */
export function clearWeight(text: string, from: number, to: number): WeightEdit | null {
  const span = snapToTags(text, from, to)
  if (!span) return null
  const body = text.slice(span.start, span.end)
  const { name, weight } = parseWeighted(body)
  if (Math.abs(weight - 1) < 1e-9) return null // 이미 가중치가 없다
  return { text: text.slice(0, span.start) + name + text.slice(span.end), span, newLen: name.length }
}

/** 텍스트가 span 구간에서 newLen으로 바뀌었을 때, offset 하나를 따라 옮긴다. */
export function shiftOffset(off: number, span: { start: number; end: number }, newLen: number): number {
  const diff = newLen - (span.end - span.start)
  if (off <= span.start) return off
  if (off >= span.end) return off + diff
  return span.start + newLen
}
