import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// PureRef 스타일 레퍼런스 캔버스 — 만든 캐릭터들을 한 보드에 모아 분위기를 확인하는 용도.
// 이미지마다 world 좌표(x,y)와 폭(w, 높이는 이미지 비율로 자동), z-순서를 갖는다.
// 상태는 persist로 저장돼 재실행해도 유지되고, enabled=false면 캔버스를 렌더하지 않아 최적화.

export interface RefItem {
  id: string
  url: string
  x: number // world 좌표(좌상단)
  y: number
  w: number // world 폭(px). 높이는 이미지 비율로 자동
  z: number
}

interface RefBoardState {
  enabled: boolean
  items: RefItem[]
  view: { x: number; y: number; scale: number } // 팬/줌
  dropHint: boolean // 썸네일을 캔버스 위로 드래그 중(강조 표시용, 비영속)
  setDropHint: (v: boolean) => void
  open: () => void // 캔버스 켜기(이미지는 드래그로 추가)
  disable: () => void
  addItem: (url: string, cx?: number, cy?: number) => void // (cx,cy)=드롭 지점 중심(world)
  updateItem: (id: string, patch: Partial<RefItem>) => void
  removeItem: (id: string) => void
  bringFront: (id: string) => void
  clear: () => void
  setView: (v: { x: number; y: number; scale: number }) => void
}

let seq = 0
const nid = () => `r${Date.now().toString(36)}_${(seq++).toString(36)}`
const maxZ = (items: RefItem[]) => items.reduce((m, i) => Math.max(m, i.z), 0)
export const DEFAULT_W = 360 // 추가·초기화 시 기본 폭(px)

export const useRefBoard = create<RefBoardState>()(persist((set) => ({
  enabled: false,
  items: [],
  view: { x: 0, y: 0, scale: 1 },
  dropHint: false,
  setDropHint: (dropHint) => set({ dropHint }),

  open: () => set({ enabled: true }),
  disable: () => set({ enabled: false }),

  addItem: (url, cx = 0, cy = 0) => set((s) => {
    const w = DEFAULT_W // 같은 이미지도 중복으로 추가 허용
    return { items: [...s.items, { id: nid(), url, x: cx - w / 2, y: cy - w / 2, w, z: maxZ(s.items) + 1 }] }
  }),
  updateItem: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  bringFront: (id) => set((s) => {
    const mz = maxZ(s.items)
    return { items: s.items.map((i) => (i.id === id ? { ...i, z: mz + 1 } : i)) }
  }),
  clear: () => set({ items: [] }),
  setView: (view) => set({ view }),
}), {
  name: 'peropix.refboard',
  partialize: (s) => ({ enabled: s.enabled, items: s.items, view: s.view }),
}))
