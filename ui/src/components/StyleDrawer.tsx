import { useEffect, useState } from 'react'
import { useLibrary } from '../stores/library'
import { LorasPanel } from '../tabs/library/LorasPanel'
import { StylesPanel } from '../tabs/library/StylesPanel'

type DrawerMode = 'styles' | 'loras' | 'split'

const MODES: { id: DrawerMode; label: string }[] = [
  { id: 'styles', label: 'Styles' },
  { id: 'loras', label: 'LoRAs' },
  { id: 'split', label: 'Split' },
]

/**
 * 작업대/배치용 라이브러리 드로어 — Library 탭의 실제 패널을 그대로 탑재해서
 * (Style-Manager 사이드바와 동일한 정보량) 스타일 적용과 로라 스택 추가를
 * 탭 이동 없이 할 수 있다. split은 Style-Manager처럼 상하 배치.
 */
// ?drawer=loras / ?drawer=split 으로 초기 모드 지정 가능 (기본 styles)
const initialMode = ((): DrawerMode => {
  const v = new URLSearchParams(location.search).get('drawer')
  return v === 'loras' || v === 'split' ? v : 'styles'
})()

export function StyleDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { loaded, load } = useLibrary()
  const [mode, setMode] = useState<DrawerMode>(initialMode)

  useEffect(() => {
    if (open && !loaded) load()
  }, [open, loaded, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="style-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="lib-mode-bar">
            {MODES.map((m) => (
              <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className={`lib-body drawer-body ${mode}`}>
          {mode !== 'loras' && <StylesPanel embedded />}
          {mode !== 'styles' && <LorasPanel />}
        </div>
      </aside>
    </div>
  )
}
