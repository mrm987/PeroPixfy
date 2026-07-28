import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useLibrary } from '../../stores/library'
import { useWorkbench } from '../../stores/workbench'
import type { LoraEntry } from '../../workflow/types'
import { LoraPicker } from './LoraPicker'

interface Props {
  available: string[]
  loras: LoraEntry[]
  setLoras: (loras: LoraEntry[]) => void
}

const STRENGTH_STEP = 0.05

/**
 * 로라 강도 입력.
 *
 * ★ type="number"가 아니라 text다. 숫자 입력칸은 "-"나 빈칸처럼 아직 숫자가 아닌
 * 중간 상태에서 브라우저가 값을 빈 문자열로 돌려주는데, 그걸 그대로 Number()에 넣으면
 * 0이 되어 화면에 즉시 0이 박힌다. 그래서 음수를 칠 수 없었고(-를 치는 순간 0으로
 * 되돌아감) 0을 지울 수도 없었다(지우면 다시 0).
 *
 * 그래서 편집 중에는 화면에 보이는 문자열을 그대로 들고 있다가, 칸을 벗어날 때
 * 숫자로 확정한다. 아무 숫자도 없이 벗어나면 0으로 둔다.
 *
 * 조절 조작은 프롬프트 태그 가중치와 똑같이 맞춘다 — 앱 전체에서 "Alt를 누른 채"가
 * 값 조절을 뜻하게:
 *   Alt+↑/↓ (스피너가 없으므로 Alt 없이 눌러도 동작) · Alt+휠 ·
 *   Alt+좌우 드래그(커서 잠금) · Alt+휠클릭 = 기본값 1로 리셋
 */
const STRENGTH_RESET = 1
const SCRUB_PX = 4 // 이만큼 끌 때마다 한 단계
function StrengthInput({ value, onChange, title }: {
  value: number
  onChange: (v: number) => void
  title?: string
}) {
  const [text, setText] = useState(String(value))
  const editing = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 스타일 적용 등 외부에서 값이 바뀌면 따라가되, 사용자가 타이핑 중이면 건드리지 않는다.
  useEffect(() => { if (!editing.current) setText(String(value)) }, [value])

  const commit = (raw: string) => {
    const n = parseFloat(raw)
    const v = Number.isFinite(n) ? n : 0
    setText(String(v))
    if (v !== value) onChange(v)
  }

  const num = () => {
    const n = parseFloat(text)
    return Number.isFinite(n) ? n : 0
  }
  const setValue = (v: number) => {
    const next = Math.round(v * 100) / 100
    setText(String(next))
    onChange(next)
  }
  const nudge = (dir: 1 | -1) => setValue(num() + dir * STRENGTH_STEP)

  // ★ 네이티브 리스너 + passive:false. React의 onWheel은 wheel을 passive로 붙이므로
  // preventDefault()가 무시되고, 값이 바뀌면서 패널까지 같이 스크롤된다.
  // 핸들러는 ref를 거쳐 호출해 항상 최신 text/onChange를 보게 한다.
  const live = useRef({ nudge, setValue, num })
  live.current = { nudge, setValue, num }
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return
      e.preventDefault()
      live.current.nudge(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Alt + 좌우 드래그. 시작값을 잡아 두고 끈 거리로 절대 계산한다 — 매 스텝 더하면
  // 부동소수 오차가 쌓인다. 포인터를 잠가 커서를 고정·숨긴다.
  const scrub = useRef<{ base: number; dx: number; acc: number } | null>(null)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const sc = scrub.current
      if (!sc) return
      sc.dx += e.movementX || 0
      const steps = Math.trunc(sc.dx / SCRUB_PX)
      if (steps !== sc.acc) {
        sc.acc = steps
        live.current.setValue(sc.base + steps * STRENGTH_STEP)
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

  const onMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    if (!e.altKey) return
    if (e.button === 1) { // 휠클릭 — 기본값으로 리셋
      e.preventDefault()
      live.current.setValue(STRENGTH_RESET)
      return
    }
    if (e.button === 0) {
      e.preventDefault()
      scrub.current = { base: live.current.num(), dx: 0, acc: 0 }
      document.body.classList.add('weight-scrubbing')
      try { inputRef.current?.requestPointerLock?.() } catch { /* 잠금 불가 — 위치 기반으로 동작 */ }
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      className="lora-strength"
      value={text}
      title={title}
      onMouseDown={onMouseDown}
      // 가운데 버튼의 브라우저 기본 동작(자동 스크롤·X11 붙여넣기) 차단.
      onAuxClick={(e) => { if (e.altKey && e.button === 1) e.preventDefault() }}
      onFocus={() => { editing.current = true }}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        // 완성된 숫자일 때만 밖으로 알린다 — "-"나 "1." 같은 중간 상태는 흘려보내지 않는다.
        const n = parseFloat(raw)
        if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(raw.trim())) onChange(n)
      }}
      onBlur={(e) => { editing.current = false; commit(e.target.value) }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          nudge(e.key === 'ArrowUp' ? 1 : -1)
        } else if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export function LoraStack({ available, loras, setLoras }: Props) {
  const t = useT()
  const flashLora = useWorkbench((s) => s.flashLora)
  const setFlashLora = useWorkbench((s) => s.setFlashLora)
  const libLoaded = useLibrary((s) => s.loaded)
  const libLoad = useLibrary((s) => s.load)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // 라이브러리에서 ＋Stack으로 추가하면 해당 행을 잠깐 강조한 뒤 해제한다.
  useEffect(() => {
    if (!flashLora) return
    const t = setTimeout(() => setFlashLora(null), 1400)
    return () => clearTimeout(t)
  }, [flashLora, setFlashLora])

  // 로라 썸네일(LoraPicker 호버 프리뷰)용 라이브러리 데이터 1회 로드.
  useEffect(() => {
    if (!libLoaded) libLoad()
  }, [libLoaded, libLoad])

  const update = (i: number, patch: Partial<LoraEntry>) =>
    setLoras(loras.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  // 트리거워드는 더 이상 프롬프트에 직접 삽입하지 않는다 — 스택 하단의 TriggerBadges에서
  // 따로 관리하고, 빌더가 positive의 @triggers 위치에 넣는다.
  const toggleEnabled = (i: number, enabled: boolean) => update(i, { enabled })
  const remove = (i: number) => setLoras(loras.filter((_, j) => j !== i))
  // 드래그한 행(from)을 드롭한 행(to) 위치로 옮긴다.
  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = [...loras]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setLoras(next)
  }
  const add = () =>
    setLoras([...loras, { relPath: available[0] ?? '', strength: 1.0, enabled: false }])

  return (
    <div className="lora-stack">
      {/* ⧉ 아이콘은 라이브러리 툴바의 '스택에 있는 것만' 필터 버튼과 같은 아이콘이다 —
          그 버튼이 가리키는 대상이 바로 이 스택임을 알아보게 하는 표식. */}
      <div className="field-label lora-stack-label">
        <i className="pi pi-clone" title={t('This is the LoRA stack — the ⧉ filter in the Library shows only these')} />
        {t('LoRAs ({n}/{m})', { n: loras.filter((l) => l.enabled).length, m: loras.length })}
      </div>
      {loras.map((l, i) => (
        <div key={i}
          className={`lora-row${l.enabled ? '' : ' disabled'}${l.relPath === flashLora ? ' flash' : ''}${available.length > 0 && l.relPath && !available.includes(l.relPath) ? ' missing' : ''}${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== null && dragIndex !== i ? ' drag-over' : ''}`}
          onDragOver={(e) => { if (dragIndex !== null) { e.preventDefault(); setOverIndex(i) } }}
          onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) reorder(dragIndex, i); setDragIndex(null); setOverIndex(null) }}>
          <span className="lora-drag" draggable title={t('Drag to reorder')}
            onDragStart={(e) => {
              setDragIndex(i)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(i))
              const row = (e.currentTarget as HTMLElement).parentElement
              if (row) e.dataTransfer.setDragImage(row, 20, 16)
            }}
            onDragEnd={() => { setDragIndex(null); setOverIndex(null) }}>⠿</span>
          <input
            type="checkbox"
            checked={l.enabled}
            onChange={(e) => toggleEnabled(i, e.target.checked)}
            title={t('Enable')}
          />
          <LoraPicker value={l.relPath} options={available}
            missing={available.length > 0 && !!l.relPath && !available.includes(l.relPath)}
            onChange={(v) => update(i, { relPath: v })} />
          <StrengthInput value={l.strength} title={t('Strength')}
            onChange={(v) => update(i, { strength: v })} />
          <button onClick={() => remove(i)} title={t('Remove')}>✕</button>
        </div>
      ))}
      <button className="add-lora" onClick={add}>{t('+ Add LoRA')}</button>
    </div>
  )
}
