import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { useWorkbench } from '../../stores/workbench'
import { placeTokenAt, snapTokenOffset } from '../../tags/promptTags'
import { adjustWeight, clearWeight, shiftOffset, type WeightEdit } from '../../tags/tagWeight'
import { CATEGORY_LABEL, getCurrentWord, scrollParent, underscoresToSpaces } from '../../tags/TagAutocompleteTextarea'
import { formatCount, loadTags, searchTags, tagsLoaded, type TagEntry } from '../../tags/tagData'
import { searchWildcardEntries } from '../../tags/wildcards'

const TOKEN = '@triggers'
const TOKEN_RE = /@triggers/i
// Multi Base 전용 두 번째 칩: 슬롯 프롬프트가 삽입될 자리(@slot). slotChip prop으로 켠다.
const SLOT = '@slot'
const SLOT_RE = /@slot/i

// 붙여넣기: 웹/윈도우 줄바꿈(CRLF/CR)을 LF로 정규화 — CR가 줄 끝에 안 보이게 남아 Del을 두 번 눌러야 하던 문제 방지. 그 외 문자는 건드리지 않음.
const sanitizePaste = (s: string): string => s.replace(/\r\n?/g, '\n')

const isChip = (n: Node | null | undefined): n is HTMLElement =>
  !!n && n.nodeType === Node.ELEMENT_NODE &&
  !!((n as HTMLElement).classList?.contains('trig-anchor') || (n as HTMLElement).classList?.contains('slot-anchor'))

// 칩이 나타내는 토큰 문자열 (@triggers | @slot).
const chipTokenOf = (n: HTMLElement): string => (n.classList.contains('slot-anchor') ? SLOT : TOKEN)

// value(문자열) 기준 자식 노드 길이: 칩=그 토큰 길이, <br>=개행 1글자, 텍스트=글자수.
// 줄바꿈은 텍스트의 '\n'이 아니라 <br>로 표현한다 — contenteditable에서 '\n'으로 만든 빈 줄은
// 캐럿이 들어가지 않기 때문(빈 줄 편집 불가 문제의 원인).
const nodeLen = (n: Node | null | undefined): number =>
  !n ? 0 : isChip(n) ? chipTokenOf(n).length : n.nodeName === 'BR' ? 1 : (n.textContent?.length ?? 0)

// 드롭 지점(좌표) → 캐럿 Range. 브라우저별 API 차이를 흡수.
function caretRangeFromPoint(x: number, y: number): Range | null {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (d.caretRangeFromPoint) return d.caretRangeFromPoint(x, y)
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    if (!p) return null
    const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r
  }
  return null
}

interface Props {
  value: string // positive (안에 @triggers 토큰을 항상 하나 포함)
  onChange: (v: string) => void
  placeholder?: string
  style?: React.CSSProperties
  onMouseUp?: (e: React.MouseEvent<HTMLDivElement>) => void
  triggers?: string[] // @triggers 칩 표시/툴팁용 활성 트리거워드. 미지정 시 workbench params 사용(Single).
  trigChip?: boolean // false면 @triggers 칩을 쓰지 않는다(자동 트리거워드 off인 Multi Base — @slot 칩만).
  slotChip?: boolean // Multi Base: @slot 칩(슬롯 프롬프트 삽입 자리)도 하나 유지. 호출측이 value에 토큰을 보장.
}

/**
 * 포지티브 프롬프트 에디터(contenteditable). 텍스트는 전부 일반 편집 텍스트이고,
 * @triggers만 인라인 칩으로 박혀 텍스트 사이로 드래그해 위치를 바꿀 수 있다(빌더가 그 자리에
 * 트리거워드를 치환 삽입). textarea의 Danbooru 태그 자동완성도 그대로 포팅.
 * DOM은 React가 아니라 직접 관리(uncontrolled) — 입력 중 캐럿이 튀지 않도록.
 */
export function PromptEditor({ value, onChange, placeholder, style, onMouseUp, triggers: triggersProp, trigChip = true, slotChip = false }: Props) {
  const t = useT()
  const wbTriggers = useWorkbench((s) => s.params.triggers)
  const triggers = triggersProp ?? wbTriggers
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<TagEntry[]>([])
  const [sel, setSel] = useState(0)
  const [pos, setPos] = useState({ left: 0, top: 0, maxWidth: 350 })
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragChip = useRef<HTMLElement | null>(null) // 드래그 중인 칩(@triggers 또는 @slot)
  // 자체 undo/redo 스택 — 붙여넣기·Enter·삭제·자동완성은 직접 DOM을 고쳐 브라우저 네이티브
  // undo에 안 잡히므로, 값 스냅샷을 직접 쌓아 Ctrl+Z/Ctrl+Y를 제공한다.
  const hist = useRef<{ stack: { value: string; caret: number }[]; i: number; ts: number; typing: boolean }>({
    stack: [], i: -1, ts: 0, typing: false,
  })
  // 드롭하면 @triggers가 놓일 위치를 보여주는 캐럿 마커(뷰포트 좌표).
  const [marker, setMarker] = useState<{ left: number; top: number; height: number } | null>(null)

  useEffect(() => { loadTags() }, [])

  const chipTitle = () => {
    const base = t('@triggers: where trigger words are inserted (drag to move)')
    return triggers && triggers.length ? `${base} — ${triggers.join(', ')}` : base
  }

  // DOM → 문자열. withToken=true면 칩을 그 토큰으로(=value), false면 칩 제외(=plain).
  const serialize = (withToken: boolean) => {
    const el = ref.current
    if (!el) return ''
    let out = ''
    el.childNodes.forEach((n) => {
      if (isChip(n)) out += withToken ? chipTokenOf(n) : ''
      else if (n.nodeName === 'BR') out += '\n'
      else out += n.textContent ?? ''
    })
    return out
  }

  const hasTriggers = !!(triggers && triggers.length)
  const makeChip = () => {
    const chip = document.createElement('span')
    // 활성 트리거워드가 없으면 위치는 유지하되 비활성(empty)으로 흐리게 표시.
    chip.className = 'trig-badge anchor trig-anchor' + (hasTriggers ? '' : ' empty')
    chip.setAttribute('contenteditable', 'false')
    chip.draggable = true
    chip.textContent = TOKEN
    chip.title = chipTitle()
    return chip
  }
  const makeSlotChip = () => {
    const chip = document.createElement('span')
    chip.className = 'trig-badge anchor slot-anchor'
    chip.setAttribute('contenteditable', 'false')
    chip.draggable = true
    chip.textContent = SLOT
    chip.title = t('@slot: where each slot prompt is inserted (drag to move)')
    return chip
  }
  // 이 에디터에서 활성화된 칩 목록 — 파싱·보호·재구성 로직이 공유한다.
  const chipDefs = [
    ...(trigChip ? [{ re: TOKEN_RE, tok: TOKEN, sel: '.trig-anchor', make: makeChip }] : []),
    ...(slotChip ? [{ re: SLOT_RE, tok: SLOT, sel: '.slot-anchor', make: makeSlotChip }] : []),
  ]

  // 텍스트를 el에 붙이되 '\n'은 <br>로 — 빈 줄에도 캐럿이 들어가게.
  const appendText = (el: HTMLElement, text: string) => {
    const parts = text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) el.appendChild(document.createElement('br'))
      if (part) el.appendChild(document.createTextNode(part))
    })
  }

  // value 문자열로부터 DOM 재구성(텍스트 노드 + <br> + 칩들, 플랫 구조).
  // 활성화된 칩은 토큰이 없어도 항상 하나씩 표시(끝) — 호출측이 value에 토큰을 보장한다.
  const buildDom = (str: string) => {
    const el = ref.current
    if (!el) return
    const marks = chipDefs
      .map((d) => ({ i: str.search(d.re), d }))
      .filter((m) => m.i >= 0)
      .sort((a, b) => a.i - b.i)
    el.textContent = ''
    let pos = 0
    for (const m of marks) {
      appendText(el, str.slice(pos, m.i))
      el.appendChild(m.d.make())
      pos = m.i + m.d.tok.length
    }
    appendText(el, str.slice(pos))
    for (const d of chipDefs) if (str.search(d.re) < 0) el.appendChild(d.make())
  }

  // 마운트: plaintext-only로 설정(서식 붙여넣기·리치 편집 차단) + 최초 렌더.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    try { el.setAttribute('contenteditable', 'plaintext-only') }
    catch { el.setAttribute('contenteditable', 'true') }
    buildDom(value)
    pushHistory() // 초기 상태 적립
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 외부에서 value/triggers가 바뀌면 반영. 우리 입력으로 인한 변경(serialize===value)이면
  // 재구성하지 않아 캐럿을 보존하고, 칩 툴팁만 갱신.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // value에 토큰이 있는데 DOM에 해당 칩이 없으면(예: 직접입력 모드에서 받은 텍스트가
    // 복원됨) 반드시 재구성해 토큰이 '리터럴 텍스트'로 남지 않게 한다.
    const tokenButNoChip = chipDefs.some((d) => d.re.test(value) && !el.querySelector(d.sel))
    if (serialize(true) !== value || tokenButNoChip) {
      // 외부 변경(불러오기·스타일·칩 이동 등) → 재구성하고 undo 히스토리를 새 문서로 리셋.
      buildDom(value)
      hist.current = { stack: [{ value, caret: value.length }], i: 0, ts: 0, typing: false }
    } else {
      const chip = el.querySelector('.trig-anchor') as HTMLElement | null
      if (chip) { chip.title = chipTitle(); chip.classList.toggle('empty', !hasTriggers) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, triggers ? triggers.join('|') : ''])

  // ── 캐럿/자동완성 ────────────────────────────────────────────────
  const caretText = () => {
    const s = window.getSelection()
    if (!s || s.rangeCount === 0) return null
    const range = s.getRangeAt(0)
    if (!range.collapsed) return null
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE || !ref.current?.contains(node)) return null
    return { node: node as Text, offset: range.startOffset, range }
  }

  const runAutocomplete = () => {
    if (!tagsLoaded()) return
    const ctx = caretText()
    if (!ctx) return setOpen(false)
    const text = ctx.node.textContent ?? ''
    if (ctx.offset >= 2 && text.substring(ctx.offset - 2, ctx.offset) === '  ') return setOpen(false)
    const { word, fullStart } = getCurrentWord(text, ctx.offset)
    // #이름 와일드카드 — 단어 바로 앞이 #이면 정의된 풀 이름을 제안(빈 단어=전체 목록).
    const wcMode = text[fullStart - 1] === '#' && !word.includes(' ')
    const found = wcMode ? searchWildcardEntries(word) : (() => {
      const searchWord = word.replace(/ /g, '_')
      return searchWord.length < 2 ? [] : searchTags(searchWord)
    })()
    if (found.length === 0) return setOpen(false)
    setResults(found); setSel(0)
    let rect = ctx.range.getBoundingClientRect()
    if (!rect.height && !rect.width) rect = ref.current!.getBoundingClientRect()
    const width = 300
    let left = rect.left
    let top = rect.bottom + 4
    if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10
    if (left < 10) left = 10
    if (top + 300 > window.innerHeight - 10) top = rect.top - 300 - 4
    if (top < 10) top = 10
    setPos({ left, top, maxWidth: width })
    setOpen(true)
  }

  // value offset에 캐럿 지정(locateValueOffset은 아래에 정의 — 클로저로 호출 시점엔 준비됨).
  // 프로그램적 배치(Enter·삭제·붙여넣기·undo)는 브라우저 자동 스크롤이 안 걸리므로 직접 스크롤.
  const setCaret = (off: number) => {
    const loc = locateValueOffset(off)
    const s = window.getSelection()
    if (!s) return
    const r = document.createRange()
    try { r.setStart(loc.node, loc.offset) } catch { return }
    r.collapse(true); s.removeAllRanges(); s.addRange(r)
    scrollCaretIntoView(off)
  }

  // 캐럿이 에디터 밖(아래/위)으로 나가면 보이도록 스크롤. 빈 줄 등에서 range 사각형이 비면
  // 임시 마커로 위치를 측정하고 캐럿을 복원한다.
  const scrollCaretIntoView = (off: number) => {
    const el = ref.current
    const s = window.getSelection()
    if (!el || !s || s.rangeCount === 0) return
    let rect = s.getRangeAt(0).getBoundingClientRect()
    if (rect.height === 0 && rect.top === 0 && rect.left === 0) {
      const loc = locateValueOffset(off)
      const probe = document.createRange()
      try { probe.setStart(loc.node, loc.offset) } catch { return }
      probe.collapse(true)
      const span = document.createElement('span')
      span.textContent = '​'
      probe.insertNode(span)
      rect = span.getBoundingClientRect()
      span.remove(); el.normalize()
      const l2 = locateValueOffset(off) // 캐럿 복원
      const r2 = document.createRange()
      try { r2.setStart(l2.node, l2.offset); r2.collapse(true); s.removeAllRanges(); s.addRange(r2) } catch { /* */ }
    }
    const box = el.getBoundingClientRect()
    if (rect.bottom > box.bottom - 2) el.scrollTop += rect.bottom - box.bottom + 6
    else if (rect.top < box.top + 2) el.scrollTop -= box.top - rect.top + 6
  }

  // 현재 값/캐럿을 히스토리에 적립(타이핑은 600ms 내 연속이면 한 단계로 병합).
  const pushHistory = (coalesceTyping = false) => {
    const h = hist.current
    const value = serialize(true)
    const caret = caretValueOffset() ?? value.length
    const cur = h.stack[h.i]
    if (cur && cur.value === value) { cur.caret = caret; return }
    const now = Date.now()
    if (coalesceTyping && h.typing && cur && now - h.ts < 600) {
      h.stack[h.i] = { value, caret }
    } else {
      h.stack = h.stack.slice(0, h.i + 1) // redo 가지 버림
      h.stack.push({ value, caret })
      h.i = h.stack.length - 1
      if (h.stack.length > 300) { h.stack.shift(); h.i-- }
    }
    h.ts = now
    h.typing = coalesceTyping
  }

  // Ctrl+Z(-1)/Ctrl+Y(+1) — 히스토리에서 값/캐럿 복원.
  const applyHistory = (dir: -1 | 1) => {
    const h = hist.current
    const ni = h.i + dir
    if (ni < 0 || ni >= h.stack.length) return
    h.i = ni
    const { value, caret } = h.stack[ni]
    buildDom(value)
    setCaret(caret)
    onChange(value)
    setOpen(false)
  }

  // 캐럿/선택 위치에 평문 삽입(붙여넣기·Enter·선택삭제). value(문자열) 공간에서 처리해 칩(토큰)을
  // 원자적으로 다룬다: 붙여넣기 텍스트의 @triggers 리터럴은 제거(칩 중복 방지)하고, 선택이 칩을
  // 포함해도 칩을 정확히 하나 보존한다. DOM은 buildDom으로 재구성.
  const insertTextAtCaret = (raw: string) => {
    const el = ref.current
    const s = window.getSelection()
    if (!el || !s || s.rangeCount === 0) return
    // 활성 칩 토큰은 붙여넣기 텍스트에서 제거(칩 중복 방지). 비활성 토큰은 일반 텍스트로 취급.
    let text = raw
    for (const d of chipDefs) text = text.replace(new RegExp(d.tok, 'gi'), '')
    const range = s.getRangeAt(0)
    const a = valueOffsetOf(range.startContainer, range.startOffset)
    const b = range.collapsed ? a : valueOffsetOf(range.endContainer, range.endOffset)
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    const value = serialize(true)
    // 선택이 칩(토큰)을 포함하면 그 칩을 보존 — 삽입 텍스트 뒤에 원래 순서대로 유지.
    const kept = chipDefs
      .map((d) => ({ i: value.search(d.re), tok: d.tok }))
      .filter((x) => x.i >= 0 && x.i < hi && x.i + x.tok.length > lo)
      .sort((x, y) => x.i - y.i)
    const next = value.slice(0, lo) + text + kept.map((x) => x.tok).join(', ') + value.slice(hi)
    buildDom(next)
    setCaret(lo + text.length)
    onChange(next)
    pushHistory()
  }

  // 선택한 태그를 현재 단어 위치에 삽입(뒤에 ', '). 칩은 건드리지 않음.
  // 와일드카드(풀 이름)는 언더바를 그대로 유지해야 #이름 토큰이 성립한다.
  const insertTag = (tag: TagEntry) => {
    const ctx = caretText()
    if (!ctx) return
    const text = ctx.node.textContent ?? ''
    const { start, end, fullStart } = getCurrentWord(text, ctx.offset)
    const leading = text.substring(fullStart, start)
    let suffix = ', '
    if (end < text.length && text[end] === ',') {
      suffix = end + 1 < text.length && text[end + 1] !== ' ' ? ' ' : ''
    }
    const insertText = leading + (tag.type === 'wildcard' ? tag.value : underscoresToSpaces(tag.value)) + suffix
    ctx.node.textContent = text.slice(0, fullStart) + insertText + text.slice(end)
    const caret = Math.min(fullStart + insertText.length, ctx.node.textContent.length)
    const s = window.getSelection()
    if (s) { const r = document.createRange(); r.setStart(ctx.node, caret); r.collapse(true); s.removeAllRanges(); s.addRange(r) }
    setOpen(false)
    onChange(serialize(true))
    pushHistory()
  }

  // DOM이 비정상(칩이 1개가 아니거나, 칩 외의 요소가 섞임)이면 캐럿을 보존하며 평탄화 재구성한다.
  // 외부 드롭·브라우저 quirk로 편집 불가한 조각(예: contenteditable=false 잔재)이 생겨도 다음
  // 입력/키에서 자가복구된다. 정상 구조면 아무것도 하지 않음(비용 거의 0).
  const heal = (): boolean => {
    const el = ref.current
    if (!el) return false
    const trigCount = el.querySelectorAll('.trig-anchor').length
    const slotCount = el.querySelectorAll('.slot-anchor').length
    const stray = Array.from(el.childNodes).some((n) => n.nodeType === Node.ELEMENT_NODE && !isChip(n) && n.nodeName !== 'BR')
    if (trigCount === (trigChip ? 1 : 0) && slotCount === (slotChip ? 1 : 0) && !stray) return false
    const caret = caretValueOffset()
    buildDom(serialize(true)) // 칩 하나 + 텍스트로 평탄화(다른 요소는 textContent로 흡수)
    if (caret != null) setCaret(caret)
    onChange(serialize(true))
    pushHistory()
    return true
  }

  const onInput = () => {
    if (!heal()) { // 비정상이면 heal이 복구+반영, 정상이면 일반 처리
      onChange(serialize(true))
      pushHistory(true) // 타이핑: 시간 기준 병합
    }
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(runAutocomplete, 50)
  }

  // (container, offset) → value(@triggers=TOKEN.length 문자) 기준 offset. 칩은 원자적으로 셈.
  const valueOffsetOf = (container: Node, offset: number): number => {
    const el = ref.current
    if (!el) return 0
    let off = 0
    if (container === el) {
      for (let i = 0; i < offset; i++) off += nodeLen(el.childNodes[i])
      return off
    }
    for (const n of Array.from(el.childNodes)) {
      if (n === container || n.contains(container)) return off + offset
      off += nodeLen(n)
    }
    return off
  }

  // 현재 collapsed 캐럿의 value 기준 offset. collapsed가 아니거나 에디터 밖이면 null.
  const caretValueOffset = (): number | null => {
    const el = ref.current
    const s = window.getSelection()
    if (!el || !s || s.rangeCount === 0) return null
    const range = s.getRangeAt(0)
    if (!range.collapsed || !el.contains(range.startContainer)) return null
    return valueOffsetOf(range.startContainer, range.startOffset)
  }

  // value offset → DOM 위치. 텍스트노드는 그 안 offset, <br>/칩은 el 레벨의 앞/뒤 경계.
  const locateValueOffset = (off: number): { node: Node; offset: number } => {
    const el = ref.current!
    const kids = Array.from(el.childNodes)
    let acc = 0
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i]
      const len = nodeLen(n)
      if (off <= acc + len) {
        if (n.nodeType === Node.TEXT_NODE) return { node: n, offset: Math.max(0, Math.min(off - acc, n.textContent?.length ?? 0)) }
        return { node: el, offset: off <= acc ? i : i + 1 } // <br> 또는 칩 경계
      }
      acc += len
    }
    return { node: el, offset: kids.length }
  }

  // ── 태그 가중치 (Alt + 방향키 / 휠 / 가로 드래그 / 휠클릭) ──────────────
  // 전부 value(문자열) 공간에서 계산한다 — 칩(@triggers)은 토큰 문자열로 세므로
  // 칩이 섞여 있어도 offset이 어긋나지 않는다.
  const WEIGHT_STEP = 0.05
  const SCRUB_PX = 4 // 이만큼 끌 때마다 한 단계

  // 현재 선택(collapsed면 캐럿)의 value 기준 [from, to].
  const selValueRange = (): { from: number; to: number } | null => {
    const el = ref.current
    const s = window.getSelection()
    if (!el || !s || s.rangeCount === 0 || !el.contains(s.anchorNode)) return null
    const r = s.getRangeAt(0)
    const a = valueOffsetOf(r.startContainer, r.startOffset)
    const b = valueOffsetOf(r.endContainer, r.endOffset)
    return a <= b ? { from: a, to: b } : { from: b, to: a }
  }

  const valueOffsetFromPoint = (x: number, y: number): number | null => {
    const el = ref.current
    const range = caretRangeFromPoint(x, y)
    if (!el || !range || !el.contains(range.startContainer)) return null
    return valueOffsetOf(range.startContainer, range.startOffset)
  }

  // 마우스 조작의 대상: 선택이 있고 그 안을 가리켰으면 선택 전체, 아니면 가리킨 지점.
  const pointTarget = (x: number, y: number): { from: number; to: number } | null => {
    const point = valueOffsetFromPoint(x, y)
    if (point == null) return null
    const sel = selValueRange()
    if (sel && sel.from !== sel.to && point >= sel.from - 1 && point <= sel.to + 1) return sel
    return { from: point, to: point }
  }

  const setSelRange = (from: number, to: number) => {
    const a = locateValueOffset(from)
    const b = locateValueOffset(to)
    const s = window.getSelection()
    if (!s) return
    const r = document.createRange()
    try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset) } catch { return }
    s.removeAllRanges(); s.addRange(r)
  }

  // keepSel=true → 조절한 구간을 다시 선택(키보드). false → 원래 커서를 그대로 둔다(마우스).
  // 마우스 경로에서도 텍스트 길이가 변하면 커서가 밀리므로 변경 지점 기준으로 따라 옮긴다.
  const applyEdit = (edit: WeightEdit | null, keepSel: boolean, history: boolean) => {
    if (!edit) return
    const before = selValueRange()
    buildDom(edit.text)
    if (keepSel) setSelRange(edit.span.start, edit.span.start + edit.newLen)
    else if (before) {
      setSelRange(shiftOffset(before.from, edit.span, edit.newLen),
        shiftOffset(before.to, edit.span, edit.newLen))
    }
    onChange(edit.text)
    // 드래그·휠 연속 조작은 한 단계로 뭉친다 — 스텝마다 쌓으면 Ctrl+Z가 무의미해진다.
    pushHistory(!history)
  }

  const bumpWeight = (from: number, to: number, delta: number, keepSel: boolean, history = false) => {
    applyEdit(adjustWeight(serialize(true), from, to, delta), keepSel, history)
  }

  // Alt + 가로 드래그. 포인터를 잠가 커서를 고정·숨김 — 잠기면 아무리 끌어도 화면을 벗어나지
  // 않는다. 잠금이 거부되면 위치 기반으로 동작하므로 화면 끝에서 멈춘다(그 경우 휠을 쓰면 된다).
  const scrub = useRef<{ from: number; to: number; dx: number; acc: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const sc = scrub.current
      if (!sc) return
      sc.dx += e.movementX || 0
      const steps = Math.trunc(sc.dx / SCRUB_PX)
      if (steps !== sc.acc) {
        bumpWeight(sc.from, sc.to, (steps - sc.acc) * WEIGHT_STEP, false)
        sc.acc = steps
      }
    }
    const onUp = () => {
      if (!scrub.current) return
      scrub.current = null
      document.body.classList.remove('weight-scrubbing')
      if (document.pointerLockElement) document.exitPointerLock()
      pushHistory() // 드래그 한 번 = undo 한 단계
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ★ 네이티브 리스너로 직접 붙인다. React의 onWheel은 wheel을 passive로 등록하므로
  // preventDefault()가 무시되고, Alt+휠이 가중치를 바꾸면서 스크롤까지 같이 된다.
  // 핸들러는 ref를 거쳐 호출해 항상 최신 클로저(value·onChange)를 보게 한다.
  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {})
  wheelHandler.current = (e: WheelEvent) => {
    if (!e.altKey) return
    const t = pointTarget(e.clientX, e.clientY)
    if (!t) return
    e.preventDefault()
    bumpWeight(t.from, t.to, e.deltaY < 0 ? WEIGHT_STEP : -WEIGHT_STEP, false)
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = (e: WheelEvent) => wheelHandler.current(e)
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  // Backspace/Delete 직접 처리 — 칩(토큰)은 절대 지우지 않고 그 외 한 글자만 지운다(개행을
  // 지우면 윗줄과 합쳐짐). 직접 DOM을 고치고 히스토리를 적립한다(브라우저 칩-삭제 quirk 회피).
  const manualDelete = (forward: boolean) => {
    const c = caretValueOffset()
    if (c == null) return
    const value = serialize(true)
    const target = forward ? c : c - 1 // 지울 글자 위치
    if (target < 0 || target >= value.length) return // 지울 것 없음
    // 활성 칩 토큰 범위면 차단(칩 보존).
    for (const d of chipDefs) {
      const idx = value.search(d.re)
      if (idx >= 0 && target >= idx && target < idx + d.tok.length) return
    }
    const next = value.slice(0, target) + value.slice(target + 1)
    buildDom(next)
    setCaret(forward ? c : c - 1)
    onChange(next)
    pushHistory()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    heal() // 비정상 구조면 먼저 복구 — 먹통 행에서 Del/방향키/편집이 다시 되게
    // Alt + ↑/↓ — 커서가 놓인 태그(또는 선택한 태그 전부)의 가중치.
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const r = selValueRange()
      if (r) {
        e.preventDefault()
        bumpWeight(r.from, r.to, e.key === 'ArrowUp' ? WEIGHT_STEP : -WEIGHT_STEP, true)
        return
      }
    }
    // 자체 undo/redo (Ctrl+Z / Ctrl+Shift+Z·Ctrl+Y) — 직접 DOM 편집이라 네이티브 undo 미동작.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault()
      const redo = (e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y'
      applyHistory(redo ? 1 : -1)
      return
    }
    if (open && results.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return }
      if (e.key === 'Enter') { e.preventDefault(); const tg = results[sel]; if (tg) insertTag(tg); return }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault(); setOpen(false)
      const s = window.getSelection()
      const range = s && s.rangeCount ? s.getRangeAt(0) : null
      if (range && !range.collapsed) {
        insertTextAtCaret('') // 선택 삭제(칩은 value 공간에서 보존)
      } else {
        manualDelete(e.key === 'Delete')
      }
      return
    }
    if (e.key === 'Enter') { e.preventDefault(); insertTextAtCaret('\n') }
  }

  // 칩을 클릭하면 클릭 위치(좌/우 절반)에 따라 칩 앞/뒤에 캐럿을 놓는다 — 칩 경계에서도
  // 텍스트처럼 커서를 두고 태그를 추가할 수 있게(특히 칩이 맨 앞/뒤일 때).
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const chip = e.target as HTMLElement
    if (!isChip(chip)) return
    const el = ref.current
    if (!el) return
    const rect = chip.getBoundingClientRect()
    const idx = Array.from(el.childNodes).indexOf(chip)
    const before = e.clientX < rect.left + rect.width / 2
    const s = window.getSelection()
    if (!s) return
    const r = document.createRange()
    r.setStart(el, before ? idx : idx + 1); r.collapse(true)
    s.removeAllRanges(); s.addRange(r)
    el.focus()
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    insertTextAtCaret(sanitizePaste(e.clipboardData.getData('text/plain')))
  }

  // 텍스트 드래그 선택 중 에디터 내부만 스크롤되게 하고, 패널(스크롤 조상)은 고정한다 —
  // 커서가 에디터를 벗어나도 패널이 따라 스크롤돼 에디터가 위로 밀려 사라지던 문제 방지.
  // (칩 드래그는 별도 처리하므로 제외.)
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Alt + 휠클릭(가운데 버튼) — 가중치를 통째로 벗긴다.
    if (e.altKey && e.button === 1) {
      const t = pointTarget(e.clientX, e.clientY)
      if (t) {
        e.preventDefault()
        applyEdit(clearWeight(serialize(true), t.from, t.to), false, true)
        return
      }
    }
    // Alt + 좌클릭 드래그 — 가로로 훑어 가중치 조절.
    if (e.altKey && e.button === 0) {
      const t = pointTarget(e.clientX, e.clientY)
      if (t) {
        e.preventDefault()
        scrub.current = { from: t.from, to: t.to, dx: 0, acc: 0 }
        document.body.classList.add('weight-scrubbing')
        try { ref.current?.requestPointerLock?.() } catch { /* 잠금 불가 — 위치 기반으로 동작 */ }
        return
      }
    }
    if (isChip(e.target as Node)) return
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

  // ── 칩(@triggers/@slot) 드래그 → 텍스트 사이로 이동 ──────────────────────
  // '드래그 공간' = 드래그 중인 칩만 제외한 문자열(다른 칩은 토큰 텍스트로 포함) — 드롭 결과를
  // placeTokenAt으로 만들 때 다른 칩의 토큰이 유실되지 않게 한다.
  const plainLen = (n: Node) => (n.nodeName === 'BR' ? 1 : (n.textContent ?? '').length)
  const dragLen = (n: Node) => (isChip(n) ? (n === dragChip.current ? 0 : chipTokenOf(n).length) : plainLen(n))
  const serializeDrag = () => {
    const el = ref.current
    if (!el) return ''
    let out = ''
    el.childNodes.forEach((n) => {
      if (isChip(n)) out += n === dragChip.current ? '' : chipTokenOf(n)
      else if (n.nodeName === 'BR') out += '\n'
      else out += n.textContent ?? ''
    })
    return out
  }
  // 드롭 지점 Range → 드래그 공간 내 문자 offset.
  const offsetFromRange = (el: HTMLElement, range: Range) => {
    let k = 0
    if (range.startContainer === el) {
      for (let i = 0; i < range.startOffset; i++) {
        const n = el.childNodes[i]
        if (n) k += dragLen(n)
      }
    } else {
      for (const n of Array.from(el.childNodes)) {
        if (n === range.startContainer || n.contains(range.startContainer)) { k += range.startOffset; break }
        k += dragLen(n)
      }
    }
    return k
  }
  // (node, offset) 위치의 캐럿 사각형. 빈 줄 등에서 collapsed Range가 빈 사각형(0,0,0,0)을
  // 주면, 임시 zero-width span을 끼워 측정한 뒤 제거한다(마커가 좌상단으로 튀는 것 방지).
  const measureCaret = (node: Node, offset: number): DOMRect | null => {
    const r = document.createRange()
    try { r.setStart(node, offset); r.collapse(true) } catch { return null }
    let rect = r.getBoundingClientRect()
    if (rect.left === 0 && rect.top === 0 && rect.width === 0 && rect.height === 0) {
      const span = document.createElement('span')
      span.textContent = '​'
      try {
        r.insertNode(span)
        rect = span.getBoundingClientRect()
      } finally {
        span.remove()
        ref.current?.normalize() // 끼우며 갈라진 텍스트 노드 재병합
      }
    }
    return rect
  }

  // 드래그 공간 offset → DOM 위치. 드래그 중인 칩은 건너뛰고, <br>·다른 칩은 el 레벨 경계로.
  const locate = (el: HTMLElement, pos: number): { node: Node; offset: number } | null => {
    const kids = Array.from(el.childNodes)
    let acc = 0
    for (const n of kids) {
      if (n === dragChip.current) continue
      const len = dragLen(n)
      if (acc + len >= pos) {
        if (n.nodeType === Node.TEXT_NODE) return { node: n, offset: pos - acc }
        const idx = kids.indexOf(n)
        return { node: el, offset: pos <= acc ? idx : idx + 1 } // <br>/칩 경계
      }
      acc += len
    }
    const last = [...kids].reverse().find((n) => !isChip(n) && n.nodeType === Node.TEXT_NODE)
    return last ? { node: last, offset: (last.textContent ?? '').length } : { node: el, offset: kids.length }
  }

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const chip = e.target as HTMLElement
    if (!isChip(chip)) return // 칩만 드래그(텍스트 선택 드래그는 무시)
    dragChip.current = chip
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', chipTokenOf(chip))
    // 커서를 따라오는 고스트: 칩 복제본을 드래그 이미지로 지정.
    const ghost = chip.cloneNode(true) as HTMLElement
    ghost.className = chip.className + ' drag-ghost'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
    setTimeout(() => ghost.remove(), 0)
    chip.classList.add('drag-src') // 원본 칩 흐리게
  }
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragChip.current) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    const el = ref.current
    if (!el) return
    const range = caretRangeFromPoint(e.clientX, e.clientY)
    if (!range) return setMarker(null)
    const pos = snapTokenOffset(serializeDrag(), offsetFromRange(el, range))
    const loc = locate(el, pos)
    if (!loc) return setMarker(null)
    const rect = measureCaret(loc.node, Math.min(loc.offset, (loc.node.textContent ?? '').length))
    if (!rect) return setMarker(null)
    setMarker({ left: rect.left, top: rect.top, height: rect.height || 18 })
  }
  const endDrag = () => {
    dragChip.current?.classList.remove('drag-src')
    dragChip.current = null
    setMarker(null)
  }
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    // 항상 네이티브 드롭을 막는다 — 외부 텍스트/이미지 등이 HTML로 삽입돼 편집 불가한 조각이
    // 생기는 것(오래 쓰다 특정 행이 먹통 되는 원인)을 원천 차단. 칩 이동만 우리가 처리.
    e.preventDefault()
    const chip = dragChip.current
    if (!chip) return
    const el = ref.current
    const range = el ? caretRangeFromPoint(e.clientX, e.clientY) : null
    if (el && range) onChange(placeTokenAt(serializeDrag(), offsetFromRange(el, range), chipTokenOf(chip)))
    endDrag()
  }

  return (
    <>
      <div
        ref={ref}
        className="prompt-editor"
        style={style}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={onInput}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onMouseDown={onMouseDown}
        // 가운데 버튼의 브라우저 기본 동작(자동 스크롤·X11 붙여넣기) 차단.
        onAuxClick={(e) => { if (e.altKey && e.button === 1) e.preventDefault() }}
        onPaste={onPaste}
        onMouseUp={onMouseUp}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={endDrag}
        onDragLeave={() => setMarker(null)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150)
          // 포커스가 떠나면 프롬프트란의 텍스트 선택 하이라이트를 해제 — 다른 곳(생성 버튼·이미지 등)
          // 으로 포커스가 넘어간 뒤 Delete가 선택 이미지에 적용될 때 헷갈리지 않도록.
          // ★창·탭 전환(다른 앱에서 복사해 오기 등)은 제외 — 이때는 문서만 포커스를 잃고 포커스 요소는
          // 이 에디터 그대로다. 여기서 선택을 지우면 캐럿이 사라져, 돌아와 붙여넣기·타이핑하면 맨 앞에
          // 들어가고(보이지 않는 곳) Ctrl+Z도 그걸 되돌려 둘 다 안 먹는 것처럼 보였다.
          if (document.activeElement === ref.current) return
          const s = window.getSelection()
          if (s && ref.current && s.anchorNode && ref.current.contains(s.anchorNode)) s.removeAllRanges()
        }}
      />
      {marker && createPortal(
        <div className="drop-caret" style={{ left: marker.left, top: marker.top, height: marker.height }} />,
        document.body,
      )}
      {open && results.length > 0 && createPortal(
        <div ref={dropdownRef} className="tag-ac-dropdown"
          style={{ left: pos.left, top: pos.top, maxWidth: pos.maxWidth }}>
          {results.map((tg, i) => (
            <div key={tg.value + i} className={`tag-ac-item${i === sel ? ' selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertTag(tg) }}
              onMouseMove={() => setSel(i)}>
              <span className="tag-ac-name" title={tg.label}>{tg.label}</span>
              <span className={`tag-ac-badge ${tg.type}`}>{CATEGORY_LABEL[tg.type] ?? tg.type}</span>
              <span className="tag-ac-count">{formatCount(tg.count)}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
