const BASE = '/peropix/api/library'

export interface LoraRecord {
  rel_path: string
  file_name: string
  name: string
  trigger_words: string
  thumb_url: string
  thumb_type: string // 'image' | 'video'
  base_model: string
  base_category: string
  civitai_url: string
  nsfw: number
  favorite: number
  scanned: number
  ctime: number
  updated_at: number
  style_count: number
  latest_version_id: number
  latest_version_name: string
}

export interface StyleLoraRef {
  display_name: string
  lora_rel_path: string
  strength: number
  enabled: number
}

export interface StyleRecord {
  id: number
  name: string
  image_file: string
  image_missing: boolean
  width: number
  height: number
  checkpoint: string
  positive_prompt: string
  negative_prompt: string
  sampler: string
  scheduler: string
  seed: number
  steps: number
  cfg: number
  tags: string
  notes: string
  nsfw: number
  loras?: StyleLoraRef[]
}

export interface ScanState {
  scanning: boolean
  done: number
  total: number
  current: string
}

export interface UpdateState {
  checking: boolean
  done: number
  total: number
  updates: number
  errors: number
}

/** 사용자 편집 가능 필드 (서버 UPDATABLE 화이트리스트와 동일). */
export type LoraEditableFields = Partial<
  Pick<LoraRecord, 'name' | 'trigger_words' | 'civitai_url' | 'base_model' | 'base_category' | 'nsfw'>
>

export type StyleEditableFields = Partial<
  Pick<StyleRecord, 'name' | 'notes' | 'tags' | 'positive_prompt' | 'negative_prompt' | 'nsfw'>
>

/** civitai_url의 modelVersionId와 latest_version_id가 다르면 새 버전 있음. */
export function hasUpdate(l: LoraRecord): boolean {
  if (!l.latest_version_id || !l.civitai_url) return false
  const m = l.civitai_url.match(/modelVersionId=(\d+)/)
  return !!m && Number(m[1]) !== l.latest_version_id
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${path} failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function fetchLoras(): Promise<{ loras: LoraRecord[]; scan: ScanState }> {
  return (await fetch(`${BASE}/list`)).json()
}

export async function fetchStyles(): Promise<StyleRecord[]> {
  return (await (await fetch(`${BASE}/styles/list`)).json()).styles ?? []
}

export const setFavorite = (relPath: string, favorite: boolean) =>
  post('favorite', { rel_path: relPath, favorite: favorite ? 1 : 0 })

export const updateLora = (relPath: string, fields: LoraEditableFields) =>
  post('update', { rel_path: relPath, ...fields })

export const deleteLora = (relPath: string) => post('delete', { rel_path: relPath })

export async function previewRescan(relPath: string): Promise<LoraEditableFields | null> {
  const data = await post('preview-rescan', { rel_path: relPath })
  return data.ok ? (data.preview as LoraEditableFields) : null
}

export async function startScan(force = false): Promise<void> {
  await fetch(`${BASE}/scan${force ? '?force=1' : ''}`, { method: 'POST' })
}

export async function fetchScanStatus(): Promise<ScanState> {
  return (await fetch(`${BASE}/scan-status`)).json()
}

export const startCheckUpdates = (relPaths?: string[]) =>
  post('check-updates', relPaths ? { rel_paths: relPaths } : {})

export async function fetchUpdateStatus(): Promise<UpdateState> {
  return (await fetch(`${BASE}/check-updates/status`)).json()
}

export async function uploadThumb(relPath: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('rel_path', relPath)
  form.append('file', file)
  await fetch(`${BASE}/upload-thumb`, { method: 'POST', body: form })
}

export async function uploadStyle(file: File): Promise<{ ok: boolean; error?: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/styles/upload`, { method: 'POST', body: form })
  return res.json()
}

export const updateStyle = (id: number, fields: StyleEditableFields) =>
  post('styles/update', { id, ...fields })

export interface CreateStylePayload {
  name: string
  tags?: string
  checkpoint: string
  positive_prompt: string
  negative_prompt: string
  sampler?: string
  scheduler?: string
  seed?: number
  steps?: number
  cfg?: number
  width: number
  height: number
  loras: { lora_rel_path: string; display_name?: string; strength: number; enabled: boolean }[]
  image?: { filename: string; subfolder: string; type: string }
}

export const createStyle = (payload: CreateStylePayload) => post('styles/create', payload)

export const deleteStyle = (id: number) => post('styles/delete', { id })

export const styleImageUrl = (imageFile: string) =>
  `${BASE}/styles/image?file=${encodeURIComponent(imageFile)}`

export const thumbLargeUrl = (relPath: string) =>
  `${BASE}/thumb-large?rel=${encodeURIComponent(relPath)}`
