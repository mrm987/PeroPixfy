import type { GenerationParams } from './types'

// 사용자의 실제 Anima 워크플로우(Anima_Base_t2i p3) 기본값.
// M2에서 /object_info, /models 기반 동적 로딩 + settings 저장으로 교체 예정.
export const ANIMA_DEFAULTS: GenerationParams = {
  mode: 't2i',
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
  denoise: 0.5,
  filenamePrefix: 'PeroPix', // 제출 시 defaultFilenamePrefix()로 덮어씀
}

// %date:...% 토큰은 ComfyUI 프론트엔드가 치환하는 기능이라 API 제출에서는
// 동작하지 않음 (Windows에서 ':' 폴더명 오류) — 날짜는 클라이언트에서 계산한다.
export function defaultFilenamePrefix(mode: string): string {
  const d = new Date()
  const ymd = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
  return `PeroPix/${ymd}/${mode}`
}

export const HIRES_DEFAULTS = {
  enabled: false,
  method: 'latent2pass' as const,
  scale: 1.5,
  denoise: 0.5,
}
