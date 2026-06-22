import type { GenerationParams, HiresParams } from './types'

// 사용자의 실제 Anima 워크플로우(Anima_Base_t2i p3) 기본값.
// M2에서 /object_info, /models 기반 동적 로딩 + settings 저장으로 교체 예정.
export const ANIMA_DEFAULTS: GenerationParams = {
  mode: 't2i',
  unet: 'anima-base-v1.0.safetensors',
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
  i2iDenoise: 0.6,
  inpaintDenoise: 0.6,
  filenamePrefix: 'PeroPixfy', // 제출 시 defaultFilenamePrefix()로 덮어씀
}

// %date:...% 토큰은 ComfyUI 프론트엔드가 치환하는 기능이라 API 제출에서는
// 동작하지 않음 (Windows에서 ':' 폴더명 오류) — 날짜는 클라이언트에서 계산한다.
export function defaultFilenamePrefix(mode: string, base = 'PeroPixfy/Single'): string {
  const d = new Date()
  const ymd = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
  // 안정적인 prefix → SaveImage가 폴더 내 최대 번호 +1로 순차 저장(정렬 가능).
  // base는 옵션 모달의 Single 출력 폴더(상대/절대). 비면 기본 'PeroPixfy'.
  const root = (base || '').trim() || 'PeroPixfy/Single'
  return `${root}/${ymd}/${mode}`
}

export const HIRES_DEFAULTS: HiresParams = {
  // 모델 업스케일 → (목표 스케일 on이면 리사이즈) → 재샘플. 모델은 첫 사용 시 자동 선택.
  enabled: false,
  scale: 1.5,
  useTargetScale: false, // 기본 off — 모델 고유 배율로 바로 2패스
  denoise: 0.4,
  steps: 20, // 업스케일 패스 스텝 (본 steps와 별개로 조절 가능)
  upscaleModel: '',
  colorMatch: true, // 기본 on — 하이레스 색 칙칙함 보정 (color-matcher 기반)
  colorMatchStrength: 0.8,
  colorMatchMethod: 'reinhard',
}

// 스펙트럼 기본값 — 사용자의 실제 워크플로우(KSampler Spectrum + Mod Guidance) 그대로.
// 가속만으로는 퀄리티가 떨어지므로 Mod Guidance(step_i14, SAFE)와 adaptive SMC-CFG(0.2)를 함께 쓴다.
export const SPECTRUM_DEFAULTS = {
  enabled: false,
  modWProfile: 'step_i14',
  smcAlpha: 0.2,
  qualityTags:
    'absurdres, highres, masterpiece, best quality, score_9, score_8, newest, year 2025, year 2024',
}
