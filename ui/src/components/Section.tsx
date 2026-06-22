import type { ReactNode } from 'react'
import { useUi } from '../stores/ui'

/**
 * 좌측 파라미터 패널의 접고펼 수 있는 섹션. 접힘 상태는 useUi.collapsed에 id별로
 * 영속되어, 필요한 항목만 펼쳐 두고 쓸 수 있다.
 */
export function Section({
  id,
  title,
  summary,
  children,
}: {
  id: string
  title: string
  summary?: ReactNode // 접었을 때 타이틀 옆에 보여줄 요약 (예: 현재 해상도)
  children: ReactNode
}) {
  const collapsed = useUi((s) => !!s.collapsed?.[id])
  const toggle = useUi((s) => s.toggleSection)
  return (
    <div className={`section${collapsed ? ' collapsed' : ''}`}>
      <button type="button" className="section-head" onClick={() => toggle(id)}>
        <span className="section-caret">{collapsed ? '▸' : '▾'}</span>
        <span className="section-title">{title}</span>
        {collapsed && summary != null && <span className="section-summary">{summary}</span>}
      </button>
      {!collapsed && <div className="section-body">{children}</div>}
    </div>
  )
}
