import { useEffect } from 'react'
import { openSocket } from './api/comfy'
import { useUi, type Tab } from './stores/ui'
import { useWorkbench } from './stores/workbench'
import { LibraryTab } from './tabs/library/LibraryTab'
import { WorkbenchTab } from './tabs/workbench/WorkbenchTab'

const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: '라이브러리' },
  { id: 'workbench', label: '작업대' },
  { id: 'batch', label: '배치' },
]

export default function App() {
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)

  useEffect(() => {
    let ws: WebSocket
    let closed = false
    let retryDelay = 1000

    const connect = () => {
      const s = useWorkbench.getState()
      ws = openSocket({ onProgress: s.onProgress, onDone: s.onDone, onError: s.onError })
      ws.onopen = () => { retryDelay = 1000 }
      ws.onclose = () => {
        if (closed) return
        setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 15000)
      }
    }
    connect()
    return () => { closed = true; ws.close() }
  }, [])

  return (
    <div className="app-shell">
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="tab-content">
        {tab === 'library' && <LibraryTab />}
        {tab === 'workbench' && <WorkbenchTab />}
        {tab === 'batch' && <div className="placeholder" style={{ padding: 40 }}>배치 탭 — M5에서 구현</div>}
      </main>
    </div>
  )
}
