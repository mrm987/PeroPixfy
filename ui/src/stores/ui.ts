import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Tab = 'library' | 'workbench' | 'batch'

interface UiState {
  tab: Tab
  setTab: (tab: Tab) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      tab: 'workbench',
      setTab: (tab) => set({ tab }),
    }),
    { name: 'peropix.ui' },
  ),
)
