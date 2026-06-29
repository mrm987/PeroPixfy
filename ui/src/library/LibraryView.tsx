import { useEffect, useRef } from 'react'
import { useLibrary } from '../stores/library'
import { useUi } from '../stores/ui'
import { useWorkbench } from '../stores/workbench'
import { mountLibrary } from './libraryEngine'

type DrawerMode = 'both' | 'styles' | 'loras'

const toEntries = (loras: { relPath: string; enabled: boolean }[]) =>
  loras.map((l) => ({ relPath: l.relPath, enabled: l.enabled }))

/**
 * 원본 Style-Manager 프론트엔드(libraryEngine.js)를 그대로 탑재하는 얇은 래퍼.
 * 엔진이 자체 DOM·상태·스타일을 모두 관리하고, PeroPixComfy 연동만 주입한다:
 *   - 스타일 Apply → 작업대 파라미터 적용 (useLibrary.applyStyle)
 *   - 로라 ＋Stack → 작업대 로라 스택 추가 (useLibrary.addLoraToWorkbench)
 *   - 현재 작업대 스택을 ACTIVE / IN STACK 뱃지에 반영 (handle.setStack)
 */
export function LibraryView({ initialMode }: { initialMode?: DrawerMode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = ref.current
    if (!container) return
    const handle = mountLibrary(container, {
      initialMode,
      onApplyStyle: (style: unknown) => useLibrary.getState().applyStyle(style as never),
      onAddLora: (relPath: string) => useLibrary.getState().addLoraToWorkbench(relPath),
      onRemoveLora: (relPath: string) => useLibrary.getState().removeLoraFromWorkbench(relPath),
      // 엔진이 로라 목록을 새로 받을 때마다(스캔 완료·편집 저장 등) React 스토어도 같은
      // 데이터로 갱신하고, 설치목록(/object_info 기반 availableLoras)도 다시 받는다 —
      // 실행 중 추가·스캔한 LoRA를 로라 스택/피커가 즉시 인식하도록.
      onLorasRefreshed: (loras: unknown) => {
        useLibrary.setState({ loras: loras as never })
        useWorkbench.getState().refreshAvailable()
      },
    })

    // 현재 작업대 스택을 뱃지에 반영하고, 이후 스택 변경을 구독해 따라간다.
    let prevLoras = useWorkbench.getState().params.loras
    handle.setStack(toEntries(prevLoras))
    const unsub = useWorkbench.subscribe((s) => {
      if (s.params.loras !== prevLoras) {
        prevLoras = s.params.loras
        handle.setStack(toEntries(prevLoras))
      }
    })

    // 스타일이 저장되면(styleRev 증가) styles 목록을 다시 불러온다 — 도크가 이미
    // 펼쳐져 있어도 방금 저장한 스타일이 바로 보이도록.
    let prevRev = useUi.getState().styleRev
    const unsubUi = useUi.subscribe((s) => {
      if (s.styleRev !== prevRev) {
        prevRev = s.styleRev
        const fid = useUi.getState().focusStyleId
        handle.refreshStyles?.(fid)   // fid 있으면 스타일 탭 전환 + 해당 카드 강조
        if (fid != null) useUi.getState().setFocusStyle(null)
      }
    })

    return () => {
      unsub()
      unsubUi()
      handle.destroy()
    }
  }, [initialMode])

  return <div ref={ref} className="lm-mount" />
}
