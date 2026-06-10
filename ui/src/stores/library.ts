import { create } from 'zustand'
import {
  fetchLoras, fetchStyles, setFavorite, startScan,
  type LoraRecord, type StyleRecord,
} from '../api/library'
import type { LoraEntry } from '../workflow/types'
import { useWorkbench } from './workbench'
import { useUi } from './ui'

interface LibraryState {
  loras: LoraRecord[]
  styles: StyleRecord[]
  loaded: boolean
  load: () => Promise<void>
  toggleFavorite: (relPath: string) => Promise<void>
  rescan: () => Promise<void>
  applyStyle: (style: StyleRecord) => void
  addLoraToWorkbench: (relPath: string) => void
}

export const useLibrary = create<LibraryState>((set, get) => ({
  loras: [],
  styles: [],
  loaded: false,

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
}))
