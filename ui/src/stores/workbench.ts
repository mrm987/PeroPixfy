import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearQueue as apiClearQueue, deleteQueued, fetchOutputs, fetchQueueIds, interrupt, submitPrompt, viewUrl } from '../api/comfy'
import {
  completeGeneration, deleteGeneration, failGeneration, listGenerations,
  recordGeneration, starGeneration, type GenerationRecord,
} from '../api/gallery'
import { fetchSettings } from '../api/settings'
import { buildGraph } from '../workflow/builder'
import { ANIMA_DEFAULTS, defaultFilenamePrefix } from '../workflow/defaults'
import type { GenerationParams, LoraEntry } from '../workflow/types'

export interface HistoryItem {
  promptId: string
  params: GenerationParams
  imageUrls: string[]
  status: 'pending' | 'done' | 'error'
  starred: boolean
}

const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

interface WorkbenchState {
  params: GenerationParams
  randomizeSeed: boolean
  history: HistoryItem[]
  selectedId: string | null
  progress: { promptId: string; value: number; max: number } | null
  error: string | null
  flashLora: string | null
  availableLoras: string[] // ComfyUI에 실제 설치된 LoRA 목록 (검증용)
  availableUnets: string[] // ComfyUI에 실제 설치된 UNet/체크포인트 목록 (스타일 적용 검증용)
  notice: string | null
  singleOutput: string // Single 저장 폴더(상대=output 하위 / 절대=자유). 옵션 모달에서 설정.

  init: () => Promise<void>
  set: (patch: Partial<GenerationParams>) => void
  setRandomize: (v: boolean) => void
  setLoras: (loras: LoraEntry[]) => void
  setFlashLora: (relPath: string | null) => void
  setAvailableLoras: (loras: string[]) => void
  setAvailableUnets: (unets: string[]) => void
  setNotice: (notice: string | null) => void
  setSingleOutput: (v: string) => void
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

export const useWorkbench = create<WorkbenchState>()(persist((set, get) => ({
  params: ANIMA_DEFAULTS,
  randomizeSeed: true,
  history: [],
  selectedId: null,
  progress: null,
  error: null,
  flashLora: null,
  availableLoras: [],
  availableUnets: [],
  notice: null,
  singleOutput: '',

  // 앱 시작 시: 기록 복원 + pending 상태 복구 (/history → /queue 순서로 확인).
  // 서버 저장 기본값은 마지막 작업 상태(localStorage)가 없을 때만 적용.
  init: async () => {
    if (localStorage.getItem(PERSIST_KEY) == null) {
      const saved = await fetchSettings().catch(() => ({}))
      set((s) => ({ params: { ...s.params, ...saved } }))
    }

    const records = await listGenerations(HISTORY_LIMIT, 'single')
    const history = records.map(recordToHistory)
    set({ history })

    const pending = history.filter((h) => h.status === 'pending')
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
  },

  set: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),
  setRandomize: (v) => set({ randomizeSeed: v }),
  setLoras: (loras) => set((s) => ({ params: { ...s.params, loras } })),
  setFlashLora: (flashLora) => set({ flashLora }),
  setAvailableLoras: (availableLoras) => set({ availableLoras }),
  setAvailableUnets: (availableUnets) => set({ availableUnets }),
  setNotice: (notice) => set({ notice }),
  setSingleOutput: (singleOutput) => set({ singleOutput }),
  restore: (params) => set({ params }),
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
    const records = await listGenerations(HISTORY_LIMIT, 'single')
    set((s) => ({
      history: records.map(recordToHistory),
      selectedId: records.some((r) => r.prompt_id === s.selectedId)
        ? s.selectedId
        : (records[0]?.prompt_id ?? null),
    }))
  },

  generate: async () => {
    const { params, randomizeSeed, availableLoras, singleOutput } = get()
    // 현재 표시된 시드로 생성한다 (WYSIWYG). randomize 모드면 생성을 제출한 '뒤'에
    // 다음 회차용 시드를 새로 뽑는다 (ComfyUI control_after_generate=randomize와 동일).
    // save 설정을 넣어 PeroPixSaveImage로 저장 → 절대경로(자유 폴더)도 지원.
    const finalParams = {
      ...params,
      filenamePrefix: defaultFilenamePrefix(params.mode, singleOutput),
      save: { format: 'png' as const, quality: 95 },
    }
    // 설치돼 있지 않은 LoRA는 그래프에서 제외해 ComfyUI 검증 오류(400)를 막는다.
    // UI 스택(params)은 그대로 두고, 실제 제출/기록 그래프(graphParams)에서만 뺀다.
    const valid = availableLoras.length ? new Set(availableLoras) : null
    const skipped = valid ? finalParams.loras.filter((l) => l.enabled && !valid.has(l.relPath)) : []
    const graphParams = valid
      ? { ...finalParams, loras: finalParams.loras.filter((l) => valid.has(l.relPath)) }
      : finalParams
    set({
      params: finalParams,
      error: null,
      notice: skipped.length
        ? `Generating without ${skipped.length} not-installed LoRA(s): ${skipped.map((l) => l.relPath).join(', ')}`
        : null,
    })
    try {
      const promptId = await submitPrompt(buildGraph(graphParams))
      set((s) => ({
        history: [
          { promptId, params: graphParams, imageUrls: [], status: 'pending' as const, starred: false },
          ...s.history,
        ],
        selectedId: promptId,
        // 제출 후 다음 회차용 시드 변경. 방금 생성에 쓴 시드(finalParams.seed)는
        // 위 history/record에 그대로 보존된다.
        ...(randomizeSeed ? { params: { ...s.params, seed: randomSeed() } } : {}),
      }))
      await recordGeneration(promptId, graphParams)
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
    // 동일 그래프를 다시 제출하면 ComfyUI 캐시가 새 파일을 쓰지 않고 직전과 같은 파일을
    // 돌려준다. '직전' 결과와 출력 파일이 같으면(쌍둥이) 중복 프리뷰를 만들지 않고 이
    // 기록을 지운 뒤 기존 결과를 선택한다. history는 최신순이라 idx+1이 직전 기록이다.
    const hist = get().history
    const idx = hist.findIndex((h) => h.promptId === promptId)
    const prev = idx >= 0 ? hist[idx + 1] : undefined
    const twin =
      urls.length &&
      prev &&
      prev.status === 'done' &&
      prev.imageUrls.length === urls.length &&
      prev.imageUrls.every((u, i) => u === urls[i])
        ? prev
        : undefined
    if (twin) {
      set((s) => ({
        progress: s.progress?.promptId === promptId ? null : s.progress,
        history: s.history.filter((h) => h.promptId !== promptId),
        selectedId: s.selectedId === promptId ? twin.promptId : s.selectedId,
      }))
      await deleteGeneration(promptId)
      return
    }
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
}), {
  name: PERSIST_KEY,
  partialize: (s) => ({ params: s.params, randomizeSeed: s.randomizeSeed, singleOutput: s.singleOutput }),
  // 앱 업데이트로 params에 새 필드가 생겨도 기본값으로 채워지도록 병합
  merge: (persisted, current) => {
    const p = (persisted ?? {}) as Partial<WorkbenchState>
    return { ...current, ...p, params: { ...ANIMA_DEFAULTS, ...(p.params ?? {}) } }
  },
}))
