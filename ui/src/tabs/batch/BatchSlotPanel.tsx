import { Fragment, useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { NumberField, SelectField } from '../../components/controls'
import { Section } from '../../components/Section'
import { activeCharOf, activeTabOf, sortPresets, tokenizePrompt, useBatch, type ImageFormat } from '../../stores/batch'

const pad3 = (n: number) => String(n).padStart(3, '0')

/** Multi 탭의 'Slot' 서브탭 본문 — 활성 캔버스 탭의 슬롯 편집 + 프리셋 + 저장 설정 + 생성. */
export function BatchSlotPanel() {
  const t = useT()
  const s = useBatch()
  const tab = useBatch(activeTabOf)
  const basePositive = useBatch((st) => activeCharOf(st)?.base.positive ?? '')
  const slots = tab?.slots ?? []
  // base positive를 콤마·마침표 경계로 토큰화(병합 로직과 동일). 마침표도 삽입 경계가 됨.
  const toks = tokenizePrompt(basePositive)
  const n = toks.length
  const hasBase = basePositive.trim() !== ''
  const insertSel = tab?.promptInsert == null || tab.promptInsert >= n ? n : tab.promptInsert
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetDrag, setPresetDrag] = useState<number | null>(null)
  const [presetOver, setPresetOver] = useState<number | null>(null)
  const [slotDrag, setSlotDrag] = useState<number | null>(null)
  const [slotOver, setSlotOver] = useState<number | null>(null)
  const insertSummary = insertSel >= n ? t('at end') : t('before "{tag}"', { tag: (toks[insertSel]?.text || '').trim() })

  // 드래그해 옮기는 단일 'slot prompt' 블록 (현재 삽입 위치에 인라인 표시).
  const slotBlock = () => (
    <span className="insert-block" draggable
      title={t('Drag onto a tag (or click a tag) to move where the slot prompt goes')}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'slot') }}
      onDragEnd={() => setDragOver(null)}>{t('▸ slot prompt')}</span>
  )
  const curFilename = tab?.presetFilename ?? null
  const curName = tab?.name ?? ''
  const { format, quality, countPerSlot, excludeSlotNumber, presets, presetOrder } = s
  const ordered = sortPresets(presets, presetOrder)

  useEffect(() => { void s.loadPresetList() }, [s.loadPresetList]) // eslint-disable-line react-hooks/exhaustive-deps
  // 편집 자동저장 — 프리셋 탭의 슬롯이 바뀌면 디바운스 후 프리셋 파일에 기록.
  useEffect(() => {
    if (!tab?.presetFilename) return
    const id = setTimeout(() => { void s.overwritePreset() }, 600)
    return () => clearTimeout(id)
  }, [tab?.slots, tab?.presetFilename, s.overwritePreset]) // eslint-disable-line react-hooks/exhaustive-deps

  const onNewPreset = () => {
    const name = window.prompt(t('New preset name'), t('preset'))?.trim()
    if (name) { void s.newPreset(name); setPresetOpen(false) }
  }
  const renamePreset = (filename: string, cur: string) => {
    const name = window.prompt(t('Rename preset'), cur)?.trim()
    if (name) void s.renamePreset(filename, name)
  }
  const deletePreset = (filename: string, nm: string) => {
    if (window.confirm(t("Delete preset '{name}'?", { name: nm }))) void s.removePreset(filename)
  }

  return (
    <div className="batch-slot-panel">
      {/* 프리셋 드롭다운 — 선택/순서변경(드래그)/이름변경/복제/삭제/새로 만들기를 리스트 안에서. 편집은 자동저장. */}
      <div className="preset-dd">
        <button className="preset-dd-toggle" onClick={() => setPresetOpen((o) => !o)}>
          <span className="preset-dd-cur">{curName || t('— No preset —')}</span>
          <span className="preset-dd-caret">{presetOpen ? '▴' : '▾'}</span>
        </button>
        {presetOpen && (
          <div className="preset-list">
            {ordered.map((p, i) => (
              <div key={p.filename}
                className={`preset-item${p.filename === curFilename ? ' active' : ''}${presetOver === i && presetDrag !== null && presetDrag !== i ? ' drag-over' : ''}`}
                onDragOver={(e) => { if (presetDrag !== null) { e.preventDefault(); setPresetOver(i) } }}
                onDrop={(e) => { e.preventDefault(); if (presetDrag !== null) s.reorderPresets(presetDrag, i); setPresetDrag(null); setPresetOver(null) }}>
                <span className="preset-drag" draggable title={t('Drag to reorder')}
                  onDragStart={(e) => { setPresetDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
                  onDragEnd={() => { setPresetDrag(null); setPresetOver(null) }}>⠿</span>
                <button className="preset-name" onClick={() => { void s.applyPreset(p.filename); setPresetOpen(false) }}>{p.name}</button>
                <button className="preset-act" title={t('Rename preset')} onClick={() => renamePreset(p.filename, p.name)}>✎</button>
                <button className="preset-act" title={t('Duplicate')} onClick={() => { void s.duplicatePresetFile(p.filename); setPresetOpen(false) }}>⎘</button>
                <button className="preset-act" title={t('Delete preset')} onClick={() => deletePreset(p.filename, p.name)}>✕</button>
              </div>
            ))}
            <button className="preset-new" onClick={onNewPreset}>＋ {t('New preset')}</button>
          </div>
        )}
      </div>

      {/* base positive를 원본 그대로(쉼표·공백·개행 보존) 읽기전용 표시 + 단일 'slot prompt' 블록을
          드래그/클릭으로 옮겨 삽입 위치 지정(기본=끝). 접고펴기. */}
      <Section id="batch-insert" title={t('Base positive · slot prompt position')} summary={hasBase ? insertSummary : t('empty')}>
        {!hasBase ? (
          <p className="notice">{t('Base positive is empty — each slot prompt is used as-is.')}</p>
        ) : (
          <div className="insert-text">
            {toks.map((tok, i) => (
              <Fragment key={i}>
                {insertSel === i && slotBlock()}
                <span className={`ins-tok${dragOver === i ? ' over' : ''}`}
                  title={t('Click (or drop the block) to insert the slot prompt before this')}
                  onClick={() => s.setPromptInsert(i)}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(i) }}
                  onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                  onDrop={() => { s.setPromptInsert(i); setDragOver(null) }}>{tok.text}</span>
                {tok.delim && <span className="ins-comma">{tok.delim}</span>}
              </Fragment>
            ))}
            {insertSel >= n && slotBlock()}
            <span className={`ins-end${dragOver === n ? ' over' : ''}`}
              title={t('Insert at the end (default)')}
              onClick={() => s.setPromptInsert(null)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(n) }}
              onDragLeave={() => setDragOver((d) => (d === n ? null : d))}
              onDrop={() => { s.setPromptInsert(null); setDragOver(null) }}>{t('⏎end')}</span>
          </div>
        )}
      </Section>

      {/* 슬롯 에디터 */}
      <div className="slots-head">
        <span className="field-label">{t('Slots')}</span>
        <label className="slot-start" title={t('Slot numbering start')}>{t('Start')}
          <input type="number" min={1} value={tab?.slotStart ?? 1}
            onChange={(e) => s.setSlotStart(Number(e.target.value))} />
        </label>
      </div>
      {slots.map((sl, i) => (
        <div key={sl.id}
          className={`slot-row${sl.locked ? ' locked' : ''}${slotDrag === i ? ' dragging' : ''}${slotOver === i && slotDrag !== null && slotDrag !== i ? ' drag-over' : ''}`}
          onDragOver={(e) => { if (slotDrag !== null) { e.preventDefault(); setSlotOver(i) } }}
          onDrop={(e) => { e.preventDefault(); if (slotDrag !== null) s.reorderSlots(slotDrag, i); setSlotDrag(null); setSlotOver(null) }}>
          <div className="slot-head">
            <span className="slot-drag" draggable title={t('Drag to reorder')}
              onDragStart={(e) => {
                setSlotDrag(i)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(i))
                const row = (e.currentTarget as HTMLElement).closest('.slot-row')
                if (row) e.dataTransfer.setDragImage(row, 20, 16) // 행 전체를 고스트로
              }}
              onDragEnd={() => { setSlotDrag(null); setSlotOver(null) }}>⠿</span>
            <span className="slot-num">{pad3((tab?.slotStart ?? 1) + i)}</span>
            <button className="slot-lock" title={sl.locked ? t('Unlock') : t('Exclude from generation')}
              onClick={() => s.updateSlot(sl.id, { locked: !sl.locked })}>{sl.locked ? '🔒' : '🔓'}</button>
            <input className="slot-name" placeholder={t('Name (file prefix, optional)')} value={sl.name}
              onChange={(e) => s.updateSlot(sl.id, { name: e.target.value })} />
            <div className="slot-actions">
              <button onClick={() => s.duplicateSlot(sl.id)} title={t('Duplicate')}>⎘</button>
              <button onClick={() => s.removeSlot(sl.id)} disabled={slots.length <= 1} title={t('Remove')}>✕</button>
            </div>
          </div>
          <textarea rows={3} className="slot-prompt" placeholder={t("This slot's prompt")} value={sl.prompt}
            style={{ height: sl.promptH ? `${sl.promptH}px` : undefined }}
            onMouseUp={(e) => { const h = e.currentTarget.offsetHeight; if (h && h !== sl.promptH) s.updateSlot(sl.id, { promptH: h }) }}
            onChange={(e) => s.updateSlot(sl.id, { prompt: e.target.value })} />
        </div>
      ))}
      <button className="add-slot" onClick={s.addSlot}>{t('+ Add slot')}</button>

      {/* 저장 설정 (출력 폴더 경로는 상단 ⚙ 옵션 모달, 폴더 열기는 캔버스 줌 툴바의 📂) */}
      <div className="field-label">{t('Save settings')}</div>
      <div className="grid-2">
        <SelectField label={t('format')} value={format} options={['png', 'jpg', 'webp']}
          onChange={(v) => s.setSetting({ format: v as ImageFormat })} />
        {format !== 'png' && (
          <NumberField label={t('quality')} value={quality} min={1} max={100} step={1}
            onChange={(v) => s.setSetting({ quality: v })} />
        )}
      </div>
      <div className="grid-2">
        <NumberField label={t('images per slot')} value={countPerSlot} min={1} max={64} step={1}
          onChange={(v) => s.setSetting({ countPerSlot: v })} />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={excludeSlotNumber}
          onChange={(e) => s.setSetting({ excludeSlotNumber: e.target.checked })} /> {t('Exclude slot number from filename')}
      </label>
      {format !== 'png' && (
        <p className="notice">{t("jpg/webp don't save the generation info inside the image (png only).")}</p>
      )}
    </div>
  )
}
