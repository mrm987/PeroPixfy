import { create } from 'zustand'
import { deleteQueued, fetchOutputs, interrupt, submitPrompt, viewUrl } from '../api/comfy'
import { completeGeneration, failGeneration, recordGeneration, starGeneration } from '../api/gallery'
import { buildGraph } from '../workflow/builder'
import { defaultFilenamePrefix } from '../workflow/defaults'
import { useWorkbench } from './workbench'

const CONCURRENCY = 2

export interface Variation {
  id: string
  label: string
  prompt: string
}

export interface Slot {
  id: string
  variationId: string
  index: number
  promptId: string | null
  seed: number | null
  status: 'idle' | 'queued' | 'done' | 'error'
  imageUrls: string[]
}

const uid = () => Math.random().toString(36).slice(2, 10)
const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

interface BatchState {
  variations: Variation[]
  count: number
  slots: Slot[]
  running: boolean
  confirmed: Record<string, string> // variationId -> slotId

  setCount: (n: number) => void
  addVariation: () => void
  updateVariation: (id: string, patch: Partial<Variation>) => void
  removeVariation: (id: string) => void
  start: () => void
  stop: () => Promise<void>
  confirmSlot: (slot: Slot) => void
  onDone: (promptId: string) => Promise<void>
  onError: (promptId: string) => void
}

export const useBatch = create<BatchState>((set, get) => {
  // 슬라이딩 윈도우 러너: 동시 CONCURRENCY개까지만 큐에 유지
  const pump = async () => {
    const s = get()
    if (!s.running) return
    const inFlight = s.slots.filter((x) => x.status === 'queued').length
    if (inFlight >= CONCURRENCY) return
    const next = s.slots.find((x) => x.status === 'idle')
    if (!next) {
      if (inFlight === 0) set({ running: false })
      return
    }

    const variation = s.variations.find((v) => v.id === next.variationId)
    const base = useWorkbench.getState().params
    const seed = randomSeed()
    const params = {
      ...base,
      seed,
      positive: variation?.prompt ? `${base.positive}, ${variation.prompt}` : base.positive,
      filenamePrefix: defaultFilenamePrefix('batch'),
    }
    // 제출 전에 슬롯을 먼저 queued로 — pump 중복 진입 방지
    set((st) => ({ slots: st.slots.map((x) => (x.id === next.id ? { ...x, status: 'queued' as const, seed } : x)) }))
    try {
      const promptId = await submitPrompt(buildGraph(params))
      set((st) => ({ slots: st.slots.map((x) => (x.id === next.id ? { ...x, promptId } : x)) }))
      await recordGeneration(promptId, params)
    } catch {
      set((st) => ({ slots: st.slots.map((x) => (x.id === next.id ? { ...x, status: 'error' as const } : x)) }))
    }
    pump()
  }

  return {
    variations: [{ id: uid(), label: '변형 1', prompt: '' }],
    count: 4,
    slots: [],
    running: false,
    confirmed: {},

    setCount: (n) => set({ count: Math.max(1, Math.min(64, n)) }),
    addVariation: () =>
      set((s) => ({
        variations: [...s.variations, { id: uid(), label: `변형 ${s.variations.length + 1}`, prompt: '' }],
      })),
    updateVariation: (id, patch) =>
      set((s) => ({ variations: s.variations.map((v) => (v.id === id ? { ...v, ...patch } : v)) })),
    removeVariation: (id) =>
      set((s) => ({ variations: s.variations.filter((v) => v.id !== id) })),

    start: () => {
      const { variations, count, running } = get()
      if (running || variations.length === 0) return
      const slots: Slot[] = variations.flatMap((v) =>
        Array.from({ length: count }, (_, i) => ({
          id: uid(), variationId: v.id, index: i,
          promptId: null, seed: null, status: 'idle' as const, imageUrls: [],
        })),
      )
      set({ slots, running: true, confirmed: {} })
      pump()
      pump()
    },

    stop: async () => {
      set({ running: false })
      const queued = get().slots.filter((x) => x.status === 'queued' && x.promptId)
      if (queued.length > 0) {
        await deleteQueued(queued.map((x) => x.promptId!))
        await interrupt()
        set((s) => ({
          slots: s.slots.map((x) => (x.status === 'queued' ? { ...x, status: 'idle' as const, promptId: null } : x)),
        }))
      }
    },

    confirmSlot: (slot) => {
      if (slot.status !== 'done') return
      set((s) => {
        const next = { ...s.confirmed }
        if (next[slot.variationId] === slot.id) delete next[slot.variationId]
        else next[slot.variationId] = slot.id
        return { confirmed: next }
      })
      if (slot.promptId) starGeneration(slot.promptId, get().confirmed[slot.variationId] === slot.id)
    },

    onDone: async (promptId) => {
      if (!get().slots.some((x) => x.promptId === promptId)) return
      const outputs = await fetchOutputs(promptId)
      if (outputs && outputs.length > 0) await completeGeneration(promptId, outputs)
      set((s) => ({
        slots: s.slots.map((x) =>
          x.promptId === promptId
            ? { ...x, status: 'done' as const, imageUrls: (outputs ?? []).map(viewUrl) }
            : x,
        ),
      }))
      pump()
    },

    onError: (promptId) => {
      if (!get().slots.some((x) => x.promptId === promptId)) return
      failGeneration(promptId)
      set((s) => ({
        slots: s.slots.map((x) => (x.promptId === promptId ? { ...x, status: 'error' as const } : x)),
      }))
      pump()
    },
  }
})
