import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  fetchLoras, fetchStyles, setFavorite, startScan, updateLora,
  type LoraEditableFields, type LoraRecord, type StyleRecord,
} from '../api/library'
import type { LoraEntry } from '../workflow/types'
import { useUi } from './ui'
import { useWorkbench } from './workbench'

export type LoraSort = 'name' | 'recent' | 'favorite'

interface LibraryState {
  loras: LoraRecord[]
  styles: StyleRecord[]
  loaded: boolean
  category: string
  favOnly: boolean
  sort: LoraSort

  setCategory: (v: string) => void
  setFavOnly: (v: boolean) => void
  setSort: (v: LoraSort) => void
  load: () => Promise<void>
  toggleFavorite: (relPath: string) => Promise<void>
  saveLora: (relPath: string, fields: LoraEditableFields) => Promise<void>
  rescan: () => Promise<void>
  applyStyle: (style: StyleRecord) => void
  addLoraToWorkbench: (relPath: string) => void
}

export const useLibrary = create<LibraryState>()(persist((set, get) => ({
  loras: [],
  styles: [],
  loaded: false,
  category: '',
  favOnly: false,
  sort: 'recent',

  setCategory: (v) => set({ category: v }),
  setFavOnly: (v) => set({ favOnly: v }),
  setSort: (v) => set({ sort: v }),

  load: async () => {
    const [{ loras }, styles] = await Promise.all([fetchLoras(), fetchStyles()])
    set({ loras, styles, loaded: true })
  },

  toggleFavorite: async (relPath) => {
    const lora = get().loras.find((l) => l.rel_path === relPath)
    if (!lora) return
    const next = lora.favorite ? 0 : 1
    set({ loras: get().loras.map((l) => (l.rel_path === relPath ? { ...l, favorite: next } : l)) })
    await setFavorite(relPath, !!next)
  },

  saveLora: async (relPath, fields) => {
    await updateLora(relPath, fields)
    set({ loras: get().loras.map((l) => (l.rel_path === relPath ? { ...l, ...fields } : l)) })
  },

  rescan: async () => {
    await startScan()
    // 스캔은 백그라운드 — 잠시 후 새로고침
    setTimeout(() => get().load(), 3000)
  },

  applyStyle: (style) => {
    const loras: LoraEntry[] = (style.loras ?? [])
      .filter((l) => l.lora_rel_path)
      .map((l) => ({ relPath: l.lora_rel_path, strength: l.strength, enabled: !!l.enabled }))
    const wb = useWorkbench.getState()
    wb.set({
      positive: style.positive_prompt,
      negative: style.negative_prompt,
      loras,
      ...(style.checkpoint ? { unet: style.checkpoint } : {}),
      ...(style.width > 0 && style.height > 0 ? { width: style.width, height: style.height } : {}),
    })
    useUi.getState().setTab('workbench')
  },

  addLoraToWorkbench: (relPath) => {
    const wb = useWorkbench.getState()
    if (wb.params.loras.some((l) => l.relPath === relPath)) return
    wb.setLoras([...wb.params.loras, { relPath, strength: 0.8, enabled: true }])
  },
}), {
  name: 'peropix.library',
  partialize: (s) => ({ category: s.category, favOnly: s.favOnly, sort: s.sort }),
}))
