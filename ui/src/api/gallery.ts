import type { OutputImage } from './comfy'
import type { GenerationParams } from '../workflow/types'

const BASE = '/peropixfy/api/gallery'

export interface GenerationRecord {
  prompt_id: string
  params_json: string
  files_json: string
  status: 'pending' | 'done' | 'error'
  starred: number
  created_at: number
}

async function post(path: string, body: unknown): Promise<void> {
  await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export type GenSource = 'single' | 'multi'

export const recordGeneration = (promptId: string, params: GenerationParams, source: GenSource = 'single', workspace = '') =>
  post('record', { prompt_id: promptId, params, source, workspace })

// 워크스페이스 '완전 삭제' — 그 작업의 DB 기록 + 이미지 파일 + (전용) 폴더까지 전부 제거.
export const deleteWorkspaceData = (workspace: string, folder: string) =>
  post('delete-workspace-data', { workspace, folder })

// 선택한 기록들을 다른 워크스페이스로 복제 — 원본은 두고, 대상에 새 기록 + 파일 사본을 만든다.
export const copyToWorkspace = (promptIds: string[], workspace: string, folder: string) =>
  post('copy-to-workspace', { prompt_ids: promptIds, workspace, folder })

// 워크스페이스 이름 변경 시, 그 작업의 출력 파일을 옛 폴더→새 폴더로 실제 이동하고 DB 경로도 갱신.
// (폴더가 둘로 쪼개지지 않게 기존 이미지를 새 이름 폴더로 함께 옮긴다.)
export const renameWorkspaceFolder = (workspace: string, oldRoot: string, newRoot: string) =>
  post('rename-folder', { workspace, old_root: oldRoot, new_root: newRoot })

export const completeGeneration = (promptId: string, files: OutputImage[]) =>
  post('complete', { prompt_id: promptId, files })

export const failGeneration = (promptId: string) => post('fail', { prompt_id: promptId })

export const starGeneration = (promptId: string, starred: boolean) =>
  post('star', { prompt_id: promptId, starred })

export const deleteGeneration = (promptId: string) => post('delete', { prompt_id: promptId })

export async function listGenerations(limit = 100, source?: GenSource, workspace?: string): Promise<GenerationRecord[]> {
  const q = source ? `&source=${source}` : ''
  const w = workspace !== undefined ? `&workspace=${encodeURIComponent(workspace)}` : ''
  const res = await fetch(`${BASE}/list?limit=${limit}${q}${w}`)
  return (await res.json()).generations ?? []
}
