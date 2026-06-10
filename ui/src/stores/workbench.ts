import { create } from 'zustand'
import { fetchOutputs, submitPrompt, viewUrl } from '../api/comfy'
import { buildGraph } from '../workflow/builder'
import { ANIMA_DEFAULTS } from '../workflow/defaults'
import type { GenerationParams, LoraEntry } from '../workflow/types'

export interface HistoryItem {
  promptId: string
  params: GenerationParams
  imageUrls: string[]
  status: 'pending' | 'done' | 'error'
}

const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

interface WorkbenchState {
  params: GenerationParams
  randomizeSeed: boolean
  history: HistoryItem[]
  selectedId: string | null
  progress: { promptId: string; value: number; max: number } | null
  error: string | null

  set: (patch: Partial<GenerationParams>) => void
  setRandomize: (v: boolean) => void
  setLoras: (loras: LoraEntry[]) => void
  restore: (params: GenerationParams) => void
  select: (promptId: string) => void
  generate: () => Promise<void>
  onProgress: (promptId: string, value: number, max: number) => void
  onDone: (promptId: string) => Promise<void>
  onError: (promptId: string) => void
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  params: ANIMA_DEFAULTS,
  randomizeSeed: true,
  history: [],
  selectedId: null,
  progress: null,
  error: null,

  set: (patch) => set((s) => ({ params: { ...s.params, ...patch } })),
  setRandomize: (v) => set({ randomizeSeed: v }),
  setLoras: (loras) => set((s) => ({ params: { ...s.params, loras } })),
  restore: (params) => set({ params, randomizeSeed: false }),
  select: (promptId) => set({ selectedId: promptId }),

  generate: async () => {
    const { params, randomizeSeed } = get()
    const finalParams = { ...params, seed: randomizeSeed ? randomSeed() : params.seed }
    set({ params: finalParams, error: null })
    try {
      const promptId = await submitPrompt(buildGraph(finalParams))
      set((s) => ({
        history: [{ promptId, params: finalParams, imageUrls: [], status: 'pending' as const }, ...s.history],
        selectedId: promptId,
      }))
    } catch (e) {
      set({ error: String(e) })
    }
  },

  onProgress: (promptId, value, max) => set({ progress: { promptId, value, max } }),

  onDone: async (promptId) => {
    if (!get().history.some((h) => h.promptId === promptId)) return
    const outputs = await fetchOutputs(promptId)
    set((s) => ({
      progress: s.progress?.promptId === promptId ? null : s.progress,
      history: s.history.map((h) =>
        h.promptId === promptId
          ? { ...h, status: 'done' as const, imageUrls: (outputs ?? []).map(viewUrl) }
          : h,
      ),
    }))
  },

  onError: (promptId) =>
    set((s) => ({
      progress: s.progress?.promptId === promptId ? null : s.progress,
      history: s.history.map((h) => (h.promptId === promptId ? { ...h, status: 'error' as const } : h)),
    })),
}))
