import type { GenerationParams, HiresParams } from './types'

// 사용자의 실제 Anima 워크플로우(Anima_Base_t2i p3) 기본값.
// M2에서 /object_info, /models 기반 동적 로딩 + settings 저장으로 교체 예정.
export const ANIMA_DEFAULTS: GenerationParams = {
  mode: 't2i',
  unet: 'anima-base-v1.0.safetensors',
  clip: 'qwen_3_06b_base.safetensors',
  vae: 'qwen_image_vae.safetensors',
  loras: [],
  // Anima v1.0 공식 샘플 이미지의 프롬프트를 기본값으로 — 새 설치/초기화 시 바로 쓸 수 있는 예시.
  positive: 'masterpiece, best quality, score_7, safe, 1girl, standing, white dress, red hair, a blue butterfly is on her finger, (glitch:2)',
  negative: 'worst quality, low quality, score_1, score_2, score_3, artist name',
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
  inpaintDenoise: 0.7, // crop-and-stitch(마스크 영역을 ~1MP로 확대 인페인트)에선 해상도가 충분해 0.7이 안전하게 디테일↑
  inpaintMaskExpand: 12,
  inpaintMaskFeather: 12,
  filenamePrefix: 'PeroPixfy', // 제출 시 defaultFilenamePrefix()로 덮어씀
}

// 워크스페이스 폴더 '최상위'에 저장한다 — 날짜별 하위폴더 없이. mode(t2i/i2i/inpaint)는
// 폴더가 아니라 파일명 prefix로 남는다(t2i_00001_.png). base는 옵션 모달의 Single 출력
// 폴더(상대/절대). 비면 기본 'PeroPixfy/Single'. 안정적 prefix → SaveImage가 폴더 내
// 최대 번호 +1로 순차 저장(정렬 가능).
export function defaultFilenamePrefix(mode: string, base = 'PeroPixfy/Single'): string {
  const root = (base || '').trim() || 'PeroPixfy/Single'
  return `${root}/${mode}`
}

export const HIRES_DEFAULTS: HiresParams = {
  // method 미지정 — USDU 노드가 있으면 usdu(타일 재확산, 디테일↑), 없으면 resample로 자동 결정한다
  // (불필요한 노드 설치 안내 방지). Anima는 기본 선명도가 높아 1패스 resample은 디테일 체감이 약함.
  enabled: false,
  scale: 1.5,
  denoise: 0.4,
  steps: 20, // 업스케일 패스 스텝 (본 steps와 별개로 조절 가능)
  upscaleModel: '',
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
