// Multi 탭 슬롯 프리셋 API (/peropixfy/api/presets).
const BASE = '/peropixfy/api/presets'

export interface PresetSlot {
  name: string
  prompt: string
  locked: boolean
  promptH?: number // 프롬프트 textarea 높이(px) — 프리셋마다 기억
}
export interface PresetSummary {
  filename: string
  name: string
}
export interface PresetData {
  name: string
  slots: PresetSlot[]
}

export async function listPresets(): Promise<PresetSummary[]> {
  const res = await fetch(BASE)
  return (await res.json()).presets ?? []
}

export async function getPreset(filename: string): Promise<PresetData> {
  return (await fetch(`${BASE}/${encodeURIComponent(filename)}`)).json()
}

export async function createPreset(name: string, slots: PresetSlot[]): Promise<string> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, slots }),
  })
  return (await res.json()).filename
}

export async function updatePreset(filename: string, name: string, slots: PresetSlot[]): Promise<void> {
  await fetch(`${BASE}/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, slots }),
  })
}

export async function deletePreset(filename: string): Promise<void> {
  await fetch(`${BASE}/${encodeURIComponent(filename)}`, { method: 'DELETE' })
}
