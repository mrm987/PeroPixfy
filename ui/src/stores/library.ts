import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  fetchLoras, fetchScanStatus, fetchStyles, fetchUpdateStatus,
  setFavorite, startCheckUpdates, startScan, updateLora, updateStyle,
  type LoraEditableFields, type LoraRecord, type ScanState, type StyleRecord, type UpdateState,
} from '../api/library'
import type { LoraEntry } from '../workflow/types'
import { useWorkbench } from './workbench'

export type LoraSort = 'name' | 'recent' | 'favorite'
export type LibMode = 'split' | 'styles' | 'loras'
export type ViewMode = 'grid' | 'list'

interface LibraryState {
  loras: LoraRecord[]
  styles: StyleRecord[]
  loaded: boolean

  // 패널/뷰 상태 (Style-Manager UX)
  mode: LibMode
  styleView: ViewMode
  loraView: ViewMode
  nsfwBlur: boolean
  // 필터
  category: string
  favOnly: boolean
  updatesOnly: boolean
  sort: LoraSort
  tagFilter: string[] // 스타일 태그 AND 필터
  styleLoraFilter: string | null // 이 로라를 쓰는 스타일만 (크로스 점프)
  loraExactFilter: string | null // 이 로라만 강조 (크로스 점프)
  // 백그라운드 작업 상태
  scan: ScanState | null
  update: UpdateState | null

  setMode: (m: LibMode) => void
  setStyleView: (v: ViewMode) => void
  setLoraView: (v: ViewMode) => void
  setNsfwBlur: (v: boolean) => void
  setCategory: (v: string) => void
  setFavOnly: (v: boolean) => void
  setUpdatesOnly: (v: boolean) => void
  setSort: (v: LoraSort) => void
  toggleTag: (tag: string) => void
  jumpToStylesUsing: (relPath: string) => void
  jumpToLora: (relPath: string) => void
  clearJumps: () => void

  load: () => Promise<void>
  toggleFavorite: (relPath: string) => Promise<void>
  saveLora: (relPath: string, fields: LoraEditableFields) => Promise<void>
  renameStyle: (id: number, name: string) => Promise<void>
  rescan: (force?: boolean) => Promise<void>
  checkUpdates: () => Promise<void>
  applyStyle: (style: StyleRecord) => void
  addLoraToWorkbench: (relPath: string) => void
}

let pollTimer: ReturnType<typeof setInterval> | null = null

export const useLibrary = create<LibraryState>()(persist((set, get) => {
  // 스캔/업데이트 체크가 도는 동안 1초 간격으로 상태 폴링, 끝나면 목록 새로고침
  const startPolling = () => {
    if (pollTimer) return
    pollTimer = setInterval(async () => {
      const [scan, update] = await Promise.all([fetchScanStatus(), fetchUpdateStatus()])
      set({ scan, update })
      if (!scan.scanning && !update.checking) {
        clearInterval(pollTimer!)
        pollTimer = null
        get().load()
      }
    }, 1000)
  }

  return {
    loras: [],
    styles: [],
    loaded: false,
    mode: 'split',
    styleView: 'grid',
    loraView: 'grid',
    nsfwBlur: true,
    category: '',
    favOnly: false,
    updatesOnly: false,
    sort: 'recent',
    tagFilter: [],
    styleLoraFilter: null,
    loraExactFilter: null,
    scan: null,
    update: null,

    setMode: (mode) => set({ mode }),
    setStyleView: (styleView) => set({ styleView }),
    setLoraView: (loraView) => set({ loraView }),
    setNsfwBlur: (nsfwBlur) => set({ nsfwBlur }),
    setCategory: (category) => set({ category }),
    setFavOnly: (favOnly) => set({ favOnly }),
    setUpdatesOnly: (updatesOnly) => set({ updatesOnly }),
    setSort: (sort) => set({ sort }),
    toggleTag: (tag) =>
      set((s) => ({
        tagFilter: s.tagFilter.includes(tag)
          ? s.tagFilter.filter((t) => t !== tag)
          : [...s.tagFilter, tag],
      })),
    jumpToStylesUsing: (relPath) =>
      set((s) => ({ styleLoraFilter: relPath, mode: s.mode === 'loras' ? 'split' : s.mode })),
    jumpToLora: (relPath) =>
      set((s) => ({ loraExactFilter: relPath, mode: s.mode === 'styles' ? 'split' : s.mode })),
    clearJumps: () => set({ styleLoraFilter: null, loraExactFilter: null }),

    load: async () => {
      const [{ loras, scan }, styles] = await Promise.all([fetchLoras(), fetchStyles()])
      set({ loras, styles, scan, loaded: true })
      if (scan.scanning) startPolling()
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

    renameStyle: async (id, name) => {
      await updateStyle(id, { name })
      set({ styles: get().styles.map((s) => (s.id === id ? { ...s, name } : s)) })
    },

    rescan: async (force = false) => {
      await startScan(force)
      startPolling()
    },

    checkUpdates: async () => {
      await startCheckUpdates()
      startPolling()
    },

    // 현재 작업대 파라미터에 스타일을 적용 (탭 전환은 호출부 책임 —
    // 라이브러리에서는 작업대로 이동, 드로어에서는 그 자리 유지)
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
    },

    addLoraToWorkbench: (relPath) => {
      const wb = useWorkbench.getState()
      if (wb.params.loras.some((l) => l.relPath === relPath)) return
      wb.setLoras([...wb.params.loras, { relPath, strength: 0.8, enabled: true }])
    },
  }
}, {
  name: 'peropix.library',
  partialize: (s) => ({
    mode: s.mode, styleView: s.styleView, loraView: s.loraView, nsfwBlur: s.nsfwBlur,
    category: s.category, favOnly: s.favOnly, updatesOnly: s.updatesOnly, sort: s.sort,
  }),
}))
