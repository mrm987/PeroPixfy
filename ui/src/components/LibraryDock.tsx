import { useT } from '../i18n'
import { useUi } from '../stores/ui'
import { LibraryView } from '../library/LibraryView'

// ?drawer=loras / ?drawer=styles 으로 초기 모드를 강제할 수 있다.
// ★ 쿼리가 없으면 undefined를 넘겨 엔진이 마지막으로 고른 모드를 복원하게 둔다.
// 여기서 'both'를 넘기면 그 복원을 매번 덮어써 저장이 무의미해진다.
const dockInitialMode = ((): 'styles' | 'loras' | undefined => {
  const v = new URLSearchParams(location.search).get('drawer')
  return v === 'loras' || v === 'styles' ? v : undefined
})()

/**
 * 우측 도킹 라이브러리 패널 — 모달이 아니다(백드롭 없음). 메인 작업 패널과 같은
 * 레이어에 flex 형제로 공존하므로, 펼친 채로도 좌측을 계속 조작할 수 있다.
 * 접기는 상단바 ✦ 버튼 또는 헤더의 » 로 (App의 libOpen 토글).
 */
export function LibraryDock() {
  const t = useT()
  const closeLib = useUi((s) => s.closeLib)
  const dockW = useUi((s) => s.dockW)
  return (
    <aside className="library-dock" style={{ width: dockW }}>
      <div className="dock-header">
        <button className="dock-collapse" onClick={closeLib} title={t('Collapse panel')}>»</button>
        <span className="dock-title">{t('✦ Styles & LoRAs')}</span>
        <span style={{ flex: 1 }} />
      </div>
      <div className="dock-body">
        <LibraryView initialMode={dockInitialMode} />
      </div>
    </aside>
  )
}
