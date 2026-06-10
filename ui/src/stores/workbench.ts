import { create } from 'zustand'
import { fetchOutputs, fetchQueueIds, submitPrompt, viewUrl } from '../api/comfy'
import {
  completeGeneration, deleteGeneration, failGeneration, listGenerations,
  recordGeneration, starGeneration,
} from '../api/gallery'
import { fetchSettings } from '../api/settings'
import { buildGraph } from '../workflow/builder'
import { ANIMA_DEFAULTS } from '../workflow/defaults'
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

  init: () => Promise<void>
  set: (patch: Partial<GenerationParams>) => void
  setRandomize: (v: boolean) => void
  setLoras: (loras: LoraEntry[]) => void
  restore: (params: GenerationParams) => void
  select: (promptId: string) => void
  star: (promptId: string) => Promise<void>
  remove: (promptId: string) => Promise<void>
  generate: () => Promise<void>
  onProgress: (promptId: string, value: number, max: number) => void
  onDone: (promptId: string) => Promise<void>
  onError: (promptId: string) => void
}

const markDone = (h: HistoryItem, urls: string[]): HistoryItem => ({ ...h, status: 'done', imageUrls: urls })

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  params: ANIMA_DEFAULTS,
  randomizeSeed: true,
  history: [],
  selectedId: null,
  progress: null,
  error: null,

  // 앱 시작 시: 저장된 기본값 적용 + 기록 복원 + pending 상태 복구 (/history → /queue 순서로 확인)
  init: async () => {
    const saved = await fetchSettings().catch(() => ({}))
    set((s) => ({ params: { ...s.params, ...saved } }))

    const records = await listGenerations(100)
    const history: HistoryItem[] = records.map((r) => {
      const files = JSON.parse(r.files_json || '[]') as Parameters<typeof viewUrl>[0][]
      return {
        promptId: r.prompt_id,
        params: JSON.parse(r.params_json) as GenerationParams,
        imageUrls: files.map(viewUrl),
        status: r.status,
        starred: !!r.starred,
      }
    })
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
  restore: (params) => set({ params, randomizeSeed: false }),
  select: (promptId) => set({ selectedId: promptId }),

  star: async (promptId) => {
    const item = get().history.find((h) => h.promptId === promptId)
    if (!item) return
    const next = !item.starred
    set((s) => ({ history: s.history.map((h) => (h.promptId === promptId ? { ...h, starred: next } : h)) }))
    await starGeneration(promptId, next)
  },

  remove: async (promptId) => {
    set((s) => ({
      history: s.history.filter((h) => h.promptId !== promptId),
      selectedId: s.selectedId === promptId ? null : s.selectedId,
    }))
    await deleteGeneration(promptId)
  },

  generate: async () => {
    const { params, randomizeSeed } = get()
    const finalParams = { ...params, seed: randomizeSeed ? randomSeed() : params.seed }
    set({ params: finalParams, error: null })
    try {
      const promptId = await submitPrompt(buildGraph(finalParams))
      set((s) => ({
        history: [
          { promptId, params: finalParams, imageUrls: [], status: 'pending' as const, starred: false },
          ...s.history,
        ],
        selectedId: promptId,
      }))
      await recordGeneration(promptId, finalParams)
    } catch (e) {
      set({ error: String(e) })
    }
  },

  onProgress: (promptId, value, max) => set({ progress: { promptId, value, max } }),

  onDone: async (promptId) => {
    if (!get().history.some((h) => h.promptId === promptId)) return
    const outputs = await fetchOutputs(promptId)
    if (outputs && outputs.length > 0) await completeGeneration(promptId, outputs)
    set((s) => ({
      progress: s.progress?.promptId === promptId ? null : s.progress,
      history: s.history.map((h) =>
        h.promptId === promptId ? markDone(h, (outputs ?? []).map(viewUrl)) : h,
      ),
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
}))
