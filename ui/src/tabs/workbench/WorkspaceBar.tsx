import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useWorkbench } from '../../stores/workbench'

/**
 * Single 탭 상단 워크스페이스 탭 바.
 * - 탭 클릭 = 전환, 더블클릭 = 이름 변경
 * - 탭 ✕ = 닫기(데이터 보존 — + 메뉴에서 다시 열 수 있음), 마지막 열린 탭은 못 닫음
 * - ＋ = 메뉴: 새 워크스페이스 / 닫아둔 워크스페이스 다시 열기 / 완전 삭제(폴더+데이터)
 * 각 워크스페이스는 독립된 히스토리·좌측 세팅·출력 폴더를 가진다(스타일/로라는 전역 공유).
 */
export function WorkspaceBar() {
  const t = useT()
  const workspaces = useWorkbench((s) => s.workspaces)
  const openIds = useWorkbench((s) => s.openIds)
  const activeWs = useWorkbench((s) => s.activeWs)
  const switchWorkspace = useWorkbench((s) => s.switchWorkspace)
  const createWorkspace = useWorkbench((s) => s.createWorkspace)
  const openWorkspace = useWorkbench((s) => s.openWorkspace)
  const closeWorkspace = useWorkbench((s) => s.closeWorkspace)
  const renameWorkspace = useWorkbench((s) => s.renameWorkspace)
  const deleteWorkspace = useWorkbench((s) => s.deleteWorkspace)

  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)

  const byId = new Map(workspaces.map((w) => [w.id, w]))
  const tabs = openIds.map((id) => byId.get(id)).filter(Boolean) as { id: string; name: string }[]
  const closed = workspaces.filter((w) => !openIds.includes(w.id))

  const commitRename = () => {
    if (editing && editing.name.trim()) void renameWorkspace(editing.id, editing.name.trim())
    setEditing(null)
  }

  // + 메뉴: 바깥 클릭/Esc로 닫기
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => { if (!addRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  return (
    <div className="workspace-tab-bar">
      {tabs.map((w) => (
        <div key={w.id} className={`workspace-tab${w.id === activeWs ? ' active' : ''}`}
          onClick={() => { if (w.id !== activeWs) void switchWorkspace(w.id) }}
          onDoubleClick={() => setEditing({ id: w.id, name: w.name })}>
          {editing?.id === w.id ? (
            <input className="workspace-tab-edit" autoFocus value={editing.name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditing({ id: w.id, name: e.target.value })}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null) }} />
          ) : (
            <span className="workspace-tab-name" title={t('Double-click to rename')}>{w.name}</span>
          )}
          {/* 탭 닫기(✕): 데이터 보존, + 메뉴에서 다시 열 수 있음. 마지막 열린 탭은 못 닫음. */}
          {tabs.length > 1 && (
            <button className="workspace-tab-close" title={t('Close tab (keeps data)')}
              onClick={(e) => { e.stopPropagation(); void closeWorkspace(w.id) }}>✕</button>
          )}
        </div>
      ))}

      <div className="ws-add-wrap" ref={addRef}>
        <button className="workspace-tab-new" title={t('Add workspace')}
          onClick={() => setMenuOpen((o) => !o)}>＋</button>
        {menuOpen && (
          <div className="ws-menu">
            <button className="ws-menu-new" onClick={() => { setMenuOpen(false); createWorkspace() }}>
              {t('＋ New workspace')}
            </button>
            {closed.length > 0 && (
              <>
                <div className="ws-menu-label">{t('Closed workspaces')}</div>
                {closed.map((w) => (
                  <div key={w.id} className="ws-menu-item">
                    <button className="ws-menu-open" title={t('Reopen this workspace')}
                      onClick={() => { setMenuOpen(false); void openWorkspace(w.id) }}>{w.name}</button>
                    <button className="ws-menu-del" title={t('Delete permanently (folder + all images)')}
                      onClick={() => {
                        if (confirm(t('Permanently delete workspace "{name}"? Its folder and ALL its images will be deleted. This cannot be undone.', { name: w.name }))) {
                          void deleteWorkspace(w.id)
                        }
                      }}>🗑</button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
