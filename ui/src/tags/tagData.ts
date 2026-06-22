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

/** 태그 목록 1회 로드 + 첫 글자 인덱싱. 실패해도 조용히 비활성(자동완성만 미동작). */
export function loadTags(): Promise<void> {
  if (loaded) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    const res = await fetch('/peropixfy/tags.json')
    if (!res.ok) return
    const tags = (await res.json()) as TagEntry[]
    const index: Record<string, TagEntry[]> = {}
    for (const t of tags) {
      t._lower = t.label.toLowerCase()
      const c = t._lower[0]
      ;(index[c] ||= []).push(t)
    }
    ALL_TAGS = tags
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
