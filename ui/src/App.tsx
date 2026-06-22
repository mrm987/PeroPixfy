import { useEffect, useState } from 'react'
import { openSocket } from './api/comfy'
import { useT } from './i18n'
import { LibraryDock } from './components/LibraryDock'
import { OptionsModal } from './components/OptionsModal'
import { Resizer } from './components/Resizer'
import { SetupBanner } from './components/SetupBanner'
import { useBatch } from './stores/batch'
import { useUi, type Tab } from './stores/ui'
import { useWorkbench } from './stores/workbench'
import { BatchTab } from './tabs/batch/BatchTab'
import { WorkbenchTab } from './tabs/workbench/WorkbenchTab'

const TABS: { id: Tab; label: string }[] = [
  { id: 'workbench', label: 'Single' },
  { id: 'batch', label: 'Multi' },
]

// 해시 동기화 effect가 URL을 덮어쓰기 전(모듈 로드 시점)에 초기 진입 해시/딥링크를 확보
const initialHash = location.hash.replace('#', '') as Tab
const wantLibOpen = new URLSearchParams(location.search).has('drawer')

export default function App() {
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)
  const libOpen = useUi((s) => s.libOpen)
  const openLib = useUi((s) => s.openLib)
  const dockW = useUi((s) => s.dockW)
  const setPref = useUi((s) => s.setPref)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const t = useT()

  // 구버전 persist에 'library' 등 유효하지 않은 탭이 남아 있으면 교정
  useEffect(() => {
    if (tab !== 'workbench' && tab !== 'batch') setTab('workbench')
  }, [tab, setTab])

  // 탭 ↔ URL 해시 양방향 동기화 (#workbench / #batch 직접 진입·북마크 가능)
  useEffect(() => {
    history.replaceState(null, '', '#' + tab)
  }, [tab])

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace('#', '') as Tab
      if (TABS.some((t) => t.id === h)) setTab(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [setTab])

  useEffect(() => {
    if (TABS.some((t) => t.id === initialHash)) setTab(initialHash)
    if (wantLibOpen) useUi.getState().openLib()

    useWorkbench.getState().init()

    let ws: WebSocket
    let closed = false
    let retryDelay = 1000

    const connect = () => {
      const wb = useWorkbench.getState()
      const batch = useBatch.getState()
      ws = openSocket({
        onProgress: (id, v, m) => { wb.onProgress(id, v, m); batch.onProgress(id, v, m) },
        onDone: (id) => { wb.onDone(id); batch.onDone(id) },
        onError: (id) => { wb.onError(id); batch.onError(id) },
      })
      ws.onopen = () => { retryDelay = 1000 }
      ws.onclose = () => {
        if (closed) return
        setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 15000)
      }
    }
    connect()
    return () => { closed = true; ws.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 유효하지 않은 탭은 Single로 폴백 (교정 effect가 곧 setTab 처리)
  const activeTab: Tab = tab === 'batch' ? 'batch' : 'workbench'

  return (
    <div className="app-shell">
      <nav className="tab-bar">
        {TABS.map((tb) => (
          <button key={tb.id} className={activeTab === tb.id ? 'active' : ''} onClick={() => setTab(tb.id)}>
            {t(tb.label)}
          </button>
        ))}
        <button className="tab-options" title={t('Settings')} onClick={() => setOptionsOpen(true)}>⚙</button>
      </nav>
      <SetupBanner />
      <div className="app-body">
        <main className="tab-content">
          {activeTab === 'batch' ? <BatchTab /> : <WorkbenchTab />}
        </main>
        {libOpen ? (
          <>
            <Resizer value={dockW} onChange={(w) => setPref({ dockW: w })} dir={-1} min={320} max={820} />
            <LibraryDock />
          </>
        ) : (
          <button className="lib-rail" onClick={openLib} title={t('Open Styles & LoRAs')}>
            <span className="rail-mark">«</span>
            <span className="rail-text">{t('Styles & LoRAs')}</span>
          </button>
        )}
      </div>
      {optionsOpen && <OptionsModal onClose={() => setOptionsOpen(false)} />}
    </div>
  )
}
