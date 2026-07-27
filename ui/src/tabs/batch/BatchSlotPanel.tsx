import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { NumberField, SelectField } from '../../components/controls'
import { Section } from '../../components/Section'
import { TagAutocompleteTextarea } from '../../tags/TagAutocompleteTextarea'
import { ParamsPanel } from '../workbench/ParamsPanel'
import { activeTabOf, sortPresets, useBatch, type ImageFormat } from '../../stores/batch'

const pad3 = (n: number) => String(n).padStart(3, '0')

/** Multi 탭의 'Slot' 서브탭 본문 — 활성 캔버스 탭의 슬롯 편집 + 프리셋 + 저장 설정 + 생성. */
export function BatchSlotPanel() {
  const t = useT()
  const s = useBatch()
  const tab = useBatch(activeTabOf)
  const slots = tab?.slots ?? []
  const allCollapsed = slots.length > 0 && slots.every((x) => s.slotCollapsed[x.id])
  const allLocked = slots.length > 0 && slots.every((x) => x.locked)
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetDrag, setPresetDrag] = useState<number | null>(null)
  const [presetOver, setPresetOver] = useState<number | null>(null)
  const [slotDrag, setSlotDrag] = useState<number | null>(null)
  const [slotOver, setSlotOver] = useState<number | null>(null)
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
      {/* 슬롯 프롬프트 삽입 위치는 Base 포지티브의 @slot 칩으로 지정한다(트리거워드와 동일 방식). */}
      {/* 슬롯 에디터 — 섹션 전체 접기(헤더 클릭) + 개별 슬롯 접기(각 슬롯 헤더 클릭) */}
      <Section id="slots" title={t('Slots')}>
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
                className={`preset-item${p.filename === curFilename ? ' active' : ''}${presetDrag === i ? ' dragging' : ''}${presetOver === i && presetDrag !== null && presetDrag !== i ? ' drag-over' : ''}`}
                onDragOver={(e) => { if (presetDrag !== null) { e.preventDefault(); setPresetOver(i) } }}
                onDrop={(e) => { e.preventDefault(); if (presetDrag !== null) s.reorderPresets(presetDrag, i); setPresetDrag(null); setPresetOver(null) }}>
                <span className="preset-drag" draggable title={t('Drag to reorder')}
                  onDragStart={(e) => {
                    setPresetDrag(i)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(i))
                    const row = (e.currentTarget as HTMLElement).closest('.preset-item')
                    if (row) e.dataTransfer.setDragImage(row, 20, 12) // 행 전체를 고스트로
                  }}
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
      <div className="slots-head">
        <button className="slots-headbtn"
          title={allCollapsed ? t('Expand all slots') : t('Collapse all slots')}
          onClick={() => s.setSlotsCollapsed(slots.map((x) => x.id), !allCollapsed)}>
          {allCollapsed ? '▸ all' : '▾ all'}
        </button>
        <button className="slots-headbtn lockall"
          title={allLocked ? t('Unlock all slots') : t('Lock all slots (exclude from generation)')}
          onClick={() => s.setAllSlotsLocked(!allLocked)}>
          {allLocked ? '🔓 all' : '🔒 all'}
        </button>
        <label className="slot-start" title={t('Slot numbering start')}>{t('Start')}
          <input type="number" min={1} value={tab?.slotStart ?? 1}
            onChange={(e) => s.setSlotStart(Number(e.target.value))} />
        </label>
      </div>
      {slots.map((sl, i) => {
        const collapsed = !!s.slotCollapsed[sl.id]
        return (
        <div key={sl.id}
          className={`slot-row${sl.locked ? ' locked' : ''}${collapsed ? ' collapsed' : ''}${slotDrag === i ? ' dragging' : ''}${slotOver === i && slotDrag !== null && slotDrag !== i ? ' drag-over' : ''}`}
          onDragOver={(e) => { if (slotDrag !== null) { e.preventDefault(); setSlotOver(i) } }}
          onDrop={(e) => { e.preventDefault(); if (slotDrag !== null) s.reorderSlots(slotDrag, i); setSlotDrag(null); setSlotOver(null) }}>
          {/* 헤더 클릭 = 접기/펴기 (다른 섹션과 동일). 드래그·잠금·이름칸·액션은 클릭 전파 차단. */}
          <div className="slot-head" onClick={() => s.toggleSlotCollapsed(sl.id)} title={t('Click header to collapse/expand')}>
            <span className="slot-caret">{collapsed ? '▸' : '▾'}</span>
            <span className="slot-drag" draggable title={t('Drag to reorder')}
              onClick={(e) => e.stopPropagation()}
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
              onClick={(e) => { e.stopPropagation(); s.updateSlot(sl.id, { locked: !sl.locked }) }}>{sl.locked ? '🔒' : '🔓'}</button>
            <input className="slot-name" placeholder={t('Name (file prefix, optional)')} value={sl.name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => s.updateSlot(sl.id, { name: e.target.value })} />
            {collapsed && sl.prompt.trim() && (
              <span className="slot-preview" title={sl.prompt}>{sl.prompt.replace(/\s+/g, ' ').trim()}</span>
            )}
            <div className="slot-actions" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => s.duplicateSlot(sl.id)} title={t('Duplicate')}>⎘</button>
              <button onClick={() => {
                // 슬롯에 생성된 이미지가 있으면 함께 삭제되므로 경고. 없으면 바로 삭제.
                const n = (tab?.results ?? []).filter((r) => r.slotId === sl.id && r.status === 'done' && r.imageUrls[0]).length
                if (n > 0 && !confirm(t('This slot has {n} generated image(s) — they will be deleted too. Delete the slot?', { n }))) return
                s.removeSlot(sl.id)
              }} disabled={slots.length <= 1} title={t('Remove')}>✕</button>
            </div>
          </div>
          {!collapsed && (
            <TagAutocompleteTextarea rows={3} className="slot-prompt" placeholder={t("This slot's prompt")} value={sl.prompt}
              style={{ height: sl.promptH ? `${sl.promptH}px` : undefined }}
              onMouseUp={(e) => { const h = e.currentTarget.offsetHeight; if (h && h !== sl.promptH) s.updateSlot(sl.id, { promptH: h }) }}
              onChange={(v) => s.updateSlot(sl.id, { prompt: v })} />
          )}
        </div>
        )
      })}
      <button className="add-slot" onClick={s.addSlot}>{t('+ Add slot')}</button>
      </Section>

      {/* 베이스탭에서 이동한 생성 파라미터(해상도·샘플링·고급·LUT) — 슬롯과 저장설정 사이. 캐릭터 base 편집(flat). */}
      <ParamsPanel embedded flat variant="params" />

      {/* 저장 설정 — 다른 섹션과 통일(접을 수 있는 Section). 출력 폴더는 상단 ⚙, 폴더 열기는 캔버스 툴바의 📂. */}
      <Section id="batch-save" title={t('Save settings')}>
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
      </Section>
    </div>
  )
}
