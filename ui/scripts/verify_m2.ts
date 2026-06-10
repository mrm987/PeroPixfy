// M2 동일성 검증: 사용자 워크플로우의 실제 로라 체인(활성 4개, 바이패스 2개)을
// 그대로 번역한 레퍼런스 vs buildGraph() — 같은 시드로 픽셀 비교.
// 바이패스 로라가 "노드 생략 + 링크 직결"로 올바르게 표현되는지가 핵심.
//
// 실행: ComfyUI 린 프로파일이 8188에 떠 있는 상태에서 `npm run verify:m2`

import { buildGraph } from '../src/workflow/builder'
import { ANIMA_DEFAULTS } from '../src/workflow/defaults'
import type { ApiGraph, LoraEntry } from '../src/workflow/types'
import { NEGATIVE, POSITIVE } from './fixtures'
import { comparePixels, submit, waitOutputs } from './verify_lib'

const SEED = 987654321

// 사용자 워크플로우의 체인 순서: 46(bypass) → 66 → 70 → 71 → 75(bypass) → 72
const USER_LORAS: LoraEntry[] = [
  { relPath: 'TSロリおじさんの冒険AnimaPreview3Base_LoKr_V1_ComfyUI.safetensors', strength: 0.1, enabled: false },
  { relPath: 'saiougaushi_p3_ep25.safetensors', strength: 0.5, enabled: true },
  { relPath: 'newPSG_AnimaPreview3_v1.safetensors', strength: 0.1, enabled: true },
  { relPath: 'hizake_mozu_style_AnimaPreview3.safetensors', strength: 0.8, enabled: true },
  { relPath: 'ethan_AnimaPreview3_v01.safetensors', strength: 0.5, enabled: false },
  { relPath: 'hasu_anima_p3_epoch25.safetensors', strength: 0.8, enabled: true },
]

/** 활성 로라만 수동 체인으로 연결한 레퍼런스 (UI의 bypass 제거 동작과 동일). */
function referenceGraph(prefix: string): ApiGraph {
  return {
    '44': { class_type: 'UNETLoader', inputs: { unet_name: ANIMA_DEFAULTS.unet, weight_dtype: 'default' } },
    '45': { class_type: 'CLIPLoader', inputs: { clip_name: ANIMA_DEFAULTS.clip, type: 'stable_diffusion' } },
    '15': { class_type: 'VAELoader', inputs: { vae_name: ANIMA_DEFAULTS.vae } },
    '66': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['44', 0], lora_name: 'saiougaushi_p3_ep25.safetensors', strength_model: 0.5 } },
    '70': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['66', 0], lora_name: 'newPSG_AnimaPreview3_v1.safetensors', strength_model: 0.1 } },
    '71': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['70', 0], lora_name: 'hizake_mozu_style_AnimaPreview3.safetensors', strength_model: 0.8 } },
    '72': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['71', 0], lora_name: 'hasu_anima_p3_epoch25.safetensors', strength_model: 0.8 } },
    '11': { class_type: 'CLIPTextEncode', inputs: { clip: ['45', 0], text: POSITIVE } },
    '12': { class_type: 'CLIPTextEncode', inputs: { clip: ['45', 0], text: NEGATIVE } },
    '73': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    '19': {
      class_type: 'KSampler',
      inputs: {
        model: ['72', 0], positive: ['11', 0], negative: ['12', 0], latent_image: ['73', 0],
        seed: SEED, steps: 30, cfg: 5, sampler_name: 'er_sde', scheduler: 'simple', denoise: 1,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['19', 0], vae: ['15', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: prefix } },
  }
}

const reference = referenceGraph('PeroPix/verify/m2_ref')
const app = buildGraph({
  ...ANIMA_DEFAULTS,
  loras: USER_LORAS,
  positive: POSITIVE,
  negative: NEGATIVE,
  seed: SEED,
  filenamePrefix: 'PeroPix/verify/m2_app',
})

console.log('[1/3] reference 제출 (로라 4개 체인)...')
const refImgs = await waitOutputs(await submit(reference, 'verify-m2'))
console.log('      done:', refImgs[0].filename)

console.log('[2/3] builder 그래프 제출 (로라 6개 중 2개 disabled)...')
const appImgs = await waitOutputs(await submit(app, 'verify-m2'))
console.log('      done:', appImgs[0].filename)

console.log('[3/3] 픽셀 비교...')
const result = comparePixels(refImgs[0], appImgs[0])
console.log('RESULT:', result)
process.exit(result === 'IDENTICAL' ? 0 : 1)
