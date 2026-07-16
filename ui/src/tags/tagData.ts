// Danbooru 태그 자동완성 데이터 — PeroPix(D:\PeroPix)의 태그 추천 기능 이식.
// 7.8MB JSON을 한 번 로드해 첫 글자 인덱스를 만들고, startsWith→includes 2단계로 검색한다.

export interface TagEntry {
  label: string
  value: string
  count: number
  type: string // general | artist | character | copyright | meta
  category: number
  aliases?: string[]
  _lower?: string
}

let ALL_TAGS: TagEntry[] = []
let TAG_INDEX: Record<string, TagEntry[]> = {}
let loaded = false
let loading: Promise<void> | null = null

export const tagsLoaded = () => loaded

// Anima(및 애니 모델)에서 쓰는 등급/퀄리티/스코어/시기 태그 — Danbooru tags.json엔 대부분
// 없어(masterpiece·safe·score_N 등) 별도로 병합한다. 언더바 형식(tags.json과 동일), 삽입 시
// 언더바→공백 변환됨(단 score_N은 언더바 유지 — underscoresToSpaces 예외 처리).
const ANIMA_TAGS: TagEntry[] = [
  // 등급(rating)
  'safe', 'sensitive', 'questionable', 'explicit', 'general', 'nsfw', 'sfw',
  // 퀄리티
  'masterpiece', 'best_quality', 'high_quality', 'good_quality', 'normal_quality', 'low_quality', 'worst_quality',
  'very_aesthetic', 'aesthetic', 'absurdres', 'highres', 'lowres',
  // 스코어
  'score_9', 'score_8', 'score_7', 'score_6', 'score_5', 'score_4', 'score_3', 'score_2', 'score_1',
  // 시기
  'newest', 'recent', 'mid', 'early', 'oldest',
  'year_2025', 'year_2024', 'year_2023', 'year_2022', 'year_2021', 'year_2020',
].map((label) => ({ label, value: label, count: 8_000_000, type: 'meta', category: 5 }))

/** 태그 목록 1회 로드 + 첫 글자 인덱싱. tags.json이 없어도 Anima 등급 태그는 항상 제공. */
export function loadTags(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    let tags: TagEntry[] = []
    try {
      const res = await fetch('/peropixfy/tags.json')
      if (res.ok) tags = (await res.json()) as TagEntry[]
    } catch { /* tags.json이 없어도 아래 Anima 등급 태그는 병합해 제공 */ }
    const index: Record<string, TagEntry[]> = {}
    const seen = new Set<string>()
    for (const t of tags) {
      t._lower = t.label.toLowerCase()
      seen.add(t._lower)
      const c = t._lower[0]
      ;(index[c] ||= []).push(t)
    }
    // Anima 등급/퀄리티 태그를 각 버킷 '앞'에 병합해 우선 노출한다(tags.json에 이미 있는 건 건너뜀).
    const anima = ANIMA_TAGS.filter((t) => !seen.has(t.label.toLowerCase()))
    for (const t of anima) {
      t._lower = t.label.toLowerCase()
      const c = t._lower[0]
      ;(index[c] ||= []).unshift(t)
    }
    ALL_TAGS = [...anima, ...tags]
    TAG_INDEX = index
    loaded = true
  })().catch(() => {})
  return loading
}

/** 2단계 검색: 인덱스(startsWith) → 부족하면 전체(includes). */
export function searchTags(query: string, maxResults = 15): TagEntry[] {
  if (!query || query.length < 2) return []
  const q = query.toLowerCase()
  const results: TagEntry[] = []

  const bucket = TAG_INDEX[q[0]]
  if (bucket) {
    for (const t of bucket) {
      if (t._lower!.startsWith(q)) {
        results.push(t)
        if (results.length >= maxResults) return results
      }
    }
  }
  if (results.length < maxResults) {
    for (const t of ALL_TAGS) {
      if (results.includes(t)) continue
      if (t._lower!.includes(q)) {
        results.push(t)
        if (results.length >= maxResults) break
      }
    }
  }
  return results
}

export function formatCount(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M'
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K'
  return String(count)
}
