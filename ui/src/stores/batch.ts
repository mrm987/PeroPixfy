import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { checkFilesExist, deleteQueued, fetchOutputs, interrupt, parseViewUrl, submitPrompt, viewUrl } from '../api/comfy'
import { completeGeneration, deleteGeneration, failGeneration, recordGeneration } from '../api/gallery'
import * as presetApi from '../api/presets'
import { buildGraph } from '../workflow/builder'
import { ANIMA_DEFAULTS } from '../workflow/defaults'
import type { GenerationParams } from '../workflow/types'
import { useWorkbench } from './workbench'

const CONCURRENCY = 2

export interface Slot {
  id: string
  name: string // 파일 prefix 역할 (없으면 슬롯 번호로 자동)
  prompt: string
  locked: boolean // true = 생성에서 제외
  promptH?: number // 프롬프트 textarea 높이(px) — 사용자가 늘려둔 상태 기억
}

export interface SlotResult {
  id: string
  slotId: string
  slotIndex: number
  promptId: string | null
  seed: number | null
  status: 'idle' | 'queued' | 'done' | 'error'
  imageUrls: string[]
  // 큐에 넣는 시점에 고정한 생성 파라미터(seed 제외). 이후 슬롯을 수정해도 영향받지 않는다.
  req?: GenerationParams
}

// 캔버스 탭 = 한 프리셋(또는 무제) 작업 세션. 슬롯 목록과 생성 결과를 함께 보존한다.
// charId로 어느 캐릭터 소속인지 표시 — UI에서 활성 캐릭터의 탭만 보여준다.
export interface CanvasTab {
  id: string
  charId: string
  name: string
  presetFilename: string | null
  slots: Slot[]
  results: SlotResult[]
  promptInsert?: number // 슬롯 프롬프트를 base positive의 몇 번째 태그 자리에 끼울지. 미설정 = 최하단(끝).
  slotStart?: number // 이 탭 슬롯 번호 시작값(표시·파일명). 미설정 = 1.
}

// 캐릭터 = 외형/스타일을 고정하는 base 파라미터의 단위. 각 캐릭터별로 감정세트 등
// 여러 프리셋 탭을 두고 대량 생성한다. base는 Single(workbench)과 분리된 별도 데이터.
export interface Character {
  id: string
  name: string
  base: GenerationParams
}

export interface Viewport {
  x: number
  y: number
  scale: number
}

export type ImageFormat = 'png' | 'jpg' | 'webp'

const uid = () => Math.random().toString(36).slice(2, 10)
const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
const newSlot = (): Slot => ({ id: uid(), name: '', prompt: '', locked: false })
const newTab = (charId: string, name = 'New tab', presetFilename: string | null = null, slots?: Slot[]): CanvasTab => ({
  id: uid(), charId, name, presetFilename, slots: slots && slots.length ? slots : [newSlot()], results: [],
})
const newCharBase = (): GenerationParams => ({ ...ANIMA_DEFAULTS, mode: 't2i', loras: [] })
// 임의 params(예: Single 결과)를 캐릭터 base로 정규화 — Multi는 t2i 전용이라 소스/마스크 제거.
const baseFromParams = (p: GenerationParams): GenerationParams => ({ ...p, mode: 't2i', sourceImage: undefined, maskImage: undefined })
const charLabel = (n: number) => `char${String(n).padStart(2, '0')}`
const newCharacter = (name: string): Character => ({ id: uid(), name, base: newCharBase() })

const pad3 = (n: number) => String(n).padStart(3, '0')
export const sanitize = (s: string) => s.trim().replace(/[^\w\-가-힣]+/g, '_').replace(/^_+|_+$/g, '')

// base positive를 콤마·마침표 경계로 토큰화(각 토큰 = {텍스트, 뒤따르는 구분자}). 무손실:
// 토큰들의 text+delim 합치면 원본 그대로. Anima는 태그와 자연어를 마침표로 끊으므로
// 삽입 위치 선택과 병합 모두 마침표를 경계로 인식해야 한다.
export interface PromptToken { text: string; delim: string }
export function tokenizePrompt(base: string): PromptToken[] {
  const raw = (base || '').split(/([,.])/) // [text, delim, text, delim, ..., text]
  const toks: PromptToken[] = []
  for (let k = 0; k < raw.length; k += 2) toks.push({ text: raw[k] ?? '', delim: raw[k + 1] ?? '' })
  return toks
}

// insert번째 토큰 '앞'에 슬롯 프롬프트를 끼운다(insert 미설정=끝). 슬롯은 태그라 콤마로 잇되,
// 끼우는 경계의 원래 구분자(마침표면 마침표)는 슬롯 '뒤'로 보내 태그/자연어 구조를 보존한다.
export function mergePositive(base: string, add: string, insert?: number): string {
  const a = (add || '').trim()
  if (!a) return base
  if (!(base || '').trim()) return a
  const toks = tokenizePrompt(base)
  const n = toks.length
  const i = insert == null ? n : Math.max(0, Math.min(insert, n))
  if (i >= n) return `${base.replace(/[\s,.]*$/, '')}, ${a}` // 맨 끝
  if (i === 0) return `${a}, ${base.replace(/^\s+/, '')}` // 맨 앞
  const prev = toks.slice(0, i)
  const rest = toks.slice(i)
  const boundaryDelim = prev[prev.length - 1].delim || ',' // 끼우는 자리의 원래 구분자(마침표 보존)
  const leftStr = prev.map((t, k) => t.text + (k === prev.length - 1 ? '' : t.delim)).join('')
  const rightStr = rest.map((t) => t.text + t.delim).join('')
  const rightJoin = /^\s/.test(rightStr) ? rightStr : ` ${rightStr}`
  return `${leftStr.replace(/\s+$/, '')}, ${a}${boundaryDelim}${rightJoin}`
}

function slotCategory(slot: Slot | undefined, num: number, excludeNumber: boolean): string {
  const nm = sanitize(slot?.name || '')
  if (excludeNumber) return nm
  return nm ? `${pad3(num)}_${nm}` : pad3(num)
}

// 프리셋 목록을 사용자 지정 순서(presetOrder)로 정렬. 순서에 없는 건 이름순으로 뒤에.
export const sortPresets = (presets: presetApi.PresetSummary[], order: string[]): presetApi.PresetSummary[] => {
  const idx = new Map(order.map((f, i) => [f, i]))
  return [...presets].sort((a, b) => {
    const ia = idx.has(a.filename) ? idx.get(a.filename)! : Infinity
    const ib = idx.has(b.filename) ? idx.get(b.filename)! : Infinity
    return ia !== ib ? ia - ib : a.name.localeCompare(b.name)
  })
}

export const activeTabOf = (s: BatchState): CanvasTab | undefined => s.tabs.find((t) => t.id === s.activeTabId)
export const activeCharOf = (s: BatchState): Character | undefined => s.characters.find((c) => c.id === s.activeCharId)

interface BatchState {
  characters: Character[]
  activeCharId: string
  tabs: CanvasTab[]
  activeTabId: string
  activeTabByChar: Record<string, string> // 캐릭터별 마지막 활성 탭 기억
  viewports: Record<string, Viewport> // 탭별 캔버스 줌/위치 (탭 전환해도 유지)
  // 세션 설정 (영속)
  outputFolder: string
  format: ImageFormat
  quality: number
  countPerSlot: number
  excludeSlotNumber: boolean
  randomizeSeed: boolean // true=결과마다 시드 무작위, false=Base의 seed로 고정(재현용)
  // 프리셋 목록 / 실행
  presets: presetApi.PresetSummary[]
  presetOrder: string[] // 드롭다운 표시 순서(파일명). 사용자가 ↑↓로 변경.
  running: boolean
  runningTabId: string | null
  activePromptId: string | null // WS 진행률 기준 '지금 실제로 실행 중'인 프롬프트

  // 캐릭터
  addCharacter: () => void
  renameCharacter: (id: string, name: string) => void
  removeCharacter: (id: string) => void
  switchCharacter: (id: string) => void
  setCharBase: (patch: Partial<GenerationParams>) => void
  importBaseFromWorkbench: () => void
  setCharacterBase: (charId: string, params: GenerationParams) => void
  addCharacterFromParams: (params: GenerationParams) => void
  // 탭
  switchTab: (id: string) => void
  openNewTab: () => void
  closeTab: (id: string) => void
  setViewport: (tabId: string, vp: Viewport) => void
  // 슬롯 (활성 탭 대상)
  setPromptInsert: (index: number | null) => void
  setSlotStart: (n: number) => void
  addSlot: () => void
  updateSlot: (id: string, patch: Partial<Slot>) => void
  removeSlot: (id: string) => void
  duplicateSlot: (id: string) => void
  moveSlot: (id: string, dir: -1 | 1) => void
  reorderSlots: (from: number, to: number) => void // 드래그 reorder (인덱스 기반)
  setSetting: (patch: Partial<Pick<BatchState, 'outputFolder' | 'format' | 'quality' | 'countPerSlot' | 'excludeSlotNumber' | 'randomizeSeed'>>) => void
  // 프리셋
  loadPresetList: () => Promise<void>
  applyPreset: (filename: string) => Promise<void>
  overwritePreset: () => Promise<void> // 편집 자동저장(현재 탭 슬롯 → 프리셋 파일)
  duplicatePreset: () => Promise<void>
  duplicatePresetFile: (filename: string) => Promise<void> // 특정 프리셋 파일을 복제
  newPreset: (name: string) => Promise<void>
  movePreset: (filename: string, dir: -1 | 1) => void
  reorderPresets: (from: number, to: number) => void // 드롭다운 드래그 reorder
  renamePreset: (filename: string, name: string) => Promise<void>
  removePreset: (filename: string) => Promise<void>
  // 실행
  start: () => void
  stop: () => Promise<void>
  removeResults: (ids: string[]) => Promise<void>
  pruneMissing: () => Promise<void>
  onProgress: (promptId: string) => void
  onDone: (promptId: string) => Promise<void>
  onError: (promptId: string) => void
}

export const useBatch = create<BatchState>()(persist((set, get) => {
  // 활성 탭만 갱신하는 헬퍼.
  const patchActive = (fn: (t: CanvasTab) => Partial<CanvasTab>) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, ...fn(t) } : t)) }))
  // 특정 탭의 결과 하나를 갱신.
  const patchResult = (tabId: string, resId: string, patch: Partial<SlotResult>) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, results: t.results.map((r) => (r.id === resId ? { ...r, ...patch } : r)) } : t,
      ),
    }))

  const pump = async () => {
    const s = get()
    if (!s.running) return
    // 처리할 탭: 우선 runningTabId에 idle이 있으면 그 탭, 없으면 idle이 있는 아무 탭(여러 탭 대기열도 소진).
    let tab = s.tabs.find((t) => t.id === s.runningTabId && t.results.some((r) => r.status === 'idle'))
    if (!tab) tab = s.tabs.find((t) => t.results.some((r) => r.status === 'idle'))
    if (!tab) {
      // 어디에도 idle 없음. 진행 중(queued)도 없으면 종료.
      if (!s.tabs.some((t) => t.results.some((r) => r.status === 'queued'))) set({ running: false, runningTabId: null })
      return
    }
    if (tab.id !== s.runningTabId) set({ runningTabId: tab.id })
    const inFlight = tab.results.filter((r) => r.status === 'queued').length
    if (inFlight >= CONCURRENCY) return
    const next = tab.results.find((r) => r.status === 'idle')
    if (!next) return
    // 큐에 넣을 때 고정해둔 req(시드 포함)를 그대로 쓴다. req가 없으면(레거시) 현재 base + 랜덤 시드로 폴백.
    const params: GenerationParams = next.req ?? { ...(activeCharOf(s)?.base ?? useWorkbench.getState().params), seed: randomSeed() }
    patchResult(tab.id, next.id, { status: 'queued', seed: params.seed })
    try {
      const promptId = await submitPrompt(buildGraph(params))
      patchResult(tab.id, next.id, { promptId })
      await recordGeneration(promptId, params, 'multi')
    } catch {
      patchResult(tab.id, next.id, { status: 'error' })
    }
    pump()
  }

  const firstChar = newCharacter(charLabel(1))
  const firstTab = newTab(firstChar.id, 'New tab')

  return {
    characters: [firstChar],
    activeCharId: firstChar.id,
    tabs: [firstTab],
    activeTabId: firstTab.id,
    activeTabByChar: { [firstChar.id]: firstTab.id },
    viewports: {},
    outputFolder: 'PeroPixfy/Multi',
    format: 'png',
    quality: 95,
    countPerSlot: 1,
    excludeSlotNumber: false,
    randomizeSeed: true,
    presets: [],
    presetOrder: [],
    running: false,
    runningTabId: null,
    activePromptId: null,

    addCharacter: () =>
      set((s) => {
        const n = s.characters.length + 1
        const char = newCharacter(charLabel(n))
        const tab = newTab(char.id)
        return {
          characters: [...s.characters, char],
          activeCharId: char.id,
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
          activeTabByChar: { ...s.activeTabByChar, [char.id]: tab.id },
        }
      }),
    renameCharacter: (id, name) =>
      set((s) => ({ characters: s.characters.map((c) => (c.id === id ? { ...c, name } : c)) })),
    removeCharacter: (id) =>
      set((s) => {
        if (s.characters.length <= 1) return s // 마지막 캐릭터는 유지
        const i = s.characters.findIndex((c) => c.id === id)
        const characters = s.characters.filter((c) => c.id !== id)
        const tabs = s.tabs.filter((t) => t.charId !== id)
        const nextChar = characters[Math.max(0, i - 1)]
        const activeCharId = s.activeCharId === id ? nextChar.id : s.activeCharId
        const charTabs = tabs.filter((t) => t.charId === activeCharId)
        const activeTabId = s.tabs.find((t) => t.id === s.activeTabId && t.charId !== id)
          ? s.activeTabId
          : (s.activeTabByChar[activeCharId] && charTabs.some((t) => t.id === s.activeTabByChar[activeCharId])
              ? s.activeTabByChar[activeCharId]
              : charTabs[0]?.id ?? s.activeTabId)
        const activeTabByChar = { ...s.activeTabByChar }
        delete activeTabByChar[id]
        return { characters, tabs, activeCharId, activeTabId, activeTabByChar }
      }),
    switchCharacter: (id) =>
      set((s) => {
        if (!s.characters.some((c) => c.id === id)) return s
        const charTabs = s.tabs.filter((t) => t.charId === id)
        const remembered = s.activeTabByChar[id]
        const activeTabId = (remembered && charTabs.some((t) => t.id === remembered))
          ? remembered
          : charTabs[0]?.id ?? s.activeTabId
        return { activeCharId: id, activeTabId }
      }),
    setCharBase: (patch) =>
      set((s) => ({
        characters: s.characters.map((c) => (c.id === s.activeCharId ? { ...c, base: { ...c.base, ...patch } } : c)),
      })),
    // 현재 Single(workbench) 설정을 활성 캐릭터 base로 복사한다. Multi는 t2i 전용이라
    // 모드는 t2i로 고정하고 i2i/inpaint 전용 소스·마스크는 가져오지 않는다.
    importBaseFromWorkbench: () => {
      const wb = useWorkbench.getState().params
      set((s) => ({
        characters: s.characters.map((c) => (c.id === s.activeCharId ? { ...c, base: baseFromParams(wb) } : c)),
      }))
    },
    // 특정 캐릭터의 base를 주어진 params로 지정(Single 결과 → 캐릭터로 설정).
    setCharacterBase: (charId, params) =>
      set((s) => ({
        characters: s.characters.map((c) => (c.id === charId ? { ...c, base: baseFromParams(params) } : c)),
      })),
    // 주어진 params로 새 캐릭터를 만든다(활성 캐릭터는 그대로 — Single에서 호출).
    addCharacterFromParams: (params) =>
      set((s) => {
        const char: Character = { id: uid(), name: charLabel(s.characters.length + 1), base: baseFromParams(params) }
        const tab = newTab(char.id)
        return {
          characters: [...s.characters, char],
          tabs: [...s.tabs, tab],
          activeTabByChar: { ...s.activeTabByChar, [char.id]: tab.id },
        }
      }),

    switchTab: (id) =>
      set((s) => {
        if (!s.tabs.some((t) => t.id === id)) return s
        return { activeTabId: id, activeTabByChar: { ...s.activeTabByChar, [s.activeCharId]: id } }
      }),
    openNewTab: () =>
      set((s) => {
        const t = newTab(s.activeCharId)
        return { tabs: [...s.tabs, t], activeTabId: t.id, activeTabByChar: { ...s.activeTabByChar, [s.activeCharId]: t.id } }
      }),
    closeTab: (id) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id)
        if (!tab) return s
        const sibling = s.tabs.filter((t) => t.charId === tab.charId)
        if (sibling.length <= 1) return s // 캐릭터의 마지막 탭은 유지
        const i = sibling.findIndex((t) => t.id === id)
        const tabs = s.tabs.filter((t) => t.id !== id)
        const viewports = { ...s.viewports }
        delete viewports[id]
        const fallback = sibling[Math.max(0, i - 1)].id
        const activeTabId = s.activeTabId === id ? fallback : s.activeTabId
        return { tabs, activeTabId, viewports, activeTabByChar: { ...s.activeTabByChar, [tab.charId]: activeTabId } }
      }),
    setViewport: (tabId, vp) => set((s) => ({ viewports: { ...s.viewports, [tabId]: vp } })),

    setPromptInsert: (index) => patchActive(() => ({ promptInsert: index == null ? undefined : index })),
    setSlotStart: (n) => patchActive(() => ({ slotStart: Math.max(1, Math.floor(n) || 1) })),
    addSlot: () => patchActive((t) => ({ slots: [...t.slots, newSlot()] })),
    updateSlot: (id, patch) => patchActive((t) => ({ slots: t.slots.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    removeSlot: (id) => patchActive((t) => ({ slots: t.slots.length > 1 ? t.slots.filter((x) => x.id !== id) : t.slots })),
    duplicateSlot: (id) =>
      patchActive((t) => {
        const i = t.slots.findIndex((x) => x.id === id)
        if (i < 0) return {}
        const next = [...t.slots]
        next.splice(i + 1, 0, { ...t.slots[i], id: uid() })
        return { slots: next }
      }),
    moveSlot: (id, dir) =>
      patchActive((t) => {
        const i = t.slots.findIndex((x) => x.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= t.slots.length) return {}
        const next = [...t.slots]
        ;[next[i], next[j]] = [next[j], next[i]]
        return { slots: next }
      }),
    reorderSlots: (from, to) =>
      patchActive((t) => {
        if (from === to || from < 0 || to < 0 || from >= t.slots.length || to >= t.slots.length) return {}
        const next = [...t.slots]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return { slots: next }
      }),
    setSetting: (patch) => set(patch),

    loadPresetList: async () => {
      set({ presets: await presetApi.listPresets().catch(() => []) })
    },
    applyPreset: async (filename) => {
      // 활성 캐릭터에 이미 그 프리셋 탭이 열려 있으면 그 탭으로 복귀. 없으면 새 탭.
      const s0 = get()
      const existing = s0.tabs.find((t) => t.presetFilename === filename && t.charId === s0.activeCharId)
      if (existing) { get().switchTab(existing.id); return }
      const p = await presetApi.getPreset(filename)
      const slots = (p.slots ?? []).map((sl) => ({ id: uid(), name: sl.name, prompt: sl.prompt, locked: sl.locked, promptH: sl.promptH }))
      set((s) => {
        const tab = newTab(s.activeCharId, p.name, filename, slots)
        return { tabs: [...s.tabs, tab], activeTabId: tab.id, activeTabByChar: { ...s.activeTabByChar, [s.activeCharId]: tab.id } }
      })
    },
    // 편집 자동저장 — 현재 프리셋 탭의 슬롯을 그 프리셋 파일에 기록(BatchSlotPanel에서 디바운스 호출).
    overwritePreset: async () => {
      const tab = activeTabOf(get())
      if (!tab?.presetFilename) return
      const slots = tab.slots.map((s) => ({ name: s.name, prompt: s.prompt, locked: s.locked, promptH: s.promptH }))
      await presetApi.updatePreset(tab.presetFilename, tab.name, slots)
    },
    // 현재 프리셋을 복제 — 현재 슬롯으로 새 프리셋 파일을 만들고 그 탭을 연다.
    duplicatePreset: async () => {
      const tab = activeTabOf(get())
      if (!tab) return
      const slots = tab.slots.map((s) => ({ name: s.name, prompt: s.prompt, locked: s.locked, promptH: s.promptH }))
      const filename = await presetApi.createPreset(`${tab.name || 'preset'} copy`, slots)
      await get().loadPresetList()
      await get().applyPreset(filename)
    },
    // 특정 프리셋 파일을 복제(현재 탭과 무관) — 파일에서 슬롯을 읽어 사본 생성 후 연다.
    duplicatePresetFile: async (filename) => {
      const p = await presetApi.getPreset(filename)
      const slots = (p.slots ?? []).map((sl) => ({ name: sl.name, prompt: sl.prompt, locked: sl.locked, promptH: sl.promptH }))
      const nf = await presetApi.createPreset(`${p.name || 'preset'} copy`, slots)
      await get().loadPresetList()
      await get().applyPreset(nf)
    },
    // 빈 슬롯 1개짜리 새 프리셋을 만들고 연다.
    newPreset: async (name) => {
      const filename = await presetApi.createPreset(name, [{ name: '', prompt: '', locked: false }])
      await get().loadPresetList()
      await get().applyPreset(filename)
    },
    // 선택된 프리셋을 표시 순서에서 한 칸 이동.
    movePreset: (filename, dir) =>
      set((s) => {
        const ordered = sortPresets(s.presets, s.presetOrder).map((p) => p.filename)
        const i = ordered.indexOf(filename)
        const j = i + dir
        if (i < 0 || j < 0 || j >= ordered.length) return s
        const next = [...ordered]
        ;[next[i], next[j]] = [next[j], next[i]]
        return { presetOrder: next }
      }),
    reorderPresets: (from, to) =>
      set((s) => {
        const ordered = sortPresets(s.presets, s.presetOrder).map((p) => p.filename)
        if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) return s
        const next = [...ordered]
        const [m] = next.splice(from, 1)
        next.splice(to, 0, m)
        return { presetOrder: next }
      }),
    renamePreset: async (filename, name) => {
      const p = await presetApi.getPreset(filename)
      await presetApi.updatePreset(filename, name, p.slots)
      await get().loadPresetList()
      set((s) => ({ tabs: s.tabs.map((t) => (t.presetFilename === filename ? { ...t, name } : t)) }))
    },
    removePreset: async (filename) => {
      await presetApi.deletePreset(filename)
      await get().loadPresetList()
      // 프리셋이 사라진 탭은 무제 탭으로 전환(슬롯·결과는 유지).
      set((s) => ({ tabs: s.tabs.map((t) => (t.presetFilename === filename ? { ...t, presetFilename: null } : t)) }))
    },

    // 활성 탭의 잠그지 않은 슬롯을 큐에 '덧붙인다'(교체 아님 → 오른쪽으로 누적). 생성 중에도
    // 호출 가능. 각 결과는 이 시점의 base+슬롯 프롬프트를 req로 고정 → 이후 슬롯 수정과 무관.
    start: () => {
      const s = get()
      const tab = activeTabOf(s)
      const char = activeCharOf(s)
      if (!tab || !char) return
      const folder = s.outputFolder.trim() || 'PeroPixfy/Multi'
      const charFolder = sanitize(char.name) // 캐릭터별 하위 폴더 (출력폴더/캐릭터이름/슬롯)
      const additions: SlotResult[] = []
      const slotStart = tab.slotStart ?? 1
      tab.slots.forEach((slot, idx) => {
        if (slot.locked) return
        const cat = slotCategory(slot, slotStart + idx, s.excludeSlotNumber)
        const reqBase: GenerationParams = {
          ...char.base,
          positive: mergePositive(char.base.positive, slot.prompt ?? '', tab.promptInsert),
          filenamePrefix: [folder, charFolder, cat].filter(Boolean).join('/'),
          save: { format: s.format, quality: s.quality },
        }
        for (let r = 0; r < Math.max(1, s.countPerSlot); r++) {
          // 시드도 큐에 넣는 시점에 확정: 랜덤이면 결과마다 새 시드, 아니면 Base의 seed 고정.
          const seed = s.randomizeSeed ? randomSeed() : char.base.seed
          additions.push({ id: uid(), slotId: slot.id, slotIndex: idx, promptId: null, seed: null, status: 'idle', imageUrls: [], req: { ...reqBase, seed } })
        }
      })
      if (additions.length === 0) return
      set((st) => ({
        tabs: st.tabs.map((t) => (t.id === tab.id ? { ...t, results: [...t.results, ...additions] } : t)),
        running: true,
        runningTabId: st.runningTabId ?? tab.id,
      }))
      pump()
      pump()
    },

    stop: async () => {
      set({ running: false, activePromptId: null })
      // 모든 탭의 제출된 대기 프롬프트를 ComfyUI 큐에서 제거하고 현재 작업을 중단.
      const queued = get().tabs.flatMap((t) => t.results.filter((r) => r.status === 'queued' && r.promptId))
      if (queued.length > 0) {
        await deleteQueued(queued.map((r) => r.promptId!))
        await interrupt()
      }
      // 미완료(idle/queued) 결과는 모두 제거하고 완료된 것만 남긴다.
      set((s) => ({
        tabs: s.tabs.map((t) => ({ ...t, results: t.results.filter((r) => r.status === 'done') })),
        runningTabId: null,
      }))
    },

    removeResults: async (ids) => {
      const idset = new Set(ids)
      const promptIds: string[] = []
      for (const t of get().tabs) for (const r of t.results) if (idset.has(r.id) && r.promptId) promptIds.push(r.promptId)
      set((s) => ({ tabs: s.tabs.map((t) => ({ ...t, results: t.results.filter((r) => !idset.has(r.id)) })) }))
      await Promise.all(promptIds.map((id) => deleteGeneration(id)))
    },

    // 원본 파일이 외부에서 삭제된 done 결과(stale 프리뷰)를 솎아낸다. 캔버스 진입 시 1회.
    pruneMissing: async () => {
      const refs: { id: string; img: ReturnType<typeof parseViewUrl> }[] = []
      for (const t of get().tabs) {
        for (const r of t.results) {
          if (r.status === 'done' && r.imageUrls[0]) {
            const img = parseViewUrl(r.imageUrls[0])
            if (img) refs.push({ id: r.id, img })
          }
        }
      }
      if (refs.length === 0) return
      const exists = await checkFilesExist(refs.map((r) => r.img!)).catch(() => null)
      if (!exists) return
      const missing = refs.filter((_, i) => exists[i] === false).map((r) => r.id)
      if (missing.length) await get().removeResults(missing)
    },

    onProgress: (promptId) => {
      // 큐에 2개를 미리 넣어도 ComfyUI는 1개씩 실행한다. 지금 실제로 도는 프롬프트를
      // 기록해, 캔버스가 그것만 'generating…', 미리 제출된 건 'queued'로 표시하게 한다.
      if (get().tabs.some((t) => t.results.some((r) => r.promptId === promptId))) {
        set({ activePromptId: promptId })
      }
    },

    onDone: async (promptId) => {
      if (get().activePromptId === promptId) set({ activePromptId: null })
      const tab = get().tabs.find((t) => t.results.some((r) => r.promptId === promptId))
      if (!tab) return
      const outputs = await fetchOutputs(promptId)
      if (outputs && outputs.length > 0) await completeGeneration(promptId, outputs)
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tab.id
            ? { ...t, results: t.results.map((r) => (r.promptId === promptId ? { ...r, status: 'done' as const, imageUrls: (outputs ?? []).map(viewUrl) } : r)) }
            : t,
        ),
      }))
      pump()
    },

    onError: (promptId) => {
      if (get().activePromptId === promptId) set({ activePromptId: null })
      const tab = get().tabs.find((t) => t.results.some((r) => r.promptId === promptId))
      if (!tab) return
      failGeneration(promptId)
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tab.id ? { ...t, results: t.results.map((r) => (r.promptId === promptId ? { ...r, status: 'error' as const } : r)) } : t,
        ),
      }))
      pump()
    },
  }
}, {
  name: 'peropix.batch',
  version: 4,
  // 구버전(캐릭터 개념 이전) → 기본 캐릭터 하나에 기존 탭을 귀속시킨다.
  migrate: (persisted, version) => {
    const p = (persisted ?? {}) as Record<string, unknown>
    if (version < 2 || !Array.isArray(p.characters)) {
      const charId = uid()
      const tabsIn = Array.isArray(p.tabs) ? (p.tabs as CanvasTab[]) : []
      const tabs = tabsIn.map((t) => ({ ...t, charId, results: [] as SlotResult[] }))
      if (tabs.length === 0) tabs.push(newTab(charId))
      p.characters = [{ id: charId, name: charLabel(1), base: newCharBase() }]
      p.activeCharId = charId
      p.tabs = tabs
      p.activeTabId = tabs[0].id
      p.activeTabByChar = { [charId]: tabs[0].id }
      p.viewports = {}
    }
    // v3: 기본 출력 폴더 브랜드명 변경(PeroPix→PeroPixfy). 커스텀 값은 건드리지 않는다.
    if (version < 3 && p.outputFolder === 'PeroPix/Multi') p.outputFolder = 'PeroPixfy/Multi'
    // v4: 캔버스 초기 정렬을 좌상단으로 변경 — 옛 전체맞춤(중앙) 뷰포트를 1회 초기화해 재정렬.
    if (version < 4) p.viewports = {}
    return p as unknown as BatchState
  },
  // 슬롯/이름/프리셋/캐릭터 base + 완료된 결과를 보존(재실행해도 캔버스 유지).
  // 생성 중이던(idle/queued/error) 결과는 재실행 후 이어받을 수 없으므로 done만 남긴다.
  partialize: (s) => ({
    characters: s.characters,
    activeCharId: s.activeCharId,
    tabs: s.tabs.map((t) => ({
      ...t,
      // 완료 결과만 보존하고 큐 스냅샷(req)은 영속에서 제거(불필요 + 용량 절약).
      results: t.results.filter((r) => r.status === 'done').map(({ req: _req, ...rest }) => rest),
    })),
    activeTabId: s.activeTabId,
    activeTabByChar: s.activeTabByChar,
    viewports: s.viewports,
    outputFolder: s.outputFolder,
    format: s.format,
    quality: s.quality,
    countPerSlot: s.countPerSlot,
    excludeSlotNumber: s.excludeSlotNumber,
    randomizeSeed: s.randomizeSeed,
    presetOrder: s.presetOrder,
  }),
}))
