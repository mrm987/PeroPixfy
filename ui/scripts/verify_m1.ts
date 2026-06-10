// M1 동일성 검증: 사용자 워크플로우를 손으로 번역한 레퍼런스 그래프 vs
// buildGraph() 산출 그래프 (둘 다 로라 없음) — 같은 시드로 생성해 픽셀 비교.
// 노드 ID가 달라 ComfyUI 캐시를 공유하지 않으므로 두 번의 독립 실행이 보장됨
// (그래프 동등성 + 샘플링 결정성을 동시에 검증).
//
// 실행: ComfyUI 린 프로파일이 8188에 떠 있는 상태에서 `npm run verify:m1`

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { buildGraph } from '../src/workflow/builder'
import { ANIMA_DEFAULTS } from '../src/workflow/defaults'
import type { ApiGraph } from '../src/workflow/types'
import { NEGATIVE, POSITIVE } from './fixtures'

const COMFY = 'http://127.0.0.1:8188'
const PORTABLE = 'W:\\ComfyUI_windows_portable_nvidia_cu121_or_cpu\\ComfyUI_windows_portable'
const OUTPUT_DIR = path.join(PORTABLE, 'ComfyUI', 'output')
const PYTHON = path.join(PORTABLE, 'python_embeded', 'python.exe')
const COMPARE = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'compare.py')

const SEED = 123456789

/** 사용자의 Anima_Base_t2i (p3) 워크플로우의 활성 경로를 그대로 번역 (로라 제외). */
function referenceGraph(prefix: string): ApiGraph {
  return {
    '44': { class_type: 'UNETLoader', inputs: { unet_name: ANIMA_DEFAULTS.unet, weight_dtype: 'default' } },
    '45': { class_type: 'CLIPLoader', inputs: { clip_name: ANIMA_DEFAULTS.clip, type: 'stable_diffusion' } },
    '15': { class_type: 'VAELoader', inputs: { vae_name: ANIMA_DEFAULTS.vae } },
    '11': { class_type: 'CLIPTextEncode', inputs: { clip: ['45', 0], text: POSITIVE } },
    '12': { class_type: 'CLIPTextEncode', inputs: { clip: ['45', 0], text: NEGATIVE } },
    '73': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    '19': {
      class_type: 'KSampler',
      inputs: {
        model: ['44', 0], positive: ['11', 0], negative: ['12', 0], latent_image: ['73', 0],
        seed: SEED, steps: 30, cfg: 5, sampler_name: 'er_sde', scheduler: 'simple', denoise: 1,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['19', 0], vae: ['15', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  }
}

interface OutputImage { filename: string; subfolder: string; type: string }

async function submit(graph: ApiGraph): Promise<string> {
  const res = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'verify-m1' }),
  })
  if (!res.ok) throw new Error(`/prompt ${res.status}: ${await res.text()}`)
  return (await res.json()).prompt_id
}

async function waitOutputs(promptId: string): Promise<OutputImage[]> {
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

const reference = referenceGraph('PeroPix/verify/m1_ref')
const app = buildGraph({
  ...ANIMA_DEFAULTS,
  positive: POSITIVE,
  negative: NEGATIVE,
  seed: SEED,
  filenamePrefix: 'PeroPix/verify/m1_app',
})

console.log('[1/3] reference 제출 (모델 첫 로딩이라 수 분 걸릴 수 있음)...')
const refImgs = await waitOutputs(await submit(reference))
console.log('      done:', refImgs[0].subfolder + '/' + refImgs[0].filename)

console.log('[2/3] builder 그래프 제출...')
const appImgs = await waitOutputs(await submit(app))
console.log('      done:', appImgs[0].subfolder + '/' + appImgs[0].filename)

console.log('[3/3] 픽셀 비교...')
const refPath = path.join(OUTPUT_DIR, refImgs[0].subfolder, refImgs[0].filename)
const appPath = path.join(OUTPUT_DIR, appImgs[0].subfolder, appImgs[0].filename)
try {
  const out = execFileSync(PYTHON, [COMPARE, refPath, appPath], { encoding: 'utf8' })
  console.log('RESULT:', out.trim())
} catch (e) {
  const err = e as { stdout?: string }
  console.log('RESULT:', err.stdout?.trim() ?? String(e))
  process.exit(1)
}
