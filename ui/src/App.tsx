import { useEffect } from 'react'
import { openSocket } from './api/comfy'
import { useBatch } from './stores/batch'
import { useUi, type Tab } from './stores/ui'
import { useWorkbench } from './stores/workbench'
import { BatchTab } from './tabs/batch/BatchTab'
import { LibraryTab } from './tabs/library/LibraryTab'
import { WorkbenchTab } from './tabs/workbench/WorkbenchTab'

const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'workbench', label: 'Workbench' },
  { id: 'batch', label: 'Batch' },
]

// 해시 동기화 effect가 URL을 덮어쓰기 전에(모듈 로드 시점) 초기 진입 해시를 확보
const initialHash = location.hash.replace('#', '') as Tab

export default function App() {
  const tab = useUi((s) => s.tab)
  const setTab = useUi((s) => s.setTab)

  // 탭 ↔ URL 해시 양방향 동기화 (#library / #workbench / #batch 직접 진입·북마크 가능)
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

    useWorkbench.getState().init()

    let ws: WebSocket
    let closed = false
    let retryDelay = 1000

    const connect = () => {
      const wb = useWorkbench.getState()
      const batch = useBatch.getState()
      ws = openSocket({
        onProgress: wb.onProgress,
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
        {tab === 'batch' && <BatchTab />}
      </main>
    </div>
  )
}
