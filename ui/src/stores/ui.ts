import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Tab = 'workbench' | 'batch'
export type Lang = 'en' | 'ko'

// 시스템 언어가 한국어면 ko, 아니면 en (persist 값이 없을 때의 기본).
const detectLang = (): Lang =>
  typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en'

interface UiState {
  tab: Tab
  setTab: (tab: Tab) => void
  lang: Lang // UI 언어 (영속). 기본 = 시스템 언어. 옵션에서 변경.
  // 라이브러리(스타일/로라) 도크 — 모달이 아니라 우측에 도킹되는 패널이라,
  // 펼친 채로도 메인 작업 패널을 계속 조작할 수 있다. 두 탭이 공유한다.
  libOpen: boolean
  openLib: () => void
  closeLib: () => void
  toggleLib: () => void
  // 스타일 저장 등으로 라이브러리 내용이 바뀌면 증가 → 열려 있는 도크가 styles를 다시 불러온다.
  styleRev: number
  bumpStyleRev: () => void
  // 레이아웃 사용자 설정 (영속): 패널 너비(px), 프롬프트/네거티브 textarea 높이(px)
  singleW: number // Single 탭 좌측 컨트롤 패널 너비
  multiW: number // Multi 탭 좌측 패널 너비
  dockW: number // 라이브러리 도크 너비
  promptH: number | null
  negativeH: number | null
  multiSub: 'base' | 'slot' // Multi 좌측 Base/Slot 서브탭 마지막 선택 (영속)
  setPref: (
    patch: Partial<Pick<UiState, 'singleW' | 'multiW' | 'dockW' | 'promptH' | 'negativeH' | 'multiSub' | 'lang'>>,
  ) => void
  // 좌측 파라미터 패널 각 섹션 접힘 상태 (섹션 id → true면 접힘)
  collapsed: Record<string, boolean>
  toggleSection: (id: string) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      tab: 'workbench',
      setTab: (tab) => set({ tab }),
      lang: detectLang(),
      libOpen: false,
      openLib: () => set({ libOpen: true }),
      closeLib: () => set({ libOpen: false }),
      toggleLib: () => set((s) => ({ libOpen: !s.libOpen })),
      styleRev: 0,
      bumpStyleRev: () => set((s) => ({ styleRev: s.styleRev + 1 })),
      singleW: 400,
      multiW: 360,
      dockW: 460,
      promptH: null,
      negativeH: null,
      multiSub: 'base',
      setPref: (patch) => set(patch),
      collapsed: { advanced: true },
      toggleSection: (id) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
    }),
    {
      name: 'peropix.ui',
      partialize: (s) => ({
        tab: s.tab,
        lang: s.lang,
        singleW: s.singleW,
        multiW: s.multiW,
        dockW: s.dockW,
        promptH: s.promptH,
        negativeH: s.negativeH,
        multiSub: s.multiSub,
        collapsed: s.collapsed,
      }),
    },
  ),
)
