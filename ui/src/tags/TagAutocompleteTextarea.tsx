import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatCount, loadTags, searchTags, tagsLoaded, type TagEntry } from './tagData'

export const CATEGORY_LABEL: Record<string, string> = {
  general: 'general', artist: 'artist', character: 'character', copyright: 'copyright', meta: 'meta',
}

// 삽입 시 언더바를 띄어쓰기로 변환. 단 ^_^ / >_< 같은 이모티콘의 _는 보존한다.
export const underscoresToSpaces = (tag: string) =>
  tag.replace(/_/g, (_m, i: number, s: string) => {
    const before = s[i - 1]
    const after = s[i + 1]
    if (before === '^' || after === '^' || (before && after && /[><;:=]/.test(before + after))) return '_'
    return ' '
  })

// 커서 위치의 '현재 단어'를 구한다. 콤마/개행/괄호/콜론이 단어 경계.
// 검색은 커서 앞부분만 쓰고, 교체 범위는 단어 뒤 공백까지 흡수한다.
export function getCurrentWord(value: string, cursorPos: number) {
  const isTagChar = (c: string) => /[a-zA-Z0-9_\-\s]/.test(c)
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
  style?: React.CSSProperties
  onMouseUp?: (e: React.MouseEvent<HTMLTextAreaElement>) => void
}

/**
 * Danbooru 태그 자동완성이 붙은 textarea (PeroPix 이식). 입력 중인 단어를 검색해
 * 커서 위치에 드롭다운을 띄우고, ↑/↓·Enter·Esc로 조작, 선택 시 ', ' 접미사로 삽입한다.
 */
export function TagAutocompleteTextarea({ value, onChange, rows, placeholder, style, onMouseUp }: Props) {
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
    const { word } = getCurrentWord(ta.value, cursorPos)
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
  const insertTag = (tagValue: string) => {
    const ta = ref.current
    if (!ta) return
    const { start, end, fullStart } = getCurrentWord(value, ta.selectionStart)
    const leadingSpaces = value.substring(fullStart, start)
    let suffix = ', '
    if (end < value.length && value[end] === ',') {
      suffix = end + 1 < value.length && value[end + 1] !== ' ' ? ' ' : ''
    }
    const insertText = leadingSpaces + underscoresToSpaces(tagValue) + suffix
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
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const t = results[sel]
      if (t) { suppress.current = true; insertTag(t.value); setTimeout(() => { suppress.current = false }, 100) }
    } else if (e.key === 'Escape') { e.preventDefault(); close() }
  }

  // 드래그로 텍스트 선택 시 textarea 내부만 스크롤되게 하고, 패널(스크롤 조상)은 고정한다.
  // (커서가 textarea를 벗어나면 패널이 따라 스크롤돼 textarea가 위로 밀려 사라지던 문제 방지.)
  const onMouseDown = () => {
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
      <textarea ref={ref} rows={rows} value={value} placeholder={placeholder} style={style}
        onChange={handleChange} onKeyDown={handleKeyDown} onMouseUp={onMouseUp} onMouseDown={onMouseDown}
        onBlur={() => setTimeout(close, 150)} />
      {open && results.length > 0 && createPortal(
        <div ref={dropdownRef} className="tag-ac-dropdown"
          style={{ left: pos.left, top: pos.top, maxWidth: pos.maxWidth }}>
          {results.map((t, i) => (
            <div key={t.value + i} className={`tag-ac-item${i === sel ? ' selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertTag(t.value) }}
              onMouseEnter={() => setSel(i)}>
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
