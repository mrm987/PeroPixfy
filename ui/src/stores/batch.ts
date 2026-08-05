import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { checkFilesExist, deleteQueued, fetchOutputs, interrupt, parseViewUrl, submitPrompt, viewUrl } from '../api/comfy'
import { completeGeneration, deleteGeneration, failGeneration, recordGeneration } from '../api/gallery'
import * as presetApi from '../api/presets'
import { resolveWildcards } from '../tags/wildcards'
import { buildGraph, resolveUpscaleModel } from '../workflow/builder'
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
  slotStart?: number // 이 탭 슬롯 번호 시작값(표시·파일명). 미설정 = 1.
  unseen?: boolean // 비활성 탭에서 생성이 완료됐지만 아직 열어보지 않음 → 탭에 dot 표시. 전환 시 해제.
  // 프리셋 탭을 '닫으면' 삭제하지 않고 숨겨 보존한다(완료 결과·뷰포트 유지) — 같은 프리셋을
  // 다시 열면 이 탭을 복원해 프리뷰가 살아난다. 무제 탭은 닫을 때 완전 삭제(플래그 미사용).
  closed?: boolean
}

// 캐릭터 = 외형/스타일을 고정하는 base 파라미터의 단위. 각 캐릭터별로 감정세트 등
// 여러 프리셋 탭을 두고 대량 생성한다. base는 Single(workbench)과 분리된 별도 데이터.
export interface Character {
  id: string
  name: string
  base: GenerationParams
  // Single과 동일한 자동 트리거워드 기능(로라 트리거를 뱃지로 관리 → base.triggers에 동기화 →
  // 빌더가 base.positive의 @triggers 자리에 삽입). 캐릭터별로 독립. 기존 캐릭터(undefined)는 off로 취급.
  triggerBadges?: boolean
  triggerOrder?: string[] // 트리거 뱃지 표시/삽입 순서(사용자 드래그)
  // 프리셋 한정 base 프롬프트 변형 — { 프리셋 파일명: 텍스트 }. 있으면 그 프리셋 탭의 생성에서
  // base 대신 사용(예: SFW 프리셋만 옷 입은 프롬프트). 없는 프리셋은 base(all).
  // 포지티브·네거티브는 서로 독립 — 한쪽만 만들 수도, 각각 지울 수도 있다.
  positiveOverrides?: Record<string, string>
  negativeOverrides?: Record<string, string>
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
// 지정 탭을 '봤음'으로 표시(미확인 dot 해제). 탭/캐릭터 전환 시 새로 활성화되는 탭에 적용.
const markSeen = (tabs: CanvasTab[], id: string): CanvasTab[] =>
  tabs.map((t) => (t.id === id && t.unseen ? { ...t, unseen: false } : t))
// 아무것도 손대지 않은 무제 탭(프리셋 미연결·결과 없음·슬롯 전부 빈칸)인가 — 프리셋을 열 때
// 이런 탭은 새 탭을 만드는 대신 그 자리를 프리셋으로 대체한다(빈 New tab 잔류 방지).
const isPristineTab = (t: CanvasTab): boolean =>
  !t.presetFilename && t.results.length === 0 && t.slots.every((sl) => !sl.name.trim() && !sl.prompt.trim())
const newCharBase = (): GenerationParams => ({ ...ANIMA_DEFAULTS, mode: 't2i', loras: [] })
// positive 끝에 @triggers 토큰을 보장(이미 있으면 그대로). 트리거 관리 on일 때 삽입 자리 표시.
const withTriggerToken = (p: string): string => {
  if (/@triggers/i.test(p)) return p
  const s = (p || '').replace(/[\s,]+$/, '')
  return s ? s + ', @triggers' : '@triggers'
}
const withoutTriggerToken = (p: string): string =>
  (p || '').replace(/@triggers/gi, '').replace(/,\s*,/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '')
// 프리셋 한정 변형도 base와 같은 토큰 상태로 맞춘다(on이면 토큰 보장, off면 제거).
const syncOverrideTokens = (m: Record<string, string> | undefined, on: boolean) =>
  m ? Object.fromEntries(Object.entries(m).map(([f, p]) => [f, (on ? withTriggerToken : withoutTriggerToken)(p)])) : m
// 임의 params(예: Single 결과)를 캐릭터로 정규화 — Multi는 t2i 전용이라 소스/마스크 제거.
// ★트리거 칩 상태를 그대로 승계한다. Single 기록의 positive는 트리거워드가 이미 치환된 평문이고,
// 토큰 원형(#와일드카드 원문 포함)은 positiveTemplate에 따로 있다 — 토큰이 있는 쪽을 base.positive로
// 쓰고 뱃지 기능도 켠다. 평문만 옮기던 예전 방식은 트리거워드가 본문에 텍스트로 박힌 채 남고,
// 받는 캐릭터의 뱃지가 켜져 있으면 빌더가 끝에 한 번 더 붙여 중복됐다.
// 토큰이 어디에도 없으면(=싱글에서 트리거 관리 off) 평문 그대로 두고 뱃지도 off.
const charFromParams = (
  p: GenerationParams,
  fallbackOrder?: string[],
): Pick<Character, 'base' | 'triggerBadges' | 'triggerOrder'> => {
  const { positiveTemplate, triggerOrder, ...rest } = p // 기록 전용 필드는 캐릭터 base에 남기지 않는다
  const tokenized = /@triggers/i.test(rest.positive)
    ? rest.positive
    : positiveTemplate && /@triggers/i.test(positiveTemplate)
      ? positiveTemplate
      : null
  const triggers = rest.triggers ?? []
  return {
    base: {
      ...rest, mode: 't2i', sourceImage: undefined, maskImage: undefined,
      positive: tokenized ?? withoutTriggerToken(rest.positive),
      triggers: tokenized ? triggers : [],
    },
    triggerBadges: !!tokenized,
    triggerOrder: tokenized ? (triggerOrder ?? fallbackOrder ?? triggers.map((w) => w.toLowerCase())) : [],
  }
}
const charLabel = (n: number) => `char${String(n).padStart(2, '0')}`
// 새 캐릭터는 Single처럼 자동 트리거 기능을 켠 채로 시작(@triggers 토큰 보장).
const newCharacter = (name: string): Character => {
  const base = newCharBase()
  return { id: uid(), name, base: { ...base, positive: withTriggerToken(base.positive) }, triggerBadges: true, triggerOrder: [] }
}

const pad3 = (n: number) => String(n).padStart(3, '0')
export const sanitize = (s: string) => s.trim().replace(/[^\w\-가-힣]+/g, '_').replace(/^_+|_+$/g, '')

// 슬롯 프롬프트 삽입 — base positive의 @slot 토큰 자리에 치환(@triggers와 동일 방식, 칩으로 이동).
// 토큰이 없으면 끝에 콤마로 덧붙인다(기본). 슬롯이 비면 토큰만 빼고 남는 콤마를 정리.
export const SLOT_RE = /@slot/i
export const withSlotToken = (p: string): string => {
  if (SLOT_RE.test(p)) return p
  const s = (p || '').replace(/[\s,]+$/, '')
  return s ? s + ', @slot' : '@slot'
}
export function insertSlotPrompt(base: string, add: string): string {
  const a = (add || '').trim()
  if (SLOT_RE.test(base)) {
    return base.replace(SLOT_RE, a).replace(/[^\S\n]*,[^\S\n]*,[^\S\n]*/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '')
  }
  if (!a) return base
  if (!(base || '').trim()) return a
  return `${base.replace(/[\s,.]*$/, '')}, ${a}`
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
  slotCollapsed: Record<string, boolean> // 슬롯 접힘 상태(slotId→true). UI 상태(프리셋 파일엔 저장 안 함).
  pvSelByChar: Record<string, string> // Base Positive 변형 칩 선택(charId → 'all'|프리셋 파일명). 패널 언마운트에도 유지.
  nvSelByChar: Record<string, string> // Base Negative 변형 칩 선택 — 포지티브와 독립.
  // 프리셋 목록 / 실행
  presets: presetApi.PresetSummary[]
  presetOrder: string[] // 드롭다운 표시 순서(파일명). 사용자가 ↑↓로 변경.
  running: boolean
  runningTabId: string | null
  activePromptId: string | null // WS 진행률 기준 '지금 실제로 실행 중'인 프롬프트
  progress: { promptId: string; value: number; max: number } | null // 현재 실행 프롬프트의 step 진행률(Multi 전용 — Single과 분리)

  // 캐릭터
  addCharacter: () => void
  renameCharacter: (id: string, name: string) => void
  removeCharacter: (id: string) => void
  switchCharacter: (id: string) => void
  setCharBase: (patch: Partial<GenerationParams>) => void
  setCharTriggerBadges: (on: boolean) => void // 활성 캐릭터 자동 트리거 on/off (@triggers 토큰 관리)
  setCharTriggerOrder: (order: string[]) => void // 활성 캐릭터 트리거 뱃지 순서
  setCharPositiveOverride: (filename: string, positive: string) => void // 활성 캐릭터의 프리셋 한정 positive 생성/수정
  setCharNegativeOverride: (filename: string, negative: string) => void // 활성 캐릭터의 프리셋 한정 negative 생성/수정
  removeCharPositiveOverride: (filename: string) => void // positive 변형만 삭제 → 그 프리셋의 포지티브는 다시 all
  removeCharNegativeOverride: (filename: string) => void // negative 변형만 삭제 → 그 프리셋의 네거티브는 다시 all
  setPosVariantSel: (v: string) => void // 활성 캐릭터의 포지티브 변형 칩 선택 기억
  setNegVariantSel: (v: string) => void // 활성 캐릭터의 네거티브 변형 칩 선택 기억
  importBaseFromWorkbench: () => void
  setCharacterBase: (charId: string, params: GenerationParams) => void
  addCharacterFromParams: (params: GenerationParams) => void
  // 탭
  switchTab: (id: string) => void
  openNewTab: () => void
  closeTab: (id: string) => void
  setViewport: (tabId: string, vp: Viewport) => void
  // 슬롯 (활성 탭 대상)
  setSlotStart: (n: number) => void
  addSlot: () => void
  updateSlot: (id: string, patch: Partial<Slot>) => void
  removeSlot: (id: string) => void
  duplicateSlot: (id: string) => void
  moveSlot: (id: string, dir: -1 | 1) => void
  reorderSlots: (from: number, to: number) => void // 드래그 reorder (인덱스 기반)
  setAllSlotsLocked: (locked: boolean) => void // 활성 탭 전체 슬롯 잠금/해제 (locked=생성 제외)
  setSetting: (patch: Partial<Pick<BatchState, 'outputFolder' | 'format' | 'quality' | 'countPerSlot' | 'excludeSlotNumber' | 'randomizeSeed'>>) => void
  toggleSlotCollapsed: (id: string) => void
  setSlotsCollapsed: (ids: string[], collapsed: boolean) => void
  // 프리셋
  loadPresetList: () => Promise<void>
  applyPreset: (filename: string) => Promise<void>
  overwritePreset: () => Promise<void> // 편집 자동저장(현재 탭 슬롯 → 프리셋 파일)
  refreshPresetTabs: (charId: string) => Promise<void> // 진입 캐릭터의 프리셋 탭을 파일 최신 내용으로 갱신(캐릭터 간 동기화)
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
  onProgress: (promptId: string, value?: number, max?: number) => void
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
      // 큐에 넣을 때 고정한 req는 그 시점 base의 사본이라, 활성이 아닌 캐릭터의 base처럼
      // 업스케일 모델이 비어 있는 경우가 있다. 제출 직전에 설치된 모델로 맞춘다.
      const graphParams = resolveUpscaleModel(params, useWorkbench.getState().availableUpscalers)
      const promptId = await submitPrompt(buildGraph(graphParams))
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
    slotCollapsed: {},
    pvSelByChar: {},
    nvSelByChar: {},
    presets: [],
    presetOrder: [],
    running: false,
    runningTabId: null,
    activePromptId: null,
    progress: null,

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
        const charTabs = tabs.filter((t) => t.charId === activeCharId && !t.closed)
        const activeTabId = s.tabs.find((t) => t.id === s.activeTabId && t.charId !== id)
          ? s.activeTabId
          : (s.activeTabByChar[activeCharId] && charTabs.some((t) => t.id === s.activeTabByChar[activeCharId])
              ? s.activeTabByChar[activeCharId]
              : charTabs[0]?.id ?? s.activeTabId)
        const activeTabByChar = { ...s.activeTabByChar }
        delete activeTabByChar[id]
        return { characters, tabs, activeCharId, activeTabId, activeTabByChar }
      }),
    switchCharacter: async (id) => {
      const s0 = get()
      if (!s0.characters.some((c) => c.id === id)) return
      // 떠나는 프리셋 탭의 편집을 파일에 flush — 디바운스(600ms) 저장 전에 전환하면 취소되어 유실되고,
      // 다른 캐릭터의 동일 프리셋 탭이 옛 내용으로 남기 때문. (진입 시 항상 파일에서 갱신하므로 떠나는
      // 탭은 늘 최신/편집본이라 stale 덮어쓰기 위험이 없다.)
      const leaving = activeTabOf(s0)
      const flush = leaving?.presetFilename
        ? presetApi.updatePreset(leaving.presetFilename, leaving.name,
            leaving.slots.map((sl) => ({ name: sl.name, prompt: sl.prompt, locked: sl.locked, promptH: sl.promptH }))).catch(() => {})
        : Promise.resolve()
      // 즉시 전환(UI 반응성) 후, flush 완료를 기다렸다가 진입 캐릭터 프리셋 탭을 파일 최신 내용으로 갱신.
      const charTabs = s0.tabs.filter((t) => t.charId === id && !t.closed)
      const remembered = s0.activeTabByChar[id]
      const activeTabId = (remembered && charTabs.some((t) => t.id === remembered))
        ? remembered
        : charTabs[0]?.id ?? s0.activeTabId
      set((s) => ({ activeCharId: id, activeTabId, tabs: markSeen(s.tabs, activeTabId) }))
      await flush
      await get().refreshPresetTabs(id)
    },
    // 진입 캐릭터의 프리셋 연동 탭을 파일 최신 내용으로 갱신한다(여러 캐릭터가 같은 프리셋을 쓸 때
    // 한쪽 수정이 다른 쪽에 반영되게). 슬롯 내용(name/prompt/locked)만 인덱스로 매칭해 갱신하고 슬롯
    // id는 보존한다 — 결과(생성 이미지)가 slotId로 묶여 있어 id가 바뀌면 이미지가 유실되기 때문.
    refreshPresetTabs: async (charId) => {
      const linked = get().tabs.filter((t) => t.charId === charId && t.presetFilename)
      const filenames = [...new Set(linked.map((t) => t.presetFilename!))]
      if (filenames.length === 0) return
      const entries = await Promise.all(
        filenames.map(async (fn) => {
          try { return [fn, await presetApi.getPreset(fn)] as const } catch { return [fn, null] as const }
        }),
      )
      const byFile = new Map<string, presetApi.PresetData>()
      for (const [fn, p] of entries) if (p) byFile.set(fn, p)
      if (byFile.size === 0) return
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.charId !== charId || !t.presetFilename) return t
          const p = byFile.get(t.presetFilename)
          if (!p) return t
          const fileSlots = p.slots ?? []
          // 인덱스 매칭: 겹치는 범위는 내용만 갱신하고 id 보존, 파일이 더 길면 새 슬롯 추가.
          const synced: Slot[] = fileSlots.map((fsl, i) => {
            const ex = t.slots[i]
            // 내용(name/prompt/promptH)만 동기화. 잠금(locked)은 생성 제외용 세션 상태라 파일에서
            // 덮어쓰지 않는다 — 기존 슬롯은 현재 잠금 유지, 새로 생기는 슬롯은 해제로 시작.
            return ex
              ? { ...ex, name: fsl.name, prompt: fsl.prompt, promptH: fsl.promptH }
              : { id: uid(), name: fsl.name, prompt: fsl.prompt, locked: false, promptH: fsl.promptH }
          })
          // 파일보다 많은 나머지 탭 슬롯: 생성된 이미지가 있으면 보존(이미지 삭제 방지), 없으면 정리.
          const extras = t.slots.slice(fileSlots.length).filter((sl) => t.results.some((r) => r.slotId === sl.id))
          const slots = [...synced, ...extras]
          return { ...t, name: p.name, slots: slots.length ? slots : t.slots }
        }),
      }))
    },
    setCharBase: (patch) =>
      set((s) => ({
        characters: s.characters.map((c) => (c.id === s.activeCharId ? { ...c, base: { ...c.base, ...patch } } : c)),
      })),
    // 활성 캐릭터 자동 트리거 on/off. Single과 동일하게 base.positive의 @triggers 토큰을 관리하고,
    // off 시 base.triggers를 비운다(빌더가 아무것도 삽입 안 하게). 프리셋 한정 변형도 같이 맞춘다.
    setCharTriggerBadges: (on) =>
      set((s) => ({
        characters: s.characters.map((c) => {
          if (c.id !== s.activeCharId) return c
          const patch = on ? withTriggerToken : withoutTriggerToken
          const positiveOverrides = syncOverrideTokens(c.positiveOverrides, on)
          return { ...c, triggerBadges: on, positiveOverrides, base: { ...c.base, positive: patch(c.base.positive), triggers: on ? c.base.triggers : [] } }
        }),
      })),
    // 프리셋 한정 프롬프트 변형 — 활성 캐릭터의 { 프리셋 파일명: 텍스트 } 맵을 생성/수정·삭제.
    setCharPositiveOverride: (filename, positive) =>
      set((s) => ({
        characters: s.characters.map((c) =>
          c.id === s.activeCharId ? { ...c, positiveOverrides: { ...c.positiveOverrides, [filename]: positive } } : c),
      })),
    setCharNegativeOverride: (filename, negative) =>
      set((s) => ({
        characters: s.characters.map((c) =>
          c.id === s.activeCharId ? { ...c, negativeOverrides: { ...c.negativeOverrides, [filename]: negative } } : c),
      })),
    removeCharPositiveOverride: (filename) =>
      set((s) => ({
        characters: s.characters.map((c) => {
          if (c.id !== s.activeCharId || !c.positiveOverrides || !(filename in c.positiveOverrides)) return c
          const { [filename]: _x, ...rest } = c.positiveOverrides
          return { ...c, positiveOverrides: rest }
        }),
      })),
    removeCharNegativeOverride: (filename) =>
      set((s) => ({
        characters: s.characters.map((c) => {
          if (c.id !== s.activeCharId || !c.negativeOverrides || !(filename in c.negativeOverrides)) return c
          const { [filename]: _x, ...rest } = c.negativeOverrides
          return { ...c, negativeOverrides: rest }
        }),
      })),
    setPosVariantSel: (v) =>
      set((s) => ({ pvSelByChar: { ...s.pvSelByChar, [s.activeCharId]: v } })),
    setNegVariantSel: (v) =>
      set((s) => ({ nvSelByChar: { ...s.nvSelByChar, [s.activeCharId]: v } })),
    setCharTriggerOrder: (order) =>
      set((s) => ({
        characters: s.characters.map((c) => (c.id === s.activeCharId ? { ...c, triggerOrder: order } : c)),
      })),
    // 현재 Single(workbench) 설정을 활성 캐릭터 base로 복사한다. Multi는 t2i 전용이라
    // 모드는 t2i로 고정하고 i2i/inpaint 전용 소스·마스크는 가져오지 않는다.
    // 트리거 뱃지 순서는 params가 아니라 workbench 스토어에 있으므로 따로 넘긴다.
    importBaseFromWorkbench: () => {
      const wb = useWorkbench.getState()
      const next = charFromParams(wb.params, wb.triggerOrder)
      set((s) => ({
        characters: s.characters.map((c) =>
          c.id === s.activeCharId
            ? { ...c, ...next, positiveOverrides: syncOverrideTokens(c.positiveOverrides, !!next.triggerBadges) }
            : c),
      }))
    },
    // 특정 캐릭터의 base를 주어진 params로 지정(Single 결과 → 캐릭터로 설정).
    setCharacterBase: (charId, params) =>
      set((s) => ({
        characters: s.characters.map((c) => {
          if (c.id !== charId) return c
          const next = charFromParams(params)
          return { ...c, ...next, positiveOverrides: syncOverrideTokens(c.positiveOverrides, !!next.triggerBadges) }
        }),
      })),
    // 주어진 params로 새 캐릭터를 만든다(활성 캐릭터는 그대로 — Single에서 호출).
    addCharacterFromParams: (params) =>
      set((s) => {
        const char: Character = { id: uid(), name: charLabel(s.characters.length + 1), ...charFromParams(params) }
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
        return { activeTabId: id, activeTabByChar: { ...s.activeTabByChar, [s.activeCharId]: id }, tabs: markSeen(s.tabs, id) }
      }),
    openNewTab: () =>
      set((s) => {
        const t = newTab(s.activeCharId)
        // 새 탭은 슬롯을 모두 접힌 상태로 시작(전부 펼쳐 길어지지 않게).
        return {
          tabs: [...s.tabs, t], activeTabId: t.id,
          activeTabByChar: { ...s.activeTabByChar, [s.activeCharId]: t.id },
          slotCollapsed: { ...s.slotCollapsed, ...Object.fromEntries(t.slots.map((sl) => [sl.id, true] as const)) },
        }
      }),
    closeTab: (id) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id)
        if (!tab || tab.closed) return s
        const sibling = s.tabs.filter((t) => t.charId === tab.charId && !t.closed)
        if (sibling.length <= 1) return s // 캐릭터의 마지막 열린 탭은 유지
        const i = sibling.findIndex((t) => t.id === id)
        // 프리셋 탭은 숨김 보존(완료 결과만 남김 — 미완료는 이어받을 수 없음). 무제 탭은 완전 삭제.
        const keep = !!tab.presetFilename
        const tabs = keep
          ? s.tabs.map((t) => (t.id === id ? { ...t, closed: true, results: t.results.filter((r) => r.status === 'done') } : t))
          : s.tabs.filter((t) => t.id !== id)
        const viewports = { ...s.viewports }
        if (!keep) delete viewports[id]
        const remaining = sibling.filter((t) => t.id !== id)
        const fallback = remaining[Math.max(0, i - 1)].id
        const activeTabId = s.activeTabId === id ? fallback : s.activeTabId
        return { tabs: markSeen(tabs, activeTabId), activeTabId, viewports, activeTabByChar: { ...s.activeTabByChar, [tab.charId]: activeTabId } }
      }),
    setViewport: (tabId, vp) => set((s) => ({ viewports: { ...s.viewports, [tabId]: vp } })),

    setSlotStart: (n) => patchActive(() => ({ slotStart: Math.max(1, Math.floor(n) || 1) })),
    addSlot: () => patchActive((t) => ({ slots: [...t.slots, newSlot()] })),
    updateSlot: (id, patch) => patchActive((t) => ({ slots: t.slots.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    // 슬롯 삭제 = 그 슬롯의 결과까지 함께 제거하고, 실제 이미지 파일도 삭제(deleteGeneration이
    // 백엔드에서 output 파일까지 지운다). 마지막 슬롯은 남긴다.
    removeSlot: (id) => {
      const tab = activeTabOf(get())
      if (!tab || tab.slots.length <= 1) return
      const promptIds = tab.results.filter((r) => r.slotId === id && r.promptId).map((r) => r.promptId!)
      patchActive((t) => ({ slots: t.slots.filter((x) => x.id !== id), results: t.results.filter((r) => r.slotId !== id) }))
      void Promise.all(promptIds.map((pid) => deleteGeneration(pid)))
    },
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
    setAllSlotsLocked: (locked) => patchActive((t) => ({ slots: t.slots.map((x) => ({ ...x, locked })) })),
    setSetting: (patch) => set(patch),
    toggleSlotCollapsed: (id) => set((s) => ({ slotCollapsed: { ...s.slotCollapsed, [id]: !s.slotCollapsed[id] } })),
    setSlotsCollapsed: (ids, collapsed) =>
      set((s) => {
        const m = { ...s.slotCollapsed }
        ids.forEach((id) => { m[id] = collapsed })
        return { slotCollapsed: m }
      }),

    loadPresetList: async () => {
      set({ presets: await presetApi.listPresets().catch(() => []) })
    },
    applyPreset: async (filename) => {
      // 활성 캐릭터에 이미 그 프리셋 탭이 열려 있으면 그 탭으로 복귀. 닫힌(보존된) 탭이 있으면
      // 복원 — 슬롯은 파일 최신 내용으로 동기화하되 slotId를 보존해 기존 결과 프리뷰가 살아난다.
      const s0 = get()
      const existing = s0.tabs.find((t) => t.presetFilename === filename && t.charId === s0.activeCharId)
      if (existing && !existing.closed) { get().switchTab(existing.id); return }
      if (existing) {
        const p = await presetApi.getPreset(filename).catch(() => null)
        set((s) => ({
          tabs: markSeen(s.tabs.map((t) => {
            if (t.id !== existing.id) return t
            let slots = t.slots
            if (p) {
              const fileSlots = p.slots ?? []
              const synced: Slot[] = fileSlots.map((fsl, i) => {
                const ex = t.slots[i]
                return ex
                  ? { ...ex, name: fsl.name, prompt: fsl.prompt, promptH: fsl.promptH }
                  : { id: uid(), name: fsl.name, prompt: fsl.prompt, locked: false, promptH: fsl.promptH }
              })
              const extras = t.slots.slice(fileSlots.length).filter((sl) => t.results.some((r) => r.slotId === sl.id))
              slots = [...synced, ...extras]
            }
            return { ...t, closed: false, ...(p ? { name: p.name } : {}), slots: slots.length ? slots : t.slots }
          }), existing.id),
          activeTabId: existing.id,
          activeTabByChar: { ...s.activeTabByChar, [s.activeCharId]: existing.id },
        }))
        return
      }
      const p = await presetApi.getPreset(filename)
      // 새 탭은 잠금 기본값을 전부 해제(잠금은 생성 제외용 세션 컨트롤 — 프리셋 내용으로 취급하지 않음).
      const slots = (p.slots ?? []).map((sl) => ({ id: uid(), name: sl.name, prompt: sl.prompt, locked: false, promptH: sl.promptH }))
      set((s) => {
        const collapsed = Object.fromEntries(slots.map((sl) => [sl.id, true] as const))
        // 변경 없는 New tab에서 열었으면 새 탭 대신 그 탭을 프리셋으로 대체.
        const cur = s.tabs.find((t) => t.id === s.activeTabId)
        if (cur && cur.charId === s.activeCharId && isPristineTab(cur)) {
          return {
            tabs: s.tabs.map((t) => (t.id === cur.id ? { ...t, name: p.name, presetFilename: filename, slots } : t)),
            activeTabByChar: { ...s.activeTabByChar, [s.activeCharId]: cur.id },
            slotCollapsed: { ...s.slotCollapsed, ...collapsed },
          }
        }
        const tab = newTab(s.activeCharId, p.name, filename, slots)
        // 슬롯을 모두 접힌 상태로 시작.
        return {
          tabs: [...s.tabs, tab], activeTabId: tab.id,
          activeTabByChar: { ...s.activeTabByChar, [s.activeCharId]: tab.id },
          slotCollapsed: { ...s.slotCollapsed, ...collapsed },
        }
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
      // 열린 탭은 무제 탭으로 전환(슬롯·결과는 유지), 닫힌 보존 탭은 제거(보이지 않는 고아 방지).
      // 이 프리셋 한정 변형도 전 캐릭터에서 정리.
      set((s) => ({
        tabs: s.tabs
          .filter((t) => !(t.presetFilename === filename && t.closed))
          .map((t) => (t.presetFilename === filename ? { ...t, presetFilename: null } : t)),
        characters: s.characters.map((c) => {
          const drop = (m?: Record<string, string>) => {
            if (!m || !(filename in m)) return m
            const { [filename]: _x, ...rest } = m
            return rest
          }
          return { ...c, positiveOverrides: drop(c.positiveOverrides), negativeOverrides: drop(c.negativeOverrides) }
        }),
      }))
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
        // 이 프리셋 탭에 한정 변형(overrides)이 있으면 그걸 base 프롬프트로 사용.
        const ovPositive = tab.presetFilename ? char.positiveOverrides?.[tab.presetFilename] : undefined
        const ovNegative = tab.presetFilename ? char.negativeOverrides?.[tab.presetFilename] : undefined
        const mergedPositive = insertSlotPrompt(ovPositive ?? char.base.positive, slot.prompt ?? '')
        const reqBase: GenerationParams = {
          ...char.base,
          filenamePrefix: [folder, charFolder, cat].filter(Boolean).join('/'),
          save: { format: s.format, quality: s.quality },
        }
        for (let r = 0; r < Math.max(1, s.countPerSlot); r++) {
          // 시드·와일드카드(#이름)도 큐에 넣는 시점에 확정: 결과마다 개별 추첨/새 시드.
          const seed = s.randomizeSeed ? randomSeed() : char.base.seed
          additions.push({
            id: uid(), slotId: slot.id, slotIndex: idx, promptId: null, seed: null, status: 'idle', imageUrls: [],
            req: { ...reqBase, positive: resolveWildcards(mergedPositive), negative: resolveWildcards(ovNegative ?? char.base.negative), seed },
          })
        }
      })
      if (additions.length === 0) return
      set((st) => ({
        tabs: st.tabs.map((t) => (t.id === tab.id ? { ...t, results: [...t.results, ...additions] } : t)),
        running: true,
        runningTabId: st.runningTabId ?? tab.id,
      }))
      // Single과 동일하게: 랜덤 모드면 생성 '후' 표시 시드(base.seed)를 새 값으로 advance한다
      // → 시드 칸이 매 생성마다 바뀌고, 다음 고정생성(Random off)의 기준 시드도 갱신된다.
      if (s.randomizeSeed) {
        set((st) => ({
          characters: st.characters.map((c) => (c.id === s.activeCharId ? { ...c, base: { ...c.base, seed: randomSeed() } } : c)),
        }))
      }
      pump()
      pump()
    },

    stop: async () => {
      set({ running: false, activePromptId: null, progress: null })
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

    onProgress: (promptId, value, max) => {
      // 큐에 2개를 미리 넣어도 ComfyUI는 1개씩 실행한다. 지금 실제로 도는 프롬프트를
      // 기록해, 캔버스가 그것만 'generating…', 미리 제출된 건 'queued'로 표시하게 한다.
      // 이 탭들이 소유한 프롬프트만 반영 — Single 프롬프트의 진행 이벤트는 무시한다.
      if (get().tabs.some((t) => t.results.some((r) => r.promptId === promptId))) {
        set({
          activePromptId: promptId,
          progress: value != null && max != null ? { promptId, value, max } : get().progress,
        })
      }
    },

    onDone: async (promptId) => {
      if (get().activePromptId === promptId) set({ activePromptId: null, progress: null })
      const tab = get().tabs.find((t) => t.results.some((r) => r.promptId === promptId))
      if (!tab) return
      const outputs = await fetchOutputs(promptId)
      if (outputs && outputs.length > 0) await completeGeneration(promptId, outputs)
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                // 활성 탭이 아니면 미확인 dot 표시(사용자가 안 보고 있는 탭에서 완료됨).
                unseen: t.id !== s.activeTabId ? true : t.unseen,
                results: t.results.map((r) => (r.promptId === promptId ? { ...r, status: 'done' as const, imageUrls: (outputs ?? []).map(viewUrl) } : r)),
              }
            : t,
        ),
      }))
      pump()
    },

    onError: (promptId) => {
      if (get().activePromptId === promptId) set({ activePromptId: null, progress: null })
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
    slotCollapsed: s.slotCollapsed,
    pvSelByChar: s.pvSelByChar,
    nvSelByChar: s.nvSelByChar,
    presetOrder: s.presetOrder,
  }),
}))
