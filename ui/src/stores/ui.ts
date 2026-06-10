import { create } from 'zustand'

export type Tab = 'library' | 'workbench' | 'batch'

interface UiState {
  tab: Tab
  setTab: (tab: Tab) => void
}

export const useUi = create<UiState>((set) => ({
  tab: 'workbench',
  setTab: (tab) => set({ tab }),
}))
