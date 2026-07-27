// 와일드카드 — 프롬프트의 #이름 토큰을 미리 정의한 풀에서 랜덤 추출해 치환(PeroPix 이식).
// 정의 문서 형식: `#이름` 줄이 섹션 헤더, 그 아래 한 줄 = 한 후보, `//` = 주석.
// 해석은 생성(제출) 직전에 하므로 에디터·프리셋에는 항상 #이름 원문이 남는다.

import type { TagEntry } from './tagData'

const BASE = '/peropixfy/api/wildcards'

// { 이름(소문자): [후보, ...] } — loadWildcards/saveWildcards가 갱신하는 모듈 캐시.
let pools: Record<string, string[]> = {}

/** 정의 문서 → 풀 맵. 헤더 없는 본문 줄은 무시. */
export function parseWildcardDoc(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!text) return out
  let current: string | null = null
  for (const rawLine of text.split('\n')) {
    // 주석 제거: 줄 시작 // 또는 공백 뒤 // (http:// 처럼 붙은 건 보존)
    const line = rawLine.replace(/\r$/, '').replace(/(^|\s)\/\/.*$/, '$1')
    const trimmed = line.trim()
    if (!trimmed) continue
    const header = trimmed.match(/^#([A-Za-z0-9_]+)$/) // 단독 #이름 → 섹션 헤더
    if (header) {
      current = header[1].toLowerCase()
      out[current] ||= []
      continue
    }
    if (current) {
      const cand = trimmed.replace(/[\s,]+$/, '') // 후보 끝 공백·쉼표 정리
      if (cand) out[current].push(cand)
    }
  }
  return out
}

/**
 * 텍스트의 #이름 토큰을 풀에서 랜덤 추출한 후보로 치환(재귀 — 후보 안의 #이름도 해석).
 * 미정의 이름은 원문 유지. depth 상한으로 순환 정의를 방어한다.
 */
export function resolveWildcards(text: string, depth = 0): string {
  if (!text || depth > 20) return text
  // (?<![A-Za-z0-9_]) : source#tag 처럼 단어에 붙은 #은 건드리지 않는다
  return text.replace(/(?<![A-Za-z0-9_])#([A-Za-z0-9_]+)/g, (m, name: string) => {
    const pool = pools[name.toLowerCase()]
    if (!pool || pool.length === 0) return m
    const pick = pool[Math.floor(Math.random() * pool.length)]
    return resolveWildcards(pick, depth + 1)
  })
}

/** 텍스트에 정의된 풀을 가리키는 #이름 토큰이 있는가 (히스토리 템플릿 보존 판단용). */
export function hasWildcards(text: string): boolean {
  if (!text || !text.includes('#')) return false
  for (const m of text.matchAll(/(?<![A-Za-z0-9_])#([A-Za-z0-9_]+)/g)) {
    if (pools[m[1].toLowerCase()]?.length) return true
  }
  return false
}

/** 자동완성용: prefix로 시작하는 풀 이름들을 TagEntry 형태로. prefix 비면 전체. */
export function searchWildcardEntries(prefix: string): TagEntry[] {
  const q = prefix.toLowerCase()
  return Object.keys(pools)
    .filter((n) => n.startsWith(q))
    .sort()
    .map((n) => ({ label: n, value: n, count: pools[n].length, type: 'wildcard', category: -1 }))
}

/** 정의 문서 로드(앱 시작 시 1회) — 캐시 갱신 후 원문을 반환(편집 모달용). */
export async function loadWildcards(): Promise<string> {
  const res = await fetch(BASE)
  const content: string = (await res.json()).content ?? ''
  pools = parseWildcardDoc(content)
  return content
}

/** 정의 문서 저장 + 캐시 갱신. */
export async function saveWildcards(content: string): Promise<void> {
  await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  pools = parseWildcardDoc(content)
}
