import { useEffect, useMemo, useState } from 'react'
import { openOutputFolder } from '../../api/comfy'
import { useT } from '../../i18n'
import { Resizer } from '../../components/Resizer'
import { activeCharOf, activeTabOf, sanitize, useBatch, type Viewport } from '../../stores/batch'
import { useUi } from '../../stores/ui'
import { ParamsPanel } from '../workbench/ParamsPanel'
import { BatchCanvas } from './BatchCanvas'
import type { ResultLike } from './batchCanvasRenderer'
import { BatchSlotPanel } from './BatchSlotPanel'
import { CurationModal } from './CurationModal'

export function BatchTab() {
  const t = useT()
  const characters = useBatch((s) => s.characters)
  const activeCharId = useBatch((s) => s.activeCharId)
  const addCharacter = useBatch((s) => s.addCharacter)
  const renameCharacter = useBatch((s) => s.renameCharacter)
  const removeCharacter = useBatch((s) => s.removeCharacter)
  const switchCharacter = useBatch((s) => s.switchCharacter)
  const activeChar = useBatch(activeCharOf)

  const tabs = useBatch((s) => s.tabs)
  const activeTabId = useBatch((s) => s.activeTabId)
  const active = useBatch(activeTabOf)
  const switchTab = useBatch((s) => s.switchTab)
  const openNewTab = useBatch((s) => s.openNewTab)
  const closeTab = useBatch((s) => s.closeTab)
  const importBaseFromWorkbench = useBatch((s) => s.importBaseFromWorkbench)
  const removeResults = useBatch((s) => s.removeResults)
  const pruneMissing = useBatch((s) => s.pruneMissing)
  const runningTabId = useBatch((s) => s.runningTabId)
  const running = useBatch((s) => s.running)
  const start = useBatch((s) => s.start)
  const stop = useBatch((s) => s.stop)
  const countPerSlot = useBatch((s) => s.countPerSlot)
  const outputFolder = useBatch((s) => s.outputFolder)
  const activePromptId = useBatch((s) => s.activePromptId)
  const progress = useBatch((s) => s.progress) // Multi 자체 step 진행률 (Single과 분리 — 서로 큐 UI 오염 X)

  const viewports = useBatch((s) => s.viewports)
  const setViewport = useBatch((s) => s.setViewport)
  const multiW = useUi((s) => s.multiW)
  const setPref = useUi((s) => s.setPref)
  const sub = useUi((s) => s.multiSub)

  const [sel, setSel] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [curateSlot, setCurateSlot] = useState<string | null>(null)

  const slots = active?.slots ?? []
  const results = active?.results ?? []
  const charTabs = tabs.filter((t) => t.charId === activeCharId)
  const activeSlots = slots.filter((sl) => !sl.locked).length
  const total = results.length
  const done = results.filter((r) => r.status === 'done').length
  const aspect = activeChar ? activeChar.base.width / activeChar.base.height : 832 / 1216

  // 결과가 없는 슬롯도 캔버스에 자리를 잡아둔다 — 슬롯당 countPerSlot개의 idle 플레이스홀더.
  // (이미 결과가 있는 슬롯은 실제 결과를 그대로 보여줌.)
  const displayResults = useMemo<ResultLike[]>(() => {
    const out: ResultLike[] = []
    slots.forEach((slot) => {
      const rs = results.filter((r) => r.slotId === slot.id)
      if (rs.length) {
        out.push(...rs)
      } else {
        for (let i = 0; i < Math.max(1, countPerSlot); i++) {
          out.push({ id: `ph_${slot.id}_${i}`, slotId: slot.id, status: 'idle', imageUrls: [], promptId: null, placeholder: true })
        }
      }
    })
    return out
  }, [slots, results, countPerSlot])

  const deleteSel = async () => {
    const ids = [...sel]
    setSel(new Set())
    await removeResults(ids)
  }
  const commitRename = () => {
    if (editing && editing.name.trim()) renameCharacter(editing.id, editing.name.trim())
    setEditing(null)
  }

  // 캔버스 진입(마운트) 시 1회 — 원본이 외부에서 지워진 stale 프리뷰를 정리.
  useEffect(() => { void pruneMissing() }, [pruneMissing])

  // 캔버스에서 선택한 항목을 Delete/Backspace로 삭제. 입력창 포커스·큐레이션 모달 중엔 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (curateSlot) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size > 0) {
        e.preventDefault()
        const ids = [...sel]
        setSel(new Set())
        void removeResults(ids)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, curateSlot, removeResults])

  return (
    <div className="batch">
      <div className="batch-left" style={{ width: multiW }}>
        <div className="sub-tab-bar">
          <button className={sub === 'base' ? 'active' : ''} onClick={() => setPref({ multiSub: 'base' })}>{t('Base')}</button>
          <button className={sub === 'slot' ? 'active' : ''} onClick={() => setPref({ multiSub: 'slot' })}>{t('Slot')}</button>
        </div>
        {sub === 'base' && (
          <div className="base-actions">
            <button title={t("Copy the current Single tab settings (model, LoRAs, prompts, resolution…) into this character's base")}
              onClick={importBaseFromWorkbench}>{t('↧ Import Single settings')}</button>
          </div>
        )}
        <div className="batch-left-body">
          {sub === 'base' ? <ParamsPanel embedded /> : <BatchSlotPanel />}
        </div>
        {/* 생성 푸터 — Single과 동일하게 큐/진행 + Cancel을 위에 쌓고, Generate는 항상 맨 아래 고정 */}
        <div className="batch-footer">
          {(running || total > 0) && (
            <div className="queue-bar">
              <span className="queue-count">{t('Queued {done}/{total}', { done, total })}{running
                ? (progress && progress.promptId === activePromptId ? ` · ${progress.value}/${progress.max}` : '')
                : t(' · done')}</span>
              {running && (
                <button className="queue-btn danger" onClick={() => void stop()}
                  title={t('Cancel the batch (interrupts the current image and clears the queue)')}>{t('Cancel')}</button>
              )}
            </div>
          )}
          <button className="generate" onClick={start}>
            {running ? t('Add to queue') : t('Generate')} ({t('{slots} slots × {per} = {total}', { slots: activeSlots, per: countPerSlot, total: activeSlots * countPerSlot })})
          </button>
        </div>
      </div>

      <Resizer value={multiW} onChange={(w) => setPref({ multiW: w })} dir={1} min={300} max={720} />

      <div className="batch-right">
        {/* 2단 탭 헤더(캔버스 바로 위): 위=캐릭터, 아래=그 캐릭터의 캔버스(프리셋) 탭 */}
        <div className="tab-stack">
          <div className="char-tab-bar">
            {characters.map((c) => (
              <div key={c.id} className={`char-tab${c.id === activeCharId ? ' active' : ''}`}
                onClick={() => { if (c.id !== activeCharId) { setSel(new Set()); switchCharacter(c.id) } }}
                onDoubleClick={() => setEditing({ id: c.id, name: c.name })}>
                {editing?.id === c.id ? (
                  <input className="char-tab-edit" autoFocus value={editing.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null) }} />
                ) : (
                  <span className="char-tab-name" title={t('Double-click to rename')}>{c.name}</span>
                )}
                {characters.length > 1 && (
                  <button className="char-tab-close" title={t('Delete character')}
                    onClick={(e) => { e.stopPropagation(); if (confirm(t("Delete character '{name}'? (its tabs and results are removed too)", { name: c.name }))) removeCharacter(c.id) }}>✕</button>
                )}
              </div>
            ))}
            <button className="char-tab-new" title={t('Add character')} onClick={() => { setSel(new Set()); addCharacter() }}>{t('+ Character')}</button>
          </div>
          <div className="canvas-tab-bar">
            {charTabs.map((ct) => (
              <div key={ct.id} className={`canvas-tab${ct.id === activeTabId ? ' active' : ''}`}
                onClick={() => { setSel(new Set()); switchTab(ct.id) }}>
                <span className="canvas-tab-name">
                  {ct.name}{ct.id === runningTabId ? ' …' : ''}
                </span>
                {charTabs.length > 1 && (
                  <button className="canvas-tab-close" title={t('Close tab')}
                    onClick={(e) => { e.stopPropagation(); closeTab(ct.id) }}>✕</button>
                )}
              </div>
            ))}
            <button className="canvas-tab-new" title={t('New tab')} onClick={() => openNewTab()}>+</button>
          </div>
        </div>

        {/* 캔버스 영역(relative) — '선택됨' 바를 오버레이로 띄워 캔버스가 안 밀리게 한다. */}
        <div className="batch-canvas-area">
        {sel.size > 0 && (
          <div className="multi-bar">
            <span>{t('{n} selected', { n: sel.size })}</span>
            <button onClick={() => void deleteSel()}>{t('Delete selected')}</button>
            <button onClick={() => setSel(new Set())}>{t('Clear')}</button>
          </div>
        )}

        {slots.length === 0 ? (
          <div className="zoom-viewport" style={{ cursor: 'default' }}>
            <div className="placeholder" style={{ padding: 40 }}>
              {t('Set up the character/parameters in the Base tab, add per-slot prompts in the Slot tab, then generate.')}
            </div>
          </div>
        ) : (
          <BatchCanvas
            key={activeTabId}
            slots={slots}
            results={displayResults}
            selected={sel}
            onSelectionChange={setSel}
            aspect={aspect}
            activePromptId={activePromptId}
            initialViewport={viewports[activeTabId] as Viewport | undefined}
            onViewportChange={(vp) => setViewport(activeTabId, vp)}
            onCurate={setCurateSlot}
            slotStart={active?.slotStart ?? 1}
            onOpenFolder={() => {
              // 해당 캔버스의 캐릭터 폴더(출력폴더/캐릭터이름)를 연다.
              const base = outputFolder.trim() || 'PeroPixfy/Multi'
              const charFolder = sanitize(activeChar?.name ?? '')
              void openOutputFolder([base, charFolder].filter(Boolean).join('/'))
            }}
          />
        )}
        </div>
      </div>

      {curateSlot && <CurationModal slotId={curateSlot} aspect={aspect} onClose={() => setCurateSlot(null)} />}
    </div>
  )
}
