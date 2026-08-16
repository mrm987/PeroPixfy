import type { WsData } from '../stores/workbench'

// 워크스페이스 목록은 서버(data/loras.db)가 원장이다 — 생성 기록이 workspace id로 이 목록을
// 참조하므로 둘이 같은 곳에 있어야 한다. 브라우저에는 탭 상태(열림 목록·활성 탭)만 남는다.
const BASE = '/peropixfy/api/workspaces'

export interface WorkspaceRow {
  id: string
  name: string
  data: Partial<WsData>
}

export async function fetchWorkspaces(): Promise<WorkspaceRow[]> {
  const res = await fetch(BASE)
  return (await res.json()).workspaces ?? []
}

export async function saveWorkspaces(workspaces: WorkspaceRow[]): Promise<void> {
  await fetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaces }),
  })
}
