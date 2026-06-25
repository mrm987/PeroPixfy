import { useEffect, useRef, useState } from 'react'
import { openOutputFolder, parseViewUrl, uploadImage } from '../../api/comfy'
import { useT } from '../../i18n'
import { MaskEditor } from '../../components/MaskEditor'
import { Resizer } from '../../components/Resizer'
import { SaveStyleModal } from '../../components/SaveStyleModal'
import { useBatch } from '../../stores/batch'
import { useUi } from '../../stores/ui'
import { HISTORY_LIMIT, useWorkbench, type HistoryItem } from '../../stores/workbench'
import { ParamsPanel } from './ParamsPanel'

async function fetchAsBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob()
}

// 삭제로 비워진 파일 번호를 ComfyUI가 재사용하면 같은 /view URL에 새 내용이 들어간다.
// 생성별 고유 키(promptId)를 붙여, 브라우저가 옛(삭제된) 이미지를 캐시에서 보여주지
// 않고 그 생성의 실제 내용을 받아오게 한다. (imageUrls 원본은 그대로 둬 twin 비교 유지.)
const bust = (url: string, key: string) => `${url}&v=${encodeURIComponent(key)}`

export function WorkbenchTab() {
  const t = useT()
  const [maskTarget, setMaskTarget] = useState<string | null>(null)
  const [saveTarget, setSaveTarget] = useState<HistoryItem | null>(null)
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set())
  const [starredOnly, setStarredOnly] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null) // 현재 본 이미지의 실제 해상도
  const stripRef = useRef<HTMLDivElement>(null)
  const history = useWorkbench((s) => s.history)
  const selectedId = useWorkbench((s) => s.selectedId)
  const select = useWorkbench((s) => s.select)
  const restore = useWorkbench((s) => s.restore)
  const star = useWorkbench((s) => s.star)
  const remove = useWorkbench((s) => s.remove)
  const reloadHistory = useWorkbench((s) => s.reloadHistory)
  const set = useWorkbench((s) => s.set)
  const setNotice = useWorkbench((s) => s.setNotice)
  const characters = useBatch((s) => s.characters)
  const setCharacterBase = useBatch((s) => s.setCharacterBase)
  const addCharacterFromParams = useBatch((s) => s.addCharacterFromParams)
  const singleW = useUi((s) => s.singleW)
  const setPref = useUi((s) => s.setPref)

  // '캐릭터로 지정' 같은 동작 확인 문구는 잠깐만 띄우고 자동으로 거둔다(영구 잔류 방지).
  // 그 사이 다른 문구(예: 생성 시 미설치 LoRA 안내)로 바뀌었으면 건드리지 않도록, 현재
  // 문구가 방금 띄운 그 문구일 때만 지운다.
  const flashRef = useRef<{ msg: string; timer: number } | null>(null)
  const flashNotice = (msg: string) => {
    if (flashRef.current) clearTimeout(flashRef.current.timer)
    const timer = window.setTimeout(() => {
      if (useWorkbench.getState().notice === msg) setNotice(null)
      flashRef.current = null
    }, 4000)
    flashRef.current = { msg, timer }
    setNotice(msg)
  }

  const selected = history.find((h) => h.promptId === selectedId) ?? history[0]
  // 프리뷰 리스트·전환은 이 목록 기준 (별표 필터 적용 시 별표한 것만).
  const visible = starredOnly ? history.filter((h) => h.starred) : history

  // 프리뷰 전환: 현재 선택에서 steps만큼 이동 (history는 최신순이라 +가 더 오래된 쪽).
  const navigate = (steps: number) => {
    if (visible.length === 0 || steps === 0) return
    const i = visible.findIndex((h) => h.promptId === selected?.promptId)
    const next = i < 0 ? 0 : Math.min(Math.max(i + steps, 0), visible.length - 1)
    if (visible[next] && visible[next].promptId !== selected?.promptId) select(visible[next].promptId)
  }

  // 큰 프리뷰에서 휠로 전/후 이미지 전환. 휠 이벤트 1건 = 1장(델타 크기는 무시하고
  // 부호만 사용). 표준 마우스는 물리 한 틱 = 이벤트 1건이라 한 틱에 한 장씩 넘어가고,
  // 드르륵 빠르게 굴리면 이벤트가 여러 번 발생해 그만큼 여러 장 넘어간다.
  const onPreviewWheel = (e: React.WheelEvent) => {
    if (e.deltaY === 0) return
    // 이미지 전환을 시작하면 = 이미지를 관리하려는 것 → 입력란 포커스를 풀어, 이어지는
    // Delete가 프롬프트가 아니라 선택한 이미지에 적용되게 한다.
    const el = document.activeElement as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.blur()
    navigate(e.deltaY > 0 ? 1 : -1)
  }

  // 삭제. 보고 있던 이미지가 삭제 대상이면 선택을 오른쪽(더 오래된, idx+1)으로 옮기고,
  // 오른쪽이 없으면 왼쪽(더 최신)으로 옮긴다. 제거 전에 선택을 먼저 옮겨야 remove가
  // selectedId를 null로 만들지 않아 깜빡임이 없다.
  const removeMany = async (ids: string[]) => {
    if (ids.length === 0) return
    const idset = new Set(ids)
    if (selected && idset.has(selected.promptId)) {
      const i = visible.findIndex((h) => h.promptId === selected.promptId)
      const right = i >= 0 ? visible.slice(i + 1).find((h) => !idset.has(h.promptId)) : undefined
      const left = i >= 0 ? [...visible.slice(0, i)].reverse().find((h) => !idset.has(h.promptId)) : undefined
      const next = right ?? left ?? visible.find((h) => !idset.has(h.promptId))
      if (next) select(next.promptId)
    }
    setMultiSel(new Set())
    // 리스트가 가득 차 있었으면(limit 도달), 삭제 후 안 보이던 더 오래된 기록을 채운다.
    const wasFull = history.length >= HISTORY_LIMIT
    await Promise.all(ids.map((id) => remove(id)))
    if (wasFull) await reloadHistory()
  }

  // 다중선택이 있으면 그것들을, 없으면 현재 보고 있는 것을 지운다.
  const deleteSelected = () =>
    removeMany(multiSel.size > 0 ? [...multiSel] : selected ? [selected.promptId] : [])

  // 프리뷰 보는 중 키보드: ←/→ 전환, Delete 삭제. 입력란/모달에선 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (maskTarget || saveTarget) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); navigate(1) }
      else if (e.key === 'Delete') { e.preventDefault(); void deleteSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, selected, multiSel, maskTarget, saveTarget])

  // 선택 이미지가 바뀌면 그 썸네일이 보이도록 리스트를 가로로 스마트 스크롤한다.
  // 이미 보이면 nearest라 움직이지 않고, 벗어났을 때만 최소한으로 스크롤한다.
  useEffect(() => {
    setDims(null) // 선택이 바뀌면 해상도 초기화 — 새 이미지 onLoad에서 다시 채움
    const el = stripRef.current?.querySelector('.history-thumb.active') as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [selected?.promptId])

  // 다른 이미지를 선택하면 방금 띄운 확인 문구를 거둔다(현재 문구가 그 문구일 때만).
  useEffect(() => {
    const f = flashRef.current
    if (!f) return
    if (useWorkbench.getState().notice === f.msg) setNotice(null)
    clearTimeout(f.timer)
    flashRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // 프리뷰 리스트 클릭: Ctrl/⌘+클릭은 다중선택 토글, 일반 클릭은 보기 전환.
  const onThumbClick = (e: React.MouseEvent, promptId: string) => {
    if (e.ctrlKey || e.metaKey) {
      setMultiSel((prev) => {
        const next = new Set(prev)
        // 빈 상태에서 다른 이미지를 Ctrl+클릭하면 현재 보던 것까지 함께 선택한다.
        if (next.size === 0 && selected && selected.promptId !== promptId) {
          next.add(selected.promptId)
        }
        if (next.has(promptId)) next.delete(promptId)
        else next.add(promptId)
        return next
      })
      select(promptId) // 큰 프리뷰는 방금(마지막에) 클릭한 것으로 전환
    } else {
      setMultiSel(new Set())
      select(promptId)
    }
  }

  const sendToI2i = async (imageUrl: string) => {
    const name = await uploadImage(await fetchAsBlob(imageUrl), `peropix_i2i_${Date.now()}.png`)
    set({ mode: 'i2i', sourceImage: name, maskImage: undefined }) // 새 소스 → 이전 마스크 제거
  }

  const applyMask = async (blob: Blob) => {
    if (!maskTarget) return
    const stamp = Date.now()
    const [sourceImage, maskImage] = await Promise.all([
      uploadImage(await fetchAsBlob(maskTarget), `peropix_inpaint_src_${stamp}.png`),
      uploadImage(blob, `peropix_inpaint_mask_${stamp}.png`),
    ])
    set({ mode: 'inpaint', sourceImage, maskImage })
    setMaskTarget(null)
  }

  return (
    <div className="workbench">
      <ParamsPanel width={singleW} />
      <Resizer value={singleW} onChange={(w) => setPref({ singleW: w })} dir={1} min={300} max={720} />
      <div className="result-area">
        <div className="result-main" onWheel={onPreviewWheel}>
          {selected?.status === 'done' && selected.imageUrls.length > 0 ? (
            <img src={bust(selected.imageUrls[0], selected.promptId)} alt="result"
              onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          ) : selected?.status === 'pending' ? (
            <div className="placeholder">{t('Generating…')}</div>
          ) : selected?.status === 'error' ? (
            <div className="placeholder error">{t('Generation failed')}</div>
          ) : (
            <div className="placeholder">{t('Results will appear here')}</div>
          )}
        </div>
        {selected && (
          <div className="result-meta">
            <button onClick={() => restore(selected.params)} title={t("Load this result's settings back into the panel")}>
              {t('Reuse settings')}
            </button>
            <select className="set-char-select" value=""
              title={t("Set this result's settings as a Multi character's base")}
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                if (v === '__new__') {
                  addCharacterFromParams(selected.params)
                  flashNotice(t('Applied these settings to a new character (char{n}).', { n: String(characters.length + 1).padStart(2, '0') }))
                } else {
                  setCharacterBase(v, selected.params)
                  flashNotice(t("Applied these settings to '{name}'.", { name: characters.find((c) => c.id === v)?.name ?? '' }))
                }
                e.currentTarget.value = ''
              }}>
              <option value="">{t('⮕ Set as char ▾')}</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new__">{t('+ New character')}</option>
            </select>
            {selected.imageUrls[0] && (
              <>
                <button onClick={() => setSaveTarget(selected)}
                  title={t("Save this result's model, prompts and LoRA stack as a style")}>{t('Save as style')}</button>
                <button onClick={() => sendToI2i(selected.imageUrls[0])}>{t('To I2I')}</button>
                <button onClick={() => setMaskTarget(selected.imageUrls[0])}>{t('Inpaint')}</button>
              </>
            )}
            <button title={t('Open the folder containing this image')}
              onClick={() => {
                const img = selected.imageUrls[0] ? parseViewUrl(selected.imageUrls[0]) : undefined
                void openOutputFolder(img && (img.subfolder ? `${img.subfolder}/${img.filename}` : img.filename))
              }}>{t('📂 Folder')}</button>
            <button onClick={() => void removeMany([selected.promptId])} title={t('Remove from history')}>
              {t('Delete')}
            </button>
            <button className={`star-filter${starredOnly ? ' active' : ''}`}
              title={t('Show starred images only')}
              onClick={() => {
                const next = !starredOnly
                setStarredOnly(next)
                // 켤 때 현재 보고 있는 게 별표가 아니면 첫 별표 이미지로 이동.
                if (next && selected && !selected.starred) {
                  const first = history.find((h) => h.starred)
                  if (first) select(first.promptId)
                }
              }}>
              {starredOnly ? t('★ Starred') : t('☆ All')}
            </button>
            {/* 길이가 변하는 시드·해상도는 맨 뒤로 — 뒤에 밀릴 게 없어 버튼들이 고정된다. */}
            <span className="seed">{t('seed {n}', { n: selected.params.seed })}</span>
            <span className="res-tag">{dims?.w ?? selected.params.width} × {dims?.h ?? selected.params.height}</span>
          </div>
        )}
        {multiSel.size > 0 && (
          <div className="multi-bar">
            <span>{t('{n} selected', { n: multiSel.size })}</span>
            <button onClick={() => void deleteSelected()}>{t('Delete selected')}</button>
            <button onClick={() => setMultiSel(new Set())}>{t('Clear')}</button>
          </div>
        )}
        {visible.length > 0 ? (
          <div className="history-strip" ref={stripRef}
            onWheel={(e) => { if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY }}>
            {visible.map((h) => (
              <button key={h.promptId}
                className={`history-thumb${h.promptId === selected?.promptId ? ' active' : ''}${multiSel.has(h.promptId) ? ' multi' : ''}`}
                onClick={(e) => onThumbClick(e, h.promptId)}
                title={t('seed {n} · Ctrl+click to multi-select', { n: h.params.seed })}>
                {h.status === 'done' && h.imageUrls[0] ? (
                  <img src={bust(h.imageUrls[0], h.promptId)} alt="" />
                ) : (
                  <span>{h.status === 'pending' ? '…' : '✕'}</span>
                )}
                <span className={`thumb-star${h.starred ? ' on' : ''}`} title={t('Star')}
                  onClick={(e) => { e.stopPropagation(); void star(h.promptId) }}>
                  {h.starred ? '★' : '☆'}
                </span>
              </button>
            ))}
          </div>
        ) : starredOnly && history.length > 0 ? (
          <div className="strip-empty">{t('No starred images')}</div>
        ) : null}
        {maskTarget && (
          <MaskEditor imageUrl={maskTarget} onApply={applyMask} onClose={() => setMaskTarget(null)} />
        )}
        {saveTarget && (
          <SaveStyleModal item={saveTarget} onClose={() => setSaveTarget(null)} />
        )}
      </div>
    </div>
  )
}
