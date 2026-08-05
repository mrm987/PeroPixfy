import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCount, loadTags, searchTags, tagsLoaded, type TagEntry } from './tagData'
import { adjustWeight, clearWeight, shiftOffset, type WeightEdit } from './tagWeight'
import { searchWildcardEntries } from './wildcards'

const WEIGHT_STEP = 0.05
const SCRUB_PX = 4 // 이만큼 끌 때마다 한 단계

export const CATEGORY_LABEL: Record<string, string> = {
  general: 'general', artist: 'artist', character: 'character', copyright: 'copyright', meta: 'meta',
  wildcard: 'wildcard',
}

// 삽입 시 언더바를 띄어쓰기로 변환. 단 ^_^ / >_< 같은 이모티콘의 _, 그리고 score_9 등
// 스코어 태그의 _는 보존한다(모델이 언더바 형태를 요구).
export const underscoresToSpaces = (tag: string) => {
  if (/^score_\d/i.test(tag)) return tag
  return tag.replace(/_/g, (_m, i: number, s: string) => {
    const before = s[i - 1]
    const after = s[i + 1]
    if (before === '^' || after === '^' || (before && after && /[><;:=]/.test(before + after))) return '_'
    return ' '
  })
}

// 커서 위치의 '현재 단어'를 구한다. 콤마/개행/괄호/콜론이 단어 경계.
// 검색은 커서 앞부분만 쓰고, 교체 범위는 단어 뒤 공백까지 흡수한다.
export function getCurrentWord(value: string, cursorPos: number) {
  // 어퍼스트로피(')도 태그 문자 — another's, girls' 등(단부루 태그 911개)이 끊기지 않게.
  // 유니코드 글자/숫자까지 단어로 본다 — #머리색 같은 한글 와일드카드 이름에서 단어 스캔이
  // 끊기면 '#' 바로 뒤인지 판정할 수 없어 자동완성이 안 떴다. (한글 단어 자체는 태그 사전에
  // 걸리는 게 없어 목록이 뜨지 않는다 — 와일드카드 이름일 때만 의미가 있다.)
  const isTagChar = (c: string) => /[\p{L}\p{N}_\-\s']/u.test(c)
  let start = cursorPos
  while (start > 0) {
    const ch = value[start - 1]
    if (',\n\r{}[]():'.includes(ch) || !isTagChar(ch)) break
    start--
  }
  let end = cursorPos
  while (end < value.length && (value[end] === ' ' || value[end] === '\t')) end++
  const beforeCursor = value.substring(start, cursorPos)
  const leadingSpaces = beforeCursor.length - beforeCursor.trimStart().length
  return { word: beforeCursor.trim(), start: start + leadingSpaces, end, fullStart: start }
}

// 스크롤 가능한 조상(패널)을 찾는다 — 드래그 선택 중 패널 고정에 사용.
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let n: HTMLElement | null = el?.parentElement ?? null
  while (n) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n
    n = n.parentElement
  }
  return null
}

// 워드랩을 고려한 커서의 픽셀 위치 — 동일 스타일의 미러 div로 측정.
function caretPixel(ta: HTMLTextAreaElement) {
  const cs = window.getComputedStyle(ta)
  const mirror = document.createElement('div')
  const s = mirror.style
  s.position = 'absolute'; s.visibility = 'hidden'
  s.whiteSpace = cs.whiteSpace; s.wordWrap = cs.wordWrap; s.overflowWrap = cs.overflowWrap
  s.width = ta.clientWidth + 'px'
  s.fontSize = cs.fontSize; s.fontFamily = cs.fontFamily; s.fontWeight = cs.fontWeight
  s.lineHeight = cs.lineHeight; s.letterSpacing = cs.letterSpacing
  s.padding = cs.padding; s.border = '0'; s.boxSizing = cs.boxSizing
  mirror.textContent = ta.value.substring(0, ta.selectionStart)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const mr = marker.getBoundingClientRect()
  const dr = mirror.getBoundingClientRect()
  const pos = { x: mr.left - dr.left, y: mr.top - dr.top }
  document.body.removeChild(mirror)
  return pos
}

function computeDropdownPos(ta: HTMLTextAreaElement) {
  const rect = ta.getBoundingClientRect()
  const { x, y } = caretPixel(ta)
  const cs = window.getComputedStyle(ta)
  const lineHeight = parseInt(cs.lineHeight) || parseInt(cs.fontSize) * 1.2
  const width = Math.min(350, Math.max(250, rect.width - 20))
  const height = 300
  let left = rect.left + x - ta.scrollLeft
  let top = rect.top + y - ta.scrollTop + lineHeight + 4
  if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10
  if (left < 10) left = 10
  if (top + height > window.innerHeight - 10) top = rect.top + y - ta.scrollTop - height - 4
  if (top < 10) top = 10
  return { left, top, maxWidth: width }
}

type Pos = { left: number; top: number; maxWidth: number }

interface Props {
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  onMouseUp?: (e: React.MouseEvent<HTMLTextAreaElement>) => void
}

/**
 * Danbooru 태그 자동완성이 붙은 textarea (PeroPix 이식). 입력 중인 단어를 검색해
 * 커서 위치에 드롭다운을 띄우고, ↑/↓·Enter·Esc로 조작, 선택 시 ', ' 접미사로 삽입한다.
 */
export function TagAutocompleteTextarea({ value, onChange, rows, placeholder, className, style, onMouseUp }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<TagEntry[]>([])
  const [sel, setSel] = useState(0)
  const [pos, setPos] = useState<Pos>({ left: 0, top: 0, maxWidth: 350 })

  const lastValue = useRef(value)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppress = useRef(false)
  const pendingCursor = useRef<number | null>(null)

  useEffect(() => { loadTags() }, [])

  const close = () => setOpen(false)

  const runAutocomplete = () => {
    const ta = ref.current
    if (!ta || !tagsLoaded()) return
    const cursorPos = ta.selectionStart
    // 연속 스페이스 2개면 자동완성 종료.
    if (cursorPos >= 2 && ta.value.substring(cursorPos - 2, cursorPos) === '  ') return close()
    const { word, fullStart } = getCurrentWord(ta.value, cursorPos)
    // #이름 와일드카드 — 단어 바로 앞이 #이면 정의된 풀 이름을 제안(빈 단어=전체 목록).
    if (ta.value[fullStart - 1] === '#' && !word.includes(' ')) {
      const wc = searchWildcardEntries(word)
      if (wc.length === 0) return close()
      setResults(wc)
      setSel(0)
      setPos(computeDropdownPos(ta))
      setOpen(true)
      return
    }
    const searchWord = word.replace(/ /g, '_') // 스페이스 → 언더바 (Danbooru 포맷)
    if (searchWord.length < 2) return close()
    const found = searchTags(searchWord)
    if (found.length === 0) return close()
    setResults(found)
    setSel(0)
    setPos(computeDropdownPos(ta))
    setOpen(true)
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    const deleting = v.length < lastValue.current.length
    lastValue.current = v
    onChange(v)
    if (suppress.current) return
    if (deleting) return close()
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(runAutocomplete, 50)
  }

  // 선택한 태그를 커서 위치에 삽입. 뒤에 ', ' 접미사(이미 콤마가 있으면 생략).
  // 와일드카드(풀 이름)는 언더바를 그대로 유지해야 #이름 토큰이 성립한다.
  const insertTag = (tag: TagEntry) => {
    const ta = ref.current
    if (!ta) return
    const { start, end, fullStart } = getCurrentWord(value, ta.selectionStart)
    const leadingSpaces = value.substring(fullStart, start)
    let suffix = ', '
    if (end < value.length && value[end] === ',') {
      suffix = end + 1 < value.length && value[end + 1] !== ' ' ? ' ' : ''
    }
    const insertText = leadingSpaces + (tag.type === 'wildcard' ? tag.value : underscoresToSpaces(tag.value)) + suffix
    const newValue = value.substring(0, fullStart) + insertText + value.substring(end)
    pendingCursor.current = fullStart + insertText.length
    lastValue.current = newValue
    onChange(newValue)
    close()
  }

  // onChange로 값이 바뀐 뒤 커서를 삽입 지점 끝으로 복원 (controlled textarea라 직접 설정).
  useLayoutEffect(() => {
    if (pendingCursor.current != null && ref.current) {
      const p = pendingCursor.current
      pendingCursor.current = null
      ref.current.focus()
      ref.current.setSelectionRange(p, p)
    }
  }, [value])

  useEffect(() => {
    if (!open) return
    const el = dropdownRef.current?.children[sel] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, open])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Alt + ↑/↓ 는 자동완성 목록 이동보다 우선한다 — 드롭다운이 떠 있어도 가중치를 만진다.
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const t = targetRange()
      if (t) {
        e.preventDefault()
        bumpWeight(t.from, t.to, e.key === 'ArrowUp' ? WEIGHT_STEP : -WEIGHT_STEP)
        return
      }
    }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const t = results[sel]
      if (t) { suppress.current = true; insertTag(t); setTimeout(() => { suppress.current = false }, 100) }
    } else if (e.key === 'Escape') { e.preventDefault(); close() }
  }

  // ── 태그 가중치 (Alt + 방향키 / 휠 / 가로 드래그 / 휠클릭) ──────────────
  // 프롬프트 에디터(PromptEditor)와 같은 조작을 이 textarea에도 붙인다 — 이 컴포넌트가
  // 네거티브 프롬프트, Multi 탭의 슬롯 프롬프트, 직접입력 모드의 포지티브를 모두 담당한다.

  // 조절 후 되돌릴 선택 범위. 기존 pendingCursor와 달리 포커스를 뺏지 않는다 —
  // 휠로 만질 때 다른 곳에 있던 포커스를 가져오면 타이핑 흐름이 끊긴다.
  const pendingSel = useRef<{ from: number; to: number } | null>(null)
  useLayoutEffect(() => {
    if (pendingSel.current && ref.current) {
      const p = pendingSel.current
      pendingSel.current = null
      ref.current.setSelectionRange(p.from, p.to)
    }
  }, [value])

  // 마우스 좌표 → 문자 offset. 브라우저가 textarea 내부 위치를 주지 않으면 null이고,
  // 그때는 호출부가 현재 커서/선택으로 물러선다.
  const offsetFromPoint = (x: number, y: number): number | null => {
    const ta = ref.current
    if (!ta) return null
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    const p = d.caretPositionFromPoint?.(x, y)
    if (p && (p.offsetNode === ta || ta.contains(p.offsetNode))) return p.offset
    return null
  }

  // 조작 대상. 좌표를 알면 그 지점(단 선택 안을 가리켰으면 선택 전체), 모르면 현재 선택/커서.
  const targetRange = (x?: number, y?: number): { from: number; to: number } | null => {
    const ta = ref.current
    if (!ta) return null
    const s = ta.selectionStart
    const e = ta.selectionEnd
    if (x != null && y != null) {
      const p = offsetFromPoint(x, y)
      if (p != null) return s !== e && p >= s - 1 && p <= e + 1 ? { from: s, to: e } : { from: p, to: p }
    }
    return { from: s, to: e }
  }

  const applyEdit = (edit: WeightEdit | null) => {
    const ta = ref.current
    if (!edit || !ta) return
    const from = shiftOffset(ta.selectionStart, edit.span, edit.newLen)
    const to = shiftOffset(ta.selectionEnd, edit.span, edit.newLen)
    pendingSel.current = { from, to }
    lastValue.current = edit.text
    onChange(edit.text)
    close()
  }

  const bumpWeight = (from: number, to: number, delta: number) =>
    applyEdit(adjustWeight(value, from, to, delta))

  // 휠은 네이티브 리스너 + passive:false 로 붙인다. React의 onWheel은 passive라
  // preventDefault()가 무시되고, 값이 바뀌면서 패널까지 같이 스크롤된다.
  const live = useRef({ bumpWeight, targetRange, value })
  live.current = { bumpWeight, targetRange, value }
  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return
      const t = live.current.targetRange(e.clientX, e.clientY)
      if (!t) return
      e.preventDefault()
      live.current.bumpWeight(t.from, t.to, e.deltaY < 0 ? WEIGHT_STEP : -WEIGHT_STEP)
    }
    ta.addEventListener('wheel', onWheel, { passive: false })
    return () => ta.removeEventListener('wheel', onWheel)
  }, [])

  // Alt + 가로 드래그 — 포인터를 잠가 커서를 고정·숨기고 4px마다 한 단계.
  const scrub = useRef<{ from: number; to: number; dx: number; acc: number } | null>(null)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const sc = scrub.current
      if (!sc) return
      sc.dx += e.movementX || 0
      const steps = Math.trunc(sc.dx / SCRUB_PX)
      if (steps !== sc.acc) {
        live.current.bumpWeight(sc.from, sc.to, (steps - sc.acc) * WEIGHT_STEP)
        sc.acc = steps
      }
    }
    const onUp = () => {
      if (!scrub.current) return
      scrub.current = null
      document.body.classList.remove('weight-scrubbing')
      if (document.pointerLockElement) document.exitPointerLock()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 드래그로 텍스트 선택 시 textarea 내부만 스크롤되게 하고, 패널(스크롤 조상)은 고정한다.
  // (커서가 textarea를 벗어나면 패널이 따라 스크롤돼 textarea가 위로 밀려 사라지던 문제 방지.)
  const onMouseDown = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (e.altKey) {
      const t = targetRange(e.clientX, e.clientY)
      if (t) {
        if (e.button === 1) { // 휠클릭 — 가중치 제거
          e.preventDefault()
          applyEdit(clearWeight(value, t.from, t.to))
          return
        }
        if (e.button === 0) { // 좌클릭 드래그 — 훑어서 조절
          e.preventDefault()
          scrub.current = { from: t.from, to: t.to, dx: 0, acc: 0 }
          document.body.classList.add('weight-scrubbing')
          try { ref.current?.requestPointerLock?.() } catch { /* 잠금 불가 — 위치 기반으로 동작 */ }
          return
        }
      }
    }
    const sc = scrollParent(ref.current)
    if (!sc) return
    const top = sc.scrollTop
    const pin = () => { if (sc.scrollTop !== top) sc.scrollTop = top }
    sc.addEventListener('scroll', pin)
    const up = () => {
      sc.removeEventListener('scroll', pin)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mouseup', up)
  }

  return (
    <>
      <textarea ref={ref} rows={rows} value={value} placeholder={placeholder} className={className} style={style}
        onChange={handleChange} onKeyDown={handleKeyDown} onMouseUp={onMouseUp} onMouseDown={onMouseDown}
        onBlur={() => setTimeout(close, 150)} />
      {open && results.length > 0 && createPortal(
        <div ref={dropdownRef} className="tag-ac-dropdown"
          style={{ left: pos.left, top: pos.top, maxWidth: pos.maxWidth }}>
          {results.map((t, i) => (
            <div key={t.value + i} className={`tag-ac-item${i === sel ? ' selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertTag(t) }}
              onMouseMove={() => setSel(i)}>
              <span className="tag-ac-name" title={t.label}>{t.label}</span>
              <span className={`tag-ac-badge ${t.type}`}>{CATEGORY_LABEL[t.type] ?? t.type}</span>
              <span className="tag-ac-count">{formatCount(t.count)}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
