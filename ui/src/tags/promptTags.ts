import { splitWeightTags, type TagSpan } from './tagWeight'

// 콤마 구분 프롬프트. @triggers 토큰은 트리거워드 묶음이 삽입될 '자리'를 나타낸다.
// 토큰은 params.positive 안에 직접 들어가 있고(단일 진실), PromptEditor가 이를 인라인
// 칩으로 렌더한다. 텍스트(줄바꿈·공백 등 원본 포맷)는 그대로 보존한다.

const cleanup = (s: string) =>
  s.replace(/,\s*,/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '')

const TOKEN_RE = /@triggers/i

/**
 * isMatch를 만족하는 태그만 연속으로 이어진 구간 중 가장 긴 것을 찾는다(없으면 null).
 * 스타일 적용에서 '트리거워드 묶음이 박혀 있던 칩 자리'를 찾는 용도 — 단어 순서·구분자 표기에
 * 의존하지 않으므로, 저장 당시의 트리거 순서를 몰라도 자리를 복원할 수 있다.
 * ★ 최상위 콤마에서만 자른다(splitWeightTags). 트리거워드가 (a, b:1.2) 묶음이면 콤마 분할로는
 * 어느 조각도 트리거워드와 일치하지 않아 자리를 놓치고, 프롬프트에 묶음이 남은 채 칩이 끝에
 * 붙어 트리거워드가 두 번 들어간다.
 */
/**
 * 콤마 태그를 줄 단위로 한 번 더 쪼갠다. splitWeightTags는 최상위 콤마에서만 자르므로,
 * 트리거워드 묶음이 콤마 없이 줄바꿈으로 끝나면 — 앱이 저장하는 `..., @saiougaushi\n\n1girl, ...`
 * 형태가 바로 그렇다 — 마지막 트리거가 다음 블록과 한 덩어리(`@saiougaushi\n\n1girl`)로 잡혀
 * 매칭에 실패한다.
 * ★실측(2026-08-20): 그 탓에 연속 구간이 하나 짧게 끊겼고, 짧아진 자리에 트리거워드 전체가
 * 삽입되면서 본문에 남은 마지막 트리거가 두 번 들어갔다.
 * 괄호 묶음((a,\nb:1.2))은 쪼개지 않는다 — 콤마 분할이 통째로 지키는 단위다.
 */
function splitLines(tags: TagSpan[]): TagSpan[] {
  const out: TagSpan[] = []
  for (const t of tags) {
    if (!t.text.includes('\n') || /[([{]/.test(t.text)) { out.push(t); continue }
    let off = 0
    for (const piece of t.text.split('\n')) {
      const lead = piece.length - piece.trimStart().length
      const s = piece.trim()
      if (s) out.push({ text: s, start: t.start + off + lead, end: t.start + off + lead + s.length })
      off += piece.length + 1
    }
  }
  return out
}

/** 콤마·줄바꿈 기준 태그 조각 — findTagRun 과 같은 규칙으로 자른다. */
export function tagSpans(text: string): TagSpan[] {
  return splitLines(splitWeightTags(text))
}

export function findTagRun(text: string, isMatch: (tag: string) => boolean) {
  const tags = splitLines(splitWeightTags(text))
  let best: { i: number; j: number } | null = null
  for (let i = 0; i < tags.length; i++) {
    if (!isMatch(tags[i].text)) continue
    let j = i
    while (j + 1 < tags.length && isMatch(tags[j + 1].text)) j++
    if (!best || j - i > best.j - best.i) best = { i, j }
    i = j
  }
  if (!best) return null
  const last = tags[best.j]
  return {
    words: tags.slice(best.i, best.j + 1).map((t) => t.text),
    start: tags[best.i].start,
    end: last.start + last.text.length,
  }
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
 * 에디터 드롭용: 해당 토큰이 없는 plain 텍스트의 드롭 지점(문자 offset k)에 token을 끼운다.
 * 같은 줄(개행 전후 제외)에 실제 태그가 있을 때만 ', ' 구분자를 붙이므로, 빈 줄에 놓으면 그 줄에
 * 단독으로 들어간다. 항상 그 토큰 한 개를 가진 정리된 문자열을 반환. (기본 토큰 = @triggers)
 */
export function placeTokenAt(plain: string, k: number, token = '@triggers'): string {
  if (!plain.trim()) return token
  k = snapTokenOffset(plain, k)
  const before = plain.slice(0, k)
  const after = plain.slice(k)
  const lineBefore = before.slice(before.lastIndexOf('\n') + 1) // 현재 줄에서 앞부분
  const nl = after.indexOf('\n')
  const lineAfter = nl < 0 ? after : after.slice(0, nl) // 현재 줄에서 뒷부분
  // 같은 줄에 태그가 있을 때만 ', ' 구분자. 단 이미 콤마가 인접하면 중복 안 붙임.
  const left = NONWS.test(lineBefore) && !before.replace(/\s+$/, '').endsWith(',') ? ', ' : ''
  const right = NONWS.test(lineAfter) && !after.replace(/^\s+/, '').startsWith(',') ? ', ' : ''
  return cleanup(before + left + token + right + after)
}
