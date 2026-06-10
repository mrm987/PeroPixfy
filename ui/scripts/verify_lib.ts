// 동일성 검증 공통 헬퍼: /prompt 제출 → /history 폴링 → 픽셀 비교

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { ApiGraph } from '../src/workflow/types'

export const COMFY = 'http://127.0.0.1:8188'
const PORTABLE = 'W:\\ComfyUI_windows_portable_nvidia_cu121_or_cpu\\ComfyUI_windows_portable'
const OUTPUT_DIR = path.join(PORTABLE, 'ComfyUI', 'output')
const PYTHON = path.join(PORTABLE, 'python_embeded', 'python.exe')
const COMPARE = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'compare.py')

export interface OutputImage {
  filename: string
  subfolder: string
  type: string
}

export async function submit(graph: ApiGraph, clientIdValue: string): Promise<string> {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientIdValue }),
  })
  if (!res.ok) throw new Error(`/prompt ${res.status}: ${await res.text()}`)
  return (await res.json()).prompt_id
}

export async function waitOutputs(promptId: string): Promise<OutputImage[]> {
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const data = await (await fetch(`${COMFY}/history/${promptId}`)).json()
    const entry = data[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      throw new Error('execution error: ' + JSON.stringify(entry.status, null, 2))
    }
    const images = Object.values(entry.outputs ?? {}).flatMap(
      (o) => ((o as { images?: OutputImage[] }).images ?? []),
    )
    if (images.length) return images
  }
  throw new Error('timeout waiting for ' + promptId)
}

/** 픽셀 비교 결과 문자열 반환 ("IDENTICAL" 또는 "DIFFERENT: ..."). */
export function comparePixels(a: OutputImage, b: OutputImage): string {
  const pa = path.join(OUTPUT_DIR, a.subfolder, a.filename)
  const pb = path.join(OUTPUT_DIR, b.subfolder, b.filename)
  try {
    return execFileSync(PYTHON, [COMPARE, pa, pb], { encoding: 'utf8' }).trim()
  } catch (e) {
    const err = e as { stdout?: string }
    return err.stdout?.trim() ?? String(e)
  }
}
