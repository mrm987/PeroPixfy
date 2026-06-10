import type { GenerationParams } from './types'

// 사용자의 실제 Anima 워크플로우(Anima_Base_t2i p3) 기본값.
// M2에서 /object_info, /models 기반 동적 로딩 + settings 저장으로 교체 예정.
export const ANIMA_DEFAULTS: GenerationParams = {
  unet: 'animaOfficial_preview3Base.safetensors',
  clip: 'qwen_3_06b_base.safetensors',
  vae: 'qwen_image_vae.safetensors',
  loras: [],
  positive: '',
  negative: '',
  seed: 0,
  steps: 30,
  cfg: 5,
  sampler: 'er_sde',
  scheduler: 'simple',
  width: 832,
  height: 1216,
  batchSize: 1,
  denoise: 1,
  filenamePrefix: 'PeroPix/%date:yyyy-MM-dd%/t2i',
}
