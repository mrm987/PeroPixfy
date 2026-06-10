const BASE = '/peropix/api/library'

export interface LoraRecord {
  rel_path: string
  file_name: string
  name: string
  trigger_words: string
  thumb_url: string
  thumb_type: string
  base_model: string
  base_category: string
  civitai_url: string
  nsfw: number
  favorite: number
  scanned: number
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
  tags: string
  notes: string
  nsfw: number
  loras?: StyleLoraRef[]
}

export async function fetchLoras(): Promise<{ loras: LoraRecord[]; scanning: boolean }> {
  const res = await fetch(`${BASE}/list`)
  return res.json()
}

export async function fetchStyles(): Promise<StyleRecord[]> {
  const res = await fetch(`${BASE}/styles/list`)
  return (await res.json()).styles ?? []
}

export async function setFavorite(relPath: string, favorite: boolean): Promise<void> {
  await fetch(`${BASE}/favorite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rel_path: relPath, favorite: favorite ? 1 : 0 }),
  })
}

export async function startScan(): Promise<void> {
  await fetch(`${BASE}/scan`, { method: 'POST' })
}

export function styleImageUrl(imageFile: string): string {
  return `${BASE}/styles/image?file=${encodeURIComponent(imageFile)}`
}
