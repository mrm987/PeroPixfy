import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearQueue as apiClearQueue, deleteQueued, enumValues, fetchNodeInfo, fetchOutputs, fetchQueueIds, interrupt, submitPrompt, viewUrl } from '../api/comfy'
import {
  completeGeneration, copyToWorkspace as copyToWorkspaceApi, deleteGeneration, deleteWorkspaceData,
  failGeneration, listGenerations, recordGeneration, renameWorkspaceFolder,
  starGeneration, type GenerationRecord,
} from '../api/gallery'
import { fetchSettings } from '../api/settings'
import { buildGraph, resolveUpscaleModel } from '../workflow/builder'
import { insertTriggers } from '../tags/promptTags'
import { normPath, splitCsv } from '../tags/triggers'
import { resolveWildcards } from '../tags/wildcards'
import { useLibrary } from './library'
import { ANIMA_DEFAULTS, defaultFilenamePrefix } from '../workflow/defaults'
import type { GenerationParams, LoraEntry } from '../workflow/types'

export interface HistoryItem {
  promptId: string
  params: GenerationParams
  imageUrls: string[]
  status: 'pending' | 'done' | 'error'
  starred: boolean
}

export interface Workspace {
  id: string
  name: string
}

// 워크스페이스별로 독립 저장되는 필드(생성세팅 + 저장소/포맷). 스타일·로라는 전역 공유라 제외.
export interface WsData {
  params: GenerationParams
  singleOutput: string
  format: 'png' | 'jpg' | 'webp'
  quality: number
  randomizeSeed: boolean
  triggerBadges: boolean
  triggerOrder: string[]
}

const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

const WS_DEFAULT_ID = 'default' // 기본/레거시 워크스페이스 id — 서버 마이그레이션이 옛 single 기록을 이 id로 귀속시킨다.

// 워크스페이스 이름을 출력 폴더명으로 안전하게 정규화(경로 구분자·특수문자 제거).
const safeFolder = (name: string) =>
  name.trim().replace(/[^\w\-가-힣 ]+/g, '').replace(/\s+/g, '_').slice(0, 40) || 'ws'

// 현재 라이브 필드 → 워크스페이스 스냅샷.
const pickWs = (s: Pick<WsData, keyof WsData>): WsData => ({
  params: s.params, singleOutput: s.singleOutput, format: s.format, quality: s.quality,
  randomizeSeed: s.randomizeSeed, triggerBadges: s.triggerBadges, triggerOrder: s.triggerOrder,
})

// 새 워크스페이스 기본값. 폴더명이 주어지면 PeroPixfy/Single/<이름> 하위로 저장(디스크에서도 분리).
const defaultWsData = (folderName?: string): WsData => ({
  params: ANIMA_DEFAULTS,
  singleOutput: folderName ? `PeroPixfy/Single/${safeFolder(folderName)}` : '',
  format: 'png', quality: 95, randomizeSeed: true, triggerBadges: true, triggerOrder: [],
})

interface WorkbenchState {
  params: GenerationParams
  randomizeSeed: boolean
  triggerBadges: boolean // 트리거워드 뱃지/@triggers 칩 관리 기능 on/off (off면 프롬프트에 직접 입력)
  triggerOrder: string[] // 트리거 뱃지 순서(소문자 단어) — 프롬프트 삽입 순서를 정함
  history: HistoryItem[]
  selectedId: string | null
  progress: { promptId: string; value: number; max: number } | null
  error: string | null
  flashLora: string | null
  availableLoras: string[] // ComfyUI에 실제 설치된 LoRA 목록 (검증용)
  availableUnets: string[] // ComfyUI에 실제 설치된 UNet/체크포인트 목록 (스타일 적용 검증용)
  availableUpscalers: string[] // 설치된 업스케일 모델 (hires 제출 직전 보정용)
  notice: string | null
  singleOutput: string // Single 저장 폴더(상대=output 하위 / 절대=자유). 옵션 모달에서 설정.
  format: 'png' | 'jpg' | 'webp' // Single 저장 포맷 (Multi 배치 설정과 동일, 세션 지속).
  quality: number // jpg/webp 품질(1–100). png은 무시.

  // 워크스페이스 — Single 작업 단위. 각 워크스페이스는 독립된 히스토리·생성세팅·출력폴더를 가진다
  // (위 라이브 필드 params/singleOutput/format/quality/... 는 '활성' 워크스페이스의 현재 상태).
  // 스타일·로라 라이브러리는 전역 공유. 비활성 워크스페이스의 스냅샷은 wsData에 보관.
  // workspaces=알려진 전체(열림+닫힘), openIds=탭으로 열려있는 것(순서), activeWs∈openIds.
  // 탭을 '닫으면' openIds에서만 빠지고 데이터는 보존 — + 메뉴에서 다시 열 수 있다.
  workspaces: Workspace[]
  openIds: string[]
  activeWs: string
  wsData: Record<string, WsData>

  init: () => Promise<void>
  set: (patch: Partial<GenerationParams>) => void
  setRandomize: (v: boolean) => void
  setTriggerBadges: (on: boolean) => void
  setTriggerOrder: (order: string[]) => void
  setLoras: (loras: LoraEntry[]) => void
  setFlashLora: (relPath: string | null) => void
  setAvailableLoras: (loras: string[]) => void
  setAvailableUnets: (unets: string[]) => void
  refreshAvailable: () => Promise<void> // /object_info 재요청 → 새로 추가된 LoRA/모델 반영
  setNotice: (notice: string | null) => void
  setSingleOutput: (v: string) => void
  setSave: (patch: Partial<Pick<WorkbenchState, 'format' | 'quality'>>) => void
  createWorkspace: (name?: string) => void
  switchWorkspace: (id: string) => Promise<void>
  openWorkspace: (id: string) => Promise<void>
  closeWorkspace: (id: string) => Promise<void>
  renameWorkspace: (id: string, name: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  copyToWorkspace: (promptIds: string[], targetId: string) => Promise<void>
  restore: (params: GenerationParams) => void
  select: (promptId: string) => void
  star: (promptId: string) => Promise<void>
  remove: (promptId: string) => Promise<void>
  reloadHistory: () => Promise<void>
  generate: () => Promise<void>
  stop: () => Promise<void>
  clearQueue: () => Promise<void>
  onProgress: (promptId: string, value: number, max: number) => void
  onDone: (promptId: string) => Promise<void>
  onError: (promptId: string) => void
}

const markDone = (h: HistoryItem, urls: string[]): HistoryItem => ({ ...h, status: 'done', imageUrls: urls })

// 프리뷰 리스트에 한 번에 불러올 최대 생성 수.
export const HISTORY_LIMIT = 500

const recordToHistory = (r: GenerationRecord): HistoryItem => ({
  promptId: r.prompt_id,
  params: JSON.parse(r.params_json) as GenerationParams,
  imageUrls: (JSON.parse(r.files_json || '[]') as Parameters<typeof viewUrl>[0][]).map(viewUrl),
  status: r.status,
  starred: !!r.starred,
})

const PERSIST_KEY = 'peropix.workbench'

export const useWorkbench = create<WorkbenchState>()(persist((set, get) => {
  // 활성 워크스페이스의 기록만 불러온다.
  const loadHistory = async (ws: string): Promise<HistoryItem[]> => {
    const records = await listGenerations(HISTORY_LIMIT, 'single', ws)
    return records.map(recordToHistory)
  }
  // 워크스페이스 활성화 — 현재 것을 스냅샷 저장하고 대상 세팅/히스토리로 전환한다.
  const activate = async (id: string) => {
    const s = get()
    if (id === s.activeWs) return
    const target = s.wsData[id] ?? defaultWsData()
    set({
      wsData: { ...s.wsData, [s.activeWs]: pickWs(s) },
      activeWs: id,
      history: [], selectedId: null, progress: null, error: null, notice: null,
      ...target,
      // 구버전 저장 params에 없는 신규 필드(마스크 확장/페더 등)를 기본값으로 백필.
      params: { ...ANIMA_DEFAULTS, ...target.params },
    })
    set({ history: await loadHistory(id) })
    await recoverPending()
  }
  // pending 기록을 큐/출력으로 대조해 done/error로 확정 (init·워크스페이스 전환 시 호출).
  const recoverPending = async () => {
    const pending = get().history.filter((h) => h.status === 'pending')
    if (pending.length === 0) return
    const queueIds = await fetchQueueIds().catch(() => new Set<string>())
    for (const h of pending) {
      const outputs = await fetchOutputs(h.promptId).catch(() => null)
      if (outputs && outputs.length > 0) {
        await completeGeneration(h.promptId, outputs)
        set((s) => ({
          history: s.history.map((x) => (x.promptId === h.promptId ? markDone(x, outputs.map(viewUrl)) : x)),
        }))
      } else if (!queueIds.has(h.promptId)) {
        await failGeneration(h.promptId)
        set((s) => ({
          history: s.history.map((x) => (x.promptId === h.promptId ? { ...x, status: 'error' as const } : x)),
        }))
      }
      // 큐에 아직 있으면 pending 유지 — WS가 완료를 알려줌
    }
  }

  return {
  params: ANIMA_DEFAULTS,
  randomizeSeed: true,
  triggerBadges: true,
  triggerOrder: [],
  history: [],
  selectedId: null,
  progress: null,
  error: null,
  flashLora: null,
  availableLoras: [],
  availableUnets: [],
  availableUpscalers: [],
  notice: null,
  singleOutput: '',
  format: 'png',
  quality: 95,
  workspaces: [{ id: WS_DEFAULT_ID, name: 'Workspace 1' }],
  openIds: [WS_DEFAULT_ID],
  activeWs: WS_DEFAULT_ID,
  wsData: {},

  // 앱 시작 시: 활성 워크스페이스 기록 복원 + pending 상태 복구 (/history → /queue 순서로 확인).
  // 서버 저장 기본값은 마지막 작업 상태(localStorage)가 없을 때만 적용.
  init: async () => {
    if (localStorage.getItem(PERSIST_KEY) == null) {
      const saved = await fetchSettings().catch(() => ({}))
      set((s) => ({ params: { ...s.params, ...saved } }))
    }
    set({ history: await loadHistory(get().activeWs) })
    await recoverPending()
  },

  set: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),
  setRandomize: (v) => set({ randomizeSeed: v }),
  // 트리거워드 관리 on/off. off→포지티브의 @triggers 토큰 제거 + 해석된 triggers 비움(직접 입력
  // 모드). on→토큰을 끝에 보장(없을 때). 어느 쪽이든 포지티브 텍스트의 일관성을 맞춘다.
  setTriggerBadges: (on) => set((s) => {
    let positive = s.params.positive
    if (on) {
      if (!/@triggers/i.test(positive)) {
        const p = positive.replace(/[\s,]+$/, '')
        positive = p ? p + ', @triggers' : '@triggers'
      }
    } else {
      positive = positive.replace(/@triggers/gi, '').replace(/,\s*,/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '')
    }
    return { triggerBadges: on, params: { ...s.params, positive, triggers: on ? s.params.triggers : [] } }
  }),
  setTriggerOrder: (triggerOrder) => set({ triggerOrder }),
  setLoras: (loras) => set((s) => ({ params: { ...s.params, loras } })),
  setFlashLora: (flashLora) => set({ flashLora }),
  setAvailableLoras: (availableLoras) => set({ availableLoras }),
  setAvailableUnets: (availableUnets) => set({ availableUnets }),
  // 실행 중 새 LoRA/모델을 추가하고 스캔하면 ComfyUI의 /object_info도 최신화되므로,
  // 재요청해 검증용 목록을 갱신한다. (실패 시엔 기존 목록을 덮어쓰지 않음 — 전부 미설치로
  // 표시되는 사고 방지.)
  refreshAvailable: async () => {
    const [lora, unet, upscale] = await Promise.all([
      fetchNodeInfo('LoraLoaderModelOnly'), fetchNodeInfo('UNETLoader'), fetchNodeInfo('UpscaleModelLoader'),
    ])
    const patch: Partial<Pick<WorkbenchState, 'availableLoras' | 'availableUnets' | 'availableUpscalers'>> = {}
    if (lora) patch.availableLoras = enumValues(lora, 'lora_name')
    if (unet) patch.availableUnets = enumValues(unet, 'unet_name')
    if (upscale) patch.availableUpscalers = enumValues(upscale, 'model_name')
    if (Object.keys(patch).length) set(patch)
  },
  setNotice: (notice) => set({ notice }),
  setSingleOutput: (singleOutput) => set({ singleOutput }),
  setSave: (patch) => set(patch),

  // 새 워크스페이스 생성 → 현재 것을 스냅샷으로 보존하고, 새 탭(열림)으로 빈 히스토리·기본 세팅 전환.
  createWorkspace: (name) => {
    const s = get()
    const nm = (name || '').trim() || `Workspace ${s.workspaces.length + 1}`
    const id = `ws_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
    set({
      wsData: { ...s.wsData, [s.activeWs]: pickWs(s) },
      workspaces: [...s.workspaces, { id, name: nm }],
      openIds: [...s.openIds, id],
      activeWs: id,
      history: [], selectedId: null, progress: null, error: null, notice: null,
      ...defaultWsData(nm),
    })
  },

  // 탭 전환 (이미 열려있는 워크스페이스).
  switchWorkspace: async (id) => { await activate(id) },

  // 닫아둔(보존된) 워크스페이스를 다시 탭으로 열고 전환. 이미 열려있으면 그냥 전환.
  openWorkspace: async (id) => {
    if (!get().openIds.includes(id)) set((s) => ({ openIds: [...s.openIds, id] }))
    await activate(id)
  },

  // 탭 닫기 — openIds에서만 빼고 데이터(히스토리·폴더·스냅샷)는 보존한다(+ 메뉴에서 다시 열 수 있음).
  // 마지막 열린 탭은 닫지 않는다. 활성 탭을 닫으면 인접한 열린 탭으로 전환한다.
  closeWorkspace: async (id) => {
    const s = get()
    if (!s.openIds.includes(id) || s.openIds.length <= 1) return
    const idx = s.openIds.indexOf(id)
    const openIds = s.openIds.filter((x) => x !== id)
    if (id === s.activeWs) {
      const nextId = openIds[Math.min(idx, openIds.length - 1)]
      const target = s.wsData[nextId] ?? defaultWsData()
      set({
        openIds,
        wsData: { ...s.wsData, [s.activeWs]: pickWs(s) },
        activeWs: nextId,
        history: [], selectedId: null, progress: null, error: null, notice: null,
        ...target,
      })
      set({ history: await loadHistory(nextId) })
      await recoverPending()
    } else {
      set({ openIds })
    }
  },

  // 이름 변경 시, 출력 폴더가 '자동 파생'(빈값=베이스 또는 옛 이름에서 만든 값)이면 새 이름에
  // 맞춰 폴더도 바꾸고, 그 워크스페이스의 기존 이미지를 실제로 새 폴더로 옮긴다(백엔드) — 폴더가
  // 둘로 쪼개지지 않게. 사용자가 Options에서 직접 지정한 커스텀/절대 폴더는 건드리지 않는다.
  // (활성 워크스페이스는 라이브 필드, 비활성은 wsData 스냅샷을 갱신.)
  renameWorkspace: async (id, name) => {
    const nm = name.trim()
    if (!nm) return
    const s = get()
    const ws = s.workspaces.find((w) => w.id === id)
    if (!ws) return
    const curFolder = id === s.activeWs ? s.singleOutput : (s.wsData[id]?.singleOutput ?? '')
    const isAuto = curFolder === '' || curFolder === `PeroPixfy/Single/${safeFolder(ws.name)}`
    const nextFolder = `PeroPixfy/Single/${safeFolder(nm)}`
    const workspaces = s.workspaces.map((w) => (w.id === id ? { ...w, name: nm } : w))
    if (id === s.activeWs) {
      set({ workspaces, ...(isAuto ? { singleOutput: nextFolder } : {}) })
    } else {
      const cur = s.wsData[id]
      set(cur && isAuto
        ? { workspaces, wsData: { ...s.wsData, [id]: { ...cur, singleOutput: nextFolder } } }
        : { workspaces })
    }
    if (!isAuto) return
    // 실제 폴더/DB 경로 이동 (기존 이미지가 새 폴더로 따라오게). 활성 워크스페이스면 히스토리의
    // 이미지 URL이 새 경로를 가리키도록 다시 로드한다.
    const oldRoot = curFolder || 'PeroPixfy/Single'
    await renameWorkspaceFolder(id, oldRoot, nextFolder).catch(() => {})
    if (get().activeWs === id) set({ history: await loadHistory(id) })
  },

  // 워크스페이스 '완전 삭제' → 목록·탭·스냅샷에서 제거하고, 백엔드에서 DB 기록 + 이미지 파일 +
  // (전용) 폴더까지 전부 삭제한다. 보통 +메뉴의 닫힌 목록(비활성·비열림)에서만 호출된다.
  // 마지막 하나는 남긴다. 방어적으로 활성/열림이면 인접 탭으로 전환한다.
  deleteWorkspace: async (id) => {
    const s = get()
    if (s.workspaces.length <= 1) return
    const folder = id === s.activeWs ? s.singleOutput : (s.wsData[id]?.singleOutput ?? '')
    const remaining = s.workspaces.filter((w) => w.id !== id)
    const openIds = s.openIds.filter((x) => x !== id)
    const nextData = { ...s.wsData }
    delete nextData[id]
    if (id === s.activeWs) {
      // 활성 탭을 삭제하는 경우 — 남은 열린 탭(없으면 남은 워크스페이스)으로 전환.
      const nextId = openIds[0] ?? remaining[0].id
      const nextOpen = openIds.length ? openIds : [nextId]
      const target = nextData[nextId] ?? defaultWsData()
      set({
        workspaces: remaining, openIds: nextOpen, wsData: nextData, activeWs: nextId,
        history: [], selectedId: null, progress: null, error: null, notice: null,
        ...target,
      })
      set({ history: await loadHistory(nextId) })
      await recoverPending()
    } else {
      set({ workspaces: remaining, openIds, wsData: nextData })
    }
    await deleteWorkspaceData(id, folder).catch(() => {})
  },

  // 선택한 기록들을 다른 워크스페이스로 '복제'한다 — 원본(현재 히스토리)은 그대로 두고, 백엔드가
  // 대상 워크스페이스에 새 기록 + 파일 사본을 만든다. 대상 폴더는 그 워크스페이스의 저장 폴더(wsData).
  // 현재 뷰는 바뀌지 않으므로(사본은 대상으로 감) 히스토리를 건드리지 않는다.
  copyToWorkspace: async (promptIds, targetId) => {
    const s = get()
    const ids = promptIds.filter((id) => s.history.some((h) => h.promptId === id))
    if (ids.length === 0 || targetId === s.activeWs) return
    const folder = s.wsData[targetId]?.singleOutput ?? ''
    await copyToWorkspaceApi(ids, targetId, folder).catch(() => {})
  },

  // 기록을 패널로 불러오기. 칩(@triggers)으로 생성된 기록(토큰 원형 positiveTemplate 또는 옛
  // 토큰형 positive)이면 자동 트리거워드를 켜고 칩을 원위치로 복원한다. 토큰 단서가 전혀 없는
  // 기록(자동 트리거워드 기능 이전의 옛날 이미지 또는 off로 생성)은 기능을 끄고 평문으로 불러온다
  // — 안 그러면 빈 칩이 붙고 로라 트리거 상태와 어긋나 이상해진다.
  restore: (params) => {
    // ★기록에 없는 신규 필드는 기본값으로 백필한다 — merge()·activate()와 같은 처리.
    // 여기만 빠져 있었다. restore는 params를 통째로 갈아끼우므로, 백필이 없으면 그 필드가 생기기
    // 전의 기록을 재사용했을 때 필드가 상태에서 아예 사라진다 — 기본값으로 돌아가는 게 아니라
    // 키가 없어지고, 이후 생성 기록에도 빠진 채 저장된다. 화면은 폴백값으로 멀쩡히 보이므로
    // 눈치채기 어렵고, "무엇으로 뽑았는지"가 기록에서 조용히 소실된다.
    // (실제 사고: 파라미터를 하나 추가한 뒤 이전 기록을 재사용했더니 그 키가 통째로 날아갔고,
    //  이어서 돌린 비교 실험이 의도한 값이 아닌 폴백값으로 실행됐다.)
    const { positiveTemplate, triggerOrder: recOrder, ...recorded } = params
    const rest = { ...ANIMA_DEFAULTS, ...recorded }
    const tokenSrc = positiveTemplate && /@triggers/i.test(positiveTemplate)
      ? positiveTemplate
      : (/@triggers/i.test(rest.positive) ? rest.positive : null)
    if (tokenSrc) {
      const trig = (rest.triggers ?? []).filter(Boolean)
      // 기록된 전체 뱃지 순서가 있으면 그대로, 없으면(구 기록) 켜진 단어 순서로 복원.
      set({ triggerBadges: true, triggerOrder: recOrder ?? trig.map((w) => w.toLowerCase()), params: { ...rest, positive: tokenSrc } })
      // 기록 시점의 트리거 on/off도 로라 라이브러리(disabled_triggers)에 복원한다 — 안 그러면
      // TriggerBadges가 '현재' 전역 상태로 triggers를 다시 계산해 덮어써 결과가 달라진다.
      const lib = useLibrary.getState()
      const want = new Set(trig.map((w) => w.toLowerCase()))
      for (const le of rest.loras) {
        if (!le.enabled) continue
        const rec = lib.loras.find((l) => normPath(l.rel_path) === normPath(le.relPath))
        if (!rec) continue
        const off = new Set(splitCsv(rec.disabled_triggers).map((w) => w.toLowerCase()))
        for (const w of splitCsv(rec.trigger_words)) {
          const k = w.toLowerCase()
          const shouldOn = want.has(k)
          if (shouldOn !== !off.has(k)) void lib.toggleTriggerDisabled(rec.rel_path, k, !shouldOn)
        }
      }
    } else if (positiveTemplate) {
      // 와일드카드(#이름)만 있고 @triggers는 없던 기록 — 원문 프롬프트로 복원(직접 입력 모드).
      set({ triggerBadges: false, params: { ...rest, positive: positiveTemplate, triggers: [] } })
    } else {
      const positive = rest.positive.replace(/@triggers/gi, '').replace(/,\s*,/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '')
      set({ triggerBadges: false, params: { ...rest, positive, triggers: [] } })
    }
  },
  select: (promptId) => set({ selectedId: promptId }),

  star: async (promptId) => {
    const item = get().history.find((h) => h.promptId === promptId)
    if (!item) return
    const next = !item.starred
    set((s) => ({ history: s.history.map((h) => (h.promptId === promptId ? { ...h, starred: next } : h)) }))
    await starGeneration(promptId, next)
  },

  remove: async (promptId) => {
    // 큐에 대기 중이거나 실행 중인 항목을 지우면 ComfyUI 작업도 취소한다 —
    // 안 그러면 생성이 끝나며 썸네일 없는 고아 파일이 남는다.
    const item = get().history.find((h) => h.promptId === promptId)
    if (item?.status === 'pending') {
      await deleteQueued([promptId]).catch(() => {}) // 대기 큐에서 제거
      if (get().progress?.promptId === promptId) await interrupt().catch(() => {}) // 실행 중이면 중단
    }
    set((s) => ({
      history: s.history.filter((h) => h.promptId !== promptId),
      selectedId: s.selectedId === promptId ? null : s.selectedId,
      progress: s.progress?.promptId === promptId ? null : s.progress,
    }))
    await deleteGeneration(promptId)
  },

  // 삭제 등으로 limit 이하로 줄었을 때, 그동안 안 보이던 더 오래된 기록을 다시 채운다.
  reloadHistory: async () => {
    const records = await listGenerations(HISTORY_LIMIT, 'single', get().activeWs)
    set((s) => ({
      history: records.map(recordToHistory),
      selectedId: records.some((r) => r.prompt_id === s.selectedId)
        ? s.selectedId
        : (records[0]?.prompt_id ?? null),
    }))
  },

  generate: async () => {
    const { params, randomizeSeed, availableLoras, availableUpscalers, singleOutput, format, quality } = get()
    // 현재 표시된 시드로 생성한다 (WYSIWYG). randomize 모드면 생성을 제출한 '뒤'에
    // 다음 회차용 시드를 새로 뽑는다 (ComfyUI control_after_generate=randomize와 동일).
    // save 설정을 넣어 PeroPixSaveImage로 저장 → 절대경로(자유 폴더)도 지원.
    const finalParams = {
      ...params,
      filenamePrefix: defaultFilenamePrefix(params.mode, singleOutput),
      save: { format, quality },
    }
    // 설치돼 있지 않은 LoRA는 그래프에서 제외해 ComfyUI 검증 오류(400)를 막는다.
    // UI 스택(params)은 그대로 두고, 실제 제출/기록 그래프(graphParams)에서만 뺀다.
    const valid = availableLoras.length ? new Set(availableLoras) : null
    const skipped = valid ? finalParams.loras.filter((l) => l.enabled && !valid.has(l.relPath)) : []
    // 와일드카드(#이름)는 제출 직전에 해석 — 에디터(params)에는 원문이 남고,
    // 그래프/기록에는 이번에 추출된 값이 들어간다.
    // 설치된 업스케일 모델로 맞춰 준다(빈 값·지워진 모델 이름). LoRA 필터와 같은 이유 —
    // 환경에 맞추는 보정이라 UI 상태는 두고 제출 그래프에서만 정리한다.
    const graphParams = resolveUpscaleModel({
      ...finalParams,
      positive: resolveWildcards(finalParams.positive),
      negative: resolveWildcards(finalParams.negative),
      ...(valid ? { loras: finalParams.loras.filter((l) => valid.has(l.relPath)) } : {}),
    }, availableUpscalers)
    set({
      params: finalParams,
      error: null,
      notice: skipped.length
        ? `Generating without ${skipped.length} not-installed LoRA(s): ${skipped.map((l) => l.relPath).join(', ')}`
        : null,
    })
    // 기록/스타일 참고용: positive의 @triggers를 실제 트리거워드로 치환해 저장하되, 무손실
    // 복원을 위해 원형(positiveTemplate — @triggers 토큰·#와일드카드 원문)도 함께 보관.
    // (제출 그래프는 graphParams로 그대로.)
    const trig = (graphParams.triggers ?? []).filter(Boolean).join(', ')
    const hasToken = /@triggers/i.test(graphParams.positive)
    const hadWildcards = graphParams.positive !== finalParams.positive
    const storeParams = {
      ...graphParams,
      positive: insertTriggers(graphParams.positive, trig),
      ...(hasToken || hadWildcards ? { positiveTemplate: finalParams.positive } : {}),
      // 뱃지 전체 순서(꺼진 단어 포함)도 기록 — 복원 시 재정렬 없이 그대로 되돌리기 위함.
      ...(hasToken ? { triggerOrder: get().triggerOrder } : {}),
    }
    try {
      const promptId = await submitPrompt(buildGraph(graphParams))
      set((s) => ({
        history: [
          { promptId, params: storeParams, imageUrls: [], status: 'pending' as const, starred: false },
          ...s.history,
        ],
        selectedId: promptId,
        // 제출 후 다음 회차용 시드 변경. 방금 생성에 쓴 시드(finalParams.seed)는
        // 위 history/record에 그대로 보존된다.
        ...(randomizeSeed ? { params: { ...s.params, seed: randomSeed() } } : {}),
      }))
      await recordGeneration(promptId, storeParams, 'single', get().activeWs)
    } catch (e) {
      set({ error: String(e) })
    }
  },

  // 현재 큐 중단 — 실행 중인 프롬프트만 인터럽트(큐의 다음 항목은 계속 진행).
  // 중단한 현재 항목의 플레이스홀더 프리뷰도 함께 제거한다(결과물이 안 나오므로).
  stop: async () => {
    const runningId = get().progress?.promptId ?? null
    set((s) => ({
      progress: null,
      history: runningId ? s.history.filter((h) => h.promptId !== runningId) : s.history,
      selectedId: s.selectedId === runningId ? null : s.selectedId,
    }))
    await interrupt()
    if (runningId) await deleteGeneration(runningId)
  },

  // 전체 큐 중단 — 서버 대기 큐를 비우고 현재 작업도 중단. 플레이스홀더로 잡혀있던
  // pending 프리뷰는 error로 남기지 않고 기록까지 함께 삭제한다(파일은 아직 없음).
  clearQueue: async () => {
    const pendingIds = get().history.filter((h) => h.status === 'pending').map((h) => h.promptId)
    set((s) => ({
      progress: null,
      history: s.history.filter((h) => h.status !== 'pending'),
      selectedId: pendingIds.includes(s.selectedId ?? '') ? null : s.selectedId,
    }))
    await apiClearQueue()
    await interrupt()
    await Promise.all(pendingIds.map((id) => deleteGeneration(id)))
  },

  onProgress: (promptId, value, max) => {
    // 자기 큐(Single)의 프롬프트만 반영. Multi 프롬프트의 진행 이벤트가 들어와도 무시해야
    // Single 큐 UI가 Multi 때문에 갱신되거나(취소 후) 잔류하지 않는다.
    if (!get().history.some((h) => h.promptId === promptId)) return
    set({ progress: { promptId, value, max } })
  },

  onDone: async (promptId) => {
    if (!get().history.some((h) => h.promptId === promptId)) return
    const outputs = await fetchOutputs(promptId)
    const urls = (outputs ?? []).map(viewUrl)
    // PeroPixSaveImage가 매 제출마다 새 파일을 쓰므로(IS_CHANGED) 동일 그래프를 다시
    // 제출해도 항상 새 결과 파일이 생긴다. (이전엔 '직전과 같은 파일이면 쌍둥이로 보고
    // 취소'했는데, 직전 생성을 삭제하고 재생성하면 캐시된 옛 파일명을 그대로 받아
    // 결과가 안 뜨던 문제가 있어 제거했다.)
    if (outputs && outputs.length > 0) await completeGeneration(promptId, outputs)
    set((s) => ({
      progress: s.progress?.promptId === promptId ? null : s.progress,
      history: s.history.map((h) => (h.promptId === promptId ? markDone(h, urls) : h)),
    }))
  },

  onError: (promptId) => {
    if (!get().history.some((h) => h.promptId === promptId)) return
    failGeneration(promptId)
    set((s) => ({
      progress: s.progress?.promptId === promptId ? null : s.progress,
      history: s.history.map((h) => (h.promptId === promptId ? { ...h, status: 'error' as const } : h)),
    }))
  },
  }
}, {
  name: PERSIST_KEY,
  // 워크스페이스 목록/활성 id/스냅샷만 영속. 활성 워크스페이스의 라이브 필드는 wsData[activeWs]로
  // 항상 반영해 저장한다(별도 최상위 필드로 중복 저장하지 않음).
  partialize: (s) => ({
    workspaces: s.workspaces,
    openIds: s.openIds,
    activeWs: s.activeWs,
    wsData: { ...s.wsData, [s.activeWs]: pickWs(s) },
  }),
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Record<string, unknown>
    let workspaces = Array.isArray(p.workspaces) && p.workspaces.length ? (p.workspaces as Workspace[]) : null
    let wsData = (p.wsData && typeof p.wsData === 'object' ? p.wsData : {}) as Record<string, WsData>
    let activeWs = typeof p.activeWs === 'string' ? p.activeWs : ''
    let openIds = Array.isArray(p.openIds) ? (p.openIds as string[]) : null
    if (!workspaces) {
      // 구버전(워크스페이스 이전): params/singleOutput 등이 최상위에 저장돼 있었다 → 기본
      // 워크스페이스로 승계한다. (또는 완전 신규 설치 — 기본값으로 채워짐.)
      workspaces = [{ id: WS_DEFAULT_ID, name: 'Workspace 1' }]
      activeWs = WS_DEFAULT_ID
      wsData = {
        [WS_DEFAULT_ID]: {
          params: (p.params as GenerationParams) ?? ANIMA_DEFAULTS,
          singleOutput: (p.singleOutput as string) ?? '',
          format: (p.format as WsData['format']) ?? 'png',
          quality: (p.quality as number) ?? 95,
          randomizeSeed: (p.randomizeSeed as boolean) ?? true,
          triggerBadges: (p.triggerBadges as boolean) ?? true,
          triggerOrder: (p.triggerOrder as string[]) ?? [],
        },
      }
    }
    // openIds가 없거나(구버전) 유효 id가 하나도 없으면 전체를 열린 것으로 본다(기존 동작 보존).
    // 알려진 워크스페이스만 남기고, 활성 id는 반드시 열려있게 보장한다.
    const known = new Set(workspaces.map((w) => w.id))
    openIds = (openIds ?? workspaces.map((w) => w.id)).filter((id) => known.has(id))
    if (openIds.length === 0) openIds = [workspaces[0].id]
    if (!openIds.includes(activeWs)) activeWs = openIds[0]
    const active = wsData[activeWs] ?? defaultWsData()
    // 재실행(앱/ComfyUI 재시작) 시 i2i/인페인트 소스는 업로드 temp가 사라져 깨지므로 t2i로 초기화.
    return {
      ...current,
      workspaces, openIds, activeWs, wsData,
      params: { ...ANIMA_DEFAULTS, ...(active.params ?? {}), mode: 't2i', sourceImage: undefined, maskImage: undefined },
      singleOutput: active.singleOutput ?? '',
      format: active.format ?? 'png',
      quality: active.quality ?? 95,
      randomizeSeed: active.randomizeSeed ?? true,
      triggerBadges: active.triggerBadges ?? true,
      triggerOrder: active.triggerOrder ?? [],
    }
  },
}))
