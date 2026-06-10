import type { GenerationParams } from '../workflow/types'

export type SavedDefaults = Partial<
  Pick<GenerationParams, 'unet' | 'clip' | 'vae' | 'sampler' | 'scheduler' | 'steps' | 'cfg' | 'width' | 'height'>
>

export async function fetchSettings(): Promise<SavedDefaults> {
  const res = await fetch('/peropix/api/settings')
  return res.json()
}

export async function saveSettings(s: SavedDefaults): Promise<void> {
  await fetch('/peropix/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  })
}
