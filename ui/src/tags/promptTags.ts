// 콤마 구분 프롬프트. @triggers 토큰은 트리거워드 묶음이 삽입될 '자리'를 나타낸다.
// 토큰은 params.positive 안에 직접 들어가 있고(단일 진실), PromptEditor가 이를 인라인
// 칩으로 렌더한다. 텍스트(줄바꿈·공백 등 원본 포맷)는 그대로 보존한다.

export interface PromptTag {
  text: string // 트림된 태그 텍스트
  start: number // 원본 문자열에서 트림된 태그가 시작하는 offset
}

const cleanup = (s: string) =>
  s.replace(/,\s*,/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '')

const TOKEN_RE = /@triggers/i

/** 콤마로 구분된 태그를 원본 offset을 보존하며 추출(빈 태그 제외). */
export function splitTags(text: string): PromptTag[] {
  const out: PromptTag[] = []
  let i = 0
  for (const raw of text.split(',')) {
    const lead = raw.length - raw.trimStart().length
    const t = raw.trim()
    if (t) out.push({ text: t, start: i + lead })
    i += raw.length + 1 // +1 = 콤마
  }
  return out
}

/**
 * 실제 트리거워드가 박힌 평문 positive를 @triggers 토큰(칩) 형태로 되돌린다(불러오기·스타일 적용용).
 * 이미 토큰이 있으면 그대로. trig(합쳐진 트리거워드)가 본문에 있으면 그 자리를 @triggers로,
 * 없으면 끝에 추가.
 */
export function reTokenize(positive: string, trig: string): string {
  if (TOKEN_RE.test(positive)) return positive
  if (trig) {
    const i = positive.indexOf(trig)
    if (i >= 0) return positive.slice(0, i) + '@triggers' + positive.slice(i + trig.length)
  }
  const p = positive.replace(/[\s,]+$/, '')
  return p ? p + ', @triggers' : '@triggers'
}

/** 빌더용: positive 안의 @triggers 토큰을 실제 트리거워드 문자열로 치환(없으면 끝에 추가). */
export function insertTriggers(text: string, triggers: string): string {
  if (TOKEN_RE.test(text)) return cleanup(text.replace(TOKEN_RE, triggers || ''))
  if (!triggers) return cleanup(text)
  return cleanup(text ? text + ', ' + triggers : triggers)
}

const NONWS = /[^\s,]/ // 단어성 문자(공백·콤마 아님)

/**
 * 드롭 지점(문자 offset k)을 안전한 경계로 스냅한다. 단어 중간이면 가까운 공백/콤마/개행/끝으로
 * 옮겨 단어를 쪼개지 않게 하되, 빈 줄·개행 위치는 그대로 허용(거기에 칩을 놓을 수 있게).
 * 드롭 마커와 실제 삽입(placeTokenAt)이 같은 위치를 쓰도록 공유.
 */
export function snapTokenOffset(plain: string, k: number): number {
  k = Math.max(0, Math.min(k, plain.length))
  if (k > 0 && k < plain.length && NONWS.test(plain[k - 1]) && NONWS.test(plain[k])) {
    let f = k; while (f < plain.length && NONWS.test(plain[f])) f++
    let b = k; while (b > 0 && NONWS.test(plain[b - 1])) b--
    k = f - k <= k - b ? f : b
  }
  return k
}

/**
 * 에디터 드롭용: 토큰 없는 plain 텍스트의 드롭 지점(문자 offset k)에 @triggers 토큰을 끼운다.
 * 같은 줄(개행 전후 제외)에 실제 태그가 있을 때만 ', ' 구분자를 붙이므로, 빈 줄에 놓으면 그 줄에
 * 단독으로 들어간다. 항상 토큰 한 개를 가진 정리된 문자열을 반환.
 */
export function placeTokenAt(plain: string, k: number): string {
  if (!plain.trim()) return '@triggers'
  k = snapTokenOffset(plain, k)
  const before = plain.slice(0, k)
  const after = plain.slice(k)
  const lineBefore = before.slice(before.lastIndexOf('\n') + 1) // 현재 줄에서 앞부분
  const nl = after.indexOf('\n')
  const lineAfter = nl < 0 ? after : after.slice(0, nl) // 현재 줄에서 뒷부분
  // 같은 줄에 태그가 있을 때만 ', ' 구분자. 단 이미 콤마가 인접하면 중복 안 붙임.
  const left = NONWS.test(lineBefore) && !before.replace(/\s+$/, '').endsWith(',') ? ', ' : ''
  const right = NONWS.test(lineAfter) && !after.replace(/^\s+/, '').startsWith(',') ? ', ' : ''
  return cleanup(before + left + '@triggers' + right + after)
}
