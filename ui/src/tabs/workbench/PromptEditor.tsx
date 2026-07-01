import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { useWorkbench } from '../../stores/workbench'
import { placeTokenAt, snapTokenOffset } from '../../tags/promptTags'
import { CATEGORY_LABEL, getCurrentWord, scrollParent, underscoresToSpaces } from '../../tags/TagAutocompleteTextarea'
import { formatCount, loadTags, searchTags, tagsLoaded, type TagEntry } from '../../tags/tagData'

const TOKEN = '@triggers'
const isChip = (n: Node | null | undefined): n is HTMLElement =>
  !!n && n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList?.contains('trig-anchor')

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
}

/**
 * 포지티브 프롬프트 에디터(contenteditable). 텍스트는 전부 일반 편집 텍스트이고,
 * @triggers만 인라인 칩으로 박혀 텍스트 사이로 드래그해 위치를 바꿀 수 있다(빌더가 그 자리에
 * 트리거워드를 치환 삽입). textarea의 Danbooru 태그 자동완성도 그대로 포팅.
 * DOM은 React가 아니라 직접 관리(uncontrolled) — 입력 중 캐럿이 튀지 않도록.
 */
export function PromptEditor({ value, onChange, placeholder, style, onMouseUp }: Props) {
  const t = useT()
  const triggers = useWorkbench((s) => s.params.triggers)
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<TagEntry[]>([])
  const [sel, setSel] = useState(0)
  const [pos, setPos] = useState({ left: 0, top: 0, maxWidth: 350 })
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = useRef(false)
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

  // DOM → 문자열. withToken=true면 칩을 @triggers로(=value), false면 칩 제외(=plain).
  const serialize = (withToken: boolean) => {
    const el = ref.current
    if (!el) return ''
    let out = ''
    el.childNodes.forEach((n) => {
      if (isChip(n)) out += withToken ? TOKEN : ''
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

  // value 문자열로부터 DOM 재구성(텍스트 노드 + 칩 하나, 플랫 구조).
  const buildDom = (str: string) => {
    const el = ref.current
    if (!el) return
    const idx = str.search(/@triggers/i)
    const before = idx >= 0 ? str.slice(0, idx) : str
    const after = idx >= 0 ? str.slice(idx + TOKEN.length) : ''
    el.textContent = ''
    if (before) el.appendChild(document.createTextNode(before))
    el.appendChild(makeChip()) // 토큰이 없어도 칩은 항상 하나 표시(끝)
    if (after) el.appendChild(document.createTextNode(after))
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
    // value에 @triggers 토큰이 있는데 DOM에 칩이 없으면(예: 직접입력 모드에서 받은 텍스트가
    // 복원됨) 반드시 재구성해 토큰이 '리터럴 텍스트'로 남지 않게 한다.
    const tokenButNoChip = /@triggers/i.test(value) && !el.querySelector('.trig-anchor')
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
    const { word } = getCurrentWord(text, ctx.offset)
    const searchWord = word.replace(/ /g, '_')
    if (searchWord.length < 2) return setOpen(false)
    const found = searchTags(searchWord)
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
  const setCaret = (off: number) => {
    const loc = locateValueOffset(off)
    const s = window.getSelection()
    if (!s) return
    const r = document.createRange()
    try { r.setStart(loc.node, loc.offset) } catch { return }
    r.collapse(true); s.removeAllRanges(); s.addRange(r)
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
    const text = raw.replace(/@triggers/gi, '')
    const range = s.getRangeAt(0)
    const a = valueOffsetOf(range.startContainer, range.startOffset)
    const b = range.collapsed ? a : valueOffsetOf(range.endContainer, range.endOffset)
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    const value = serialize(true)
    const tIdx = value.search(/@triggers/i)
    const tokenInSel = tIdx >= 0 && tIdx < hi && tIdx + TOKEN.length > lo // 선택이 칩을 포함?
    const next = tokenInSel
      ? value.slice(0, lo) + text + TOKEN + value.slice(hi) // 칩 보존 — 삽입 텍스트 뒤에 유지
      : value.slice(0, lo) + text + value.slice(hi)
    buildDom(next)
    setCaret(lo + text.length)
    onChange(next)
    pushHistory()
  }

  // 선택한 태그를 현재 단어 위치에 삽입(뒤에 ', '). 칩은 건드리지 않음.
  const insertTag = (tagValue: string) => {
    const ctx = caretText()
    if (!ctx) return
    const text = ctx.node.textContent ?? ''
    const { start, end, fullStart } = getCurrentWord(text, ctx.offset)
    const leading = text.substring(fullStart, start)
    let suffix = ', '
    if (end < text.length && text[end] === ',') {
      suffix = end + 1 < text.length && text[end + 1] !== ' ' ? ' ' : ''
    }
    const insertText = leading + underscoresToSpaces(tagValue) + suffix
    ctx.node.textContent = text.slice(0, fullStart) + insertText + text.slice(end)
    const caret = Math.min(fullStart + insertText.length, ctx.node.textContent.length)
    const s = window.getSelection()
    if (s) { const r = document.createRange(); r.setStart(ctx.node, caret); r.collapse(true); s.removeAllRanges(); s.addRange(r) }
    setOpen(false)
    onChange(serialize(true))
    pushHistory()
  }

  const onInput = () => {
    const el = ref.current
    // 안전망: 어떤 경로로든 칩이 사라졌으면 끝에 복원 — 절대 삭제되지 않게.
    if (el && !el.querySelector('.trig-anchor')) {
      const txt = serialize(true)
      buildDom(txt ? txt + ', @triggers' : '@triggers')
    }
    onChange(serialize(true))
    pushHistory(true) // 타이핑: 시간 기준 병합
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(runAutocomplete, 50)
  }

  // (container, offset) → value(@triggers=TOKEN.length 문자) 기준 offset. 칩은 원자적으로 셈.
  const valueOffsetOf = (container: Node, offset: number): number => {
    const el = ref.current
    if (!el) return 0
    let off = 0
    if (container === el) {
      for (let i = 0; i < offset; i++) {
        const n = el.childNodes[i]
        off += isChip(n) ? TOKEN.length : (n?.textContent?.length ?? 0)
      }
      return off
    }
    for (const n of Array.from(el.childNodes)) {
      if (n === container || n.contains(container)) return off + offset
      off += isChip(n) ? TOKEN.length : (n.textContent?.length ?? 0)
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

  // value offset → DOM 위치(텍스트노드와 offset, 또는 칩 앞/뒤 경계). 셀렉션 지정에 사용.
  const locateValueOffset = (off: number): { node: Node; offset: number } => {
    const el = ref.current!
    const kids = Array.from(el.childNodes)
    let acc = 0
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i]
      const len = isChip(n) ? TOKEN.length : (n.textContent?.length ?? 0)
      if (off <= acc + len) {
        if (isChip(n)) return { node: el, offset: off <= acc ? i : i + 1 }
        return { node: n, offset: Math.max(0, Math.min(off - acc, n.textContent?.length ?? 0)) }
      }
      acc += len
    }
    return { node: el, offset: kids.length }
  }

  // Backspace/Delete 직접 처리 — 칩(토큰)은 절대 지우지 않고 그 외 한 글자만 지운다(개행을
  // 지우면 윗줄과 합쳐짐). 직접 DOM을 고치고 히스토리를 적립한다(브라우저 칩-삭제 quirk 회피).
  const manualDelete = (forward: boolean) => {
    const c = caretValueOffset()
    if (c == null) return
    const value = serialize(true)
    const tIdx = value.search(/@triggers/i)
    const tEnd = tIdx >= 0 ? tIdx + TOKEN.length : -1
    const target = forward ? c : c - 1 // 지울 글자 위치
    if (target < 0 || target >= value.length) return // 지울 것 없음
    if (tIdx >= 0 && target >= tIdx && target < tEnd) return // 토큰이면 차단(칩 보존)
    const next = value.slice(0, target) + value.slice(target + 1)
    buildDom(next)
    setCaret(forward ? c : c - 1)
    onChange(next)
    pushHistory()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
      if (e.key === 'Enter') { e.preventDefault(); const tg = results[sel]; if (tg) insertTag(tg.value); return }
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
    insertTextAtCaret(e.clipboardData.getData('text/plain'))
  }

  // 텍스트 드래그 선택 중 에디터 내부만 스크롤되게 하고, 패널(스크롤 조상)은 고정한다 —
  // 커서가 에디터를 벗어나도 패널이 따라 스크롤돼 에디터가 위로 밀려 사라지던 문제 방지.
  // (칩 드래그는 별도 처리하므로 제외.)
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
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

  // ── @triggers 칩 드래그 → 텍스트 사이로 이동 ──────────────────────
  // 드롭 지점 Range → '칩 제외 텍스트' 내 문자 offset.
  const offsetFromRange = (el: HTMLElement, range: Range) => {
    let k = 0
    if (range.startContainer === el) {
      for (let i = 0; i < range.startOffset; i++) {
        const n = el.childNodes[i]
        if (n && !isChip(n)) k += (n.textContent ?? '').length
      }
    } else {
      for (const n of Array.from(el.childNodes)) {
        if (n === range.startContainer || n.contains(range.startContainer)) { k += range.startOffset; break }
        if (!isChip(n)) k += (n.textContent ?? '').length
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

  // plain 텍스트 내 문자 offset → DOM 위치(텍스트노드, offset). 칩은 건너뜀.
  const locate = (el: HTMLElement, pos: number): { node: Node; offset: number } | null => {
    let acc = 0
    for (const n of Array.from(el.childNodes)) {
      if (isChip(n)) continue
      const len = (n.textContent ?? '').length
      if (acc + len >= pos) return { node: n, offset: pos - acc }
      acc += len
    }
    const last = [...el.childNodes].reverse().find((n) => !isChip(n))
    return last ? { node: last, offset: (last.textContent ?? '').length } : null
  }

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const chip = e.target as HTMLElement
    if (!isChip(chip)) return // 칩만 드래그(텍스트 선택 드래그는 무시)
    dragging.current = true
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', TOKEN)
    // 커서를 따라오는 고스트: 칩 복제본을 드래그 이미지로 지정.
    const ghost = chip.cloneNode(true) as HTMLElement
    ghost.className = 'trig-badge anchor drag-ghost'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
    setTimeout(() => ghost.remove(), 0)
    ref.current?.classList.add('dragging-chip') // 원본 칩 흐리게
  }
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    const el = ref.current
    if (!el) return
    const range = caretRangeFromPoint(e.clientX, e.clientY)
    if (!range) return setMarker(null)
    const pos = snapTokenOffset(serialize(false), offsetFromRange(el, range))
    const loc = locate(el, pos)
    if (!loc) return setMarker(null)
    const rect = measureCaret(loc.node, Math.min(loc.offset, (loc.node.textContent ?? '').length))
    if (!rect) return setMarker(null)
    setMarker({ left: rect.left, top: rect.top, height: rect.height || 18 })
  }
  const endDrag = () => {
    dragging.current = false
    setMarker(null)
    ref.current?.classList.remove('dragging-chip')
  }
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    e.preventDefault()
    const el = ref.current
    const range = el ? caretRangeFromPoint(e.clientX, e.clientY) : null
    if (el && range) onChange(placeTokenAt(serialize(false), offsetFromRange(el, range)))
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
              onMouseDown={(e) => { e.preventDefault(); insertTag(tg.value) }}
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
