// M6 검증:
//  1) i2i 동일성 — 손번역 레퍼런스(LoadImage→VAEEncode→KSampler denoise<1) vs buildGraph(mode:'i2i') 픽셀 비교
//  2) inpaint 그래프 실행 성공 (SetLatentNoiseMask 배선 확인)
//  3) hires latent2pass 그래프 실행 성공 (2-pass 배선 확인)
//
// 실행: ComfyUI 린 프로파일이 8188에 떠 있는 상태에서 `npm run verify:m6`

import fs from 'node:fs'
import path from 'node:path'
import { buildGraph } from '../src/workflow/builder'
import { ANIMA_DEFAULTS } from '../src/workflow/defaults'
import type { ApiGraph } from '../src/workflow/types'
import { COMFY, comparePixels, submit, waitOutputs } from './verify_lib'

const SEED = 555444333
const OUTPUT_DIR = 'W:\\ComfyUI_windows_portable_nvidia_cu121_or_cpu\\ComfyUI_windows_portable\\ComfyUI\\output'

// 소스 이미지: M1 검증 산출물을 input 폴더로 업로드
const verifyDir = path.join(OUTPUT_DIR, 'PeroPix', 'verify')
const srcFile = fs.readdirSync(verifyDir).find((f) => f.startsWith('m1_ref'))
if (!srcFile) throw new Error('M1 검증 산출물이 없습니다 — verify:m1을 먼저 실행하세요')

const buf = fs.readFileSync(path.join(verifyDir, srcFile))
const form = new FormData()
form.append('image', new Blob([buf], { type: 'image/png' }), 'peropix_verify_src.png')
form.append('overwrite', 'true')
const upRes = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form })
if (!upRes.ok) throw new Error(`/upload/image ${upRes.status}`)
const upData = await upRes.json()
const sourceImage = upData.subfolder ? `${upData.subfolder}/${upData.name}` : upData.name
console.log('소스 업로드:', sourceImage)

function referenceI2i(prefix: string): ApiGraph {
  return {
    '44': { class_type: 'UNETLoader', inputs: { unet_name: ANIMA_DEFAULTS.unet, weight_dtype: 'default' } },
    '45': { class_type: 'CLIPLoader', inputs: { clip_name: ANIMA_DEFAULTS.clip, type: 'stable_diffusion' } },
    '15': { class_type: 'VAELoader', inputs: { vae_name: ANIMA_DEFAULTS.vae } },
    '11': { class_type: 'CLIPTextEncode', inputs: { clip: ['45', 0], text: '1girl, smile' } },
    '12': { class_type: 'CLIPTextEncode', inputs: { clip: ['45', 0], text: 'worst quality' } },
    '30': { class_type: 'LoadImage', inputs: { image: sourceImage } },
    '31': { class_type: 'VAEEncode', inputs: { pixels: ['30', 0], vae: ['15', 0] } },
    '19': {
      class_type: 'KSampler',
      inputs: {
        model: ['44', 0], positive: ['11', 0], negative: ['12', 0], latent_image: ['31', 0],
        seed: SEED, steps: 30, cfg: 5, sampler_name: 'er_sde', scheduler: 'simple', denoise: 0.5,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['19', 0], vae: ['15', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  }
}

const base = {
  ...ANIMA_DEFAULTS,
  positive: '1girl, smile',
  negative: 'worst quality',
  seed: SEED,
  sourceImage,
}

console.log('[1/4] i2i reference 제출...')
const refImgs = await waitOutputs(await submit(referenceI2i('PeroPix/verify/m6_ref'), 'verify-m6'))
console.log('[2/4] i2i builder 그래프 제출...')
const appImgs = await waitOutputs(await submit(
  buildGraph({ ...base, mode: 'i2i', denoise: 0.5, filenamePrefix: 'PeroPix/verify/m6_app' }),
  'verify-m6',
))
const result = comparePixels(refImgs[0], appImgs[0])
console.log('i2i RESULT:', result)

console.log('[3/4] inpaint 그래프 실행 확인...')
await waitOutputs(await submit(
  buildGraph({ ...base, mode: 'inpaint', denoise: 0.5, steps: 12, filenamePrefix: 'PeroPix/verify/m6_inpaint' }),
  'verify-m6',
))
console.log('      inpaint OK')

console.log('[4/4] hires 그래프 실행 확인...')
await waitOutputs(await submit(
  buildGraph({
    ...base, mode: 't2i', steps: 12,
    hires: { enabled: true, scale: 1.5, denoise: 0.5, upscaleModel: base.hires?.upscaleModel ?? '' },
    filenamePrefix: 'PeroPix/verify/m6_hires',
  }),
  'verify-m6',
))
console.log('      hires OK')

process.exit(result === 'IDENTICAL' ? 0 : 1)
