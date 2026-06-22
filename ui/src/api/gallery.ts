import type { OutputImage } from './comfy'
import type { GenerationParams } from '../workflow/types'

const BASE = '/peropix/api/gallery'

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

export const recordGeneration = (promptId: string, params: GenerationParams, source: GenSource = 'single') =>
  post('record', { prompt_id: promptId, params, source })

export const completeGeneration = (promptId: string, files: OutputImage[]) =>
  post('complete', { prompt_id: promptId, files })

export const failGeneration = (promptId: string) => post('fail', { prompt_id: promptId })

export const starGeneration = (promptId: string, starred: boolean) =>
  post('star', { prompt_id: promptId, starred })

export const deleteGeneration = (promptId: string) => post('delete', { prompt_id: promptId })

export async function listGenerations(limit = 100, source?: GenSource): Promise<GenerationRecord[]> {
  const q = source ? `&source=${source}` : ''
  const res = await fetch(`${BASE}/list?limit=${limit}${q}`)
  return (await res.json()).generations ?? []
}
