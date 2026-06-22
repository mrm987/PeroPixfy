export interface LoraEntry {
  relPath: string
  strength: number
  enabled: boolean
}

export type GenMode = 't2i' | 'i2i' | 'inpaint'

export interface HiresParams {
  enabled: boolean
  // 2-pass: 업스케일 모델로 키운 뒤 목표 배율로 리사이즈 → 전체 재샘플.
  scale: number // 최종 목표 배율 (× 원본). 모델 배율과 별개로 이 크기로 맞춘다.
  useTargetScale?: boolean // off면 목표 배율 리사이즈 생략, 모델 고유 배율로 바로 2패스
  denoise: number
  steps?: number // 업스케일 패스 전용 스텝 (미설정 시 본 steps 사용)
  upscaleModel: string // 사용할 업스케일 모델
  // 하이레스 결과 색을 1패스 원본 색감으로 되돌린다 (VAE 왕복·재샘플로 칙칙해지는 것 보정).
  colorMatch?: boolean
  colorMatchStrength?: number // 색 복원 강도 0~1 (원본↔결과 블렌드)
  colorMatchMethod?: string // color-matcher 메서드 (mkl/mvgd/hm-mkl-hm/...)
}

export interface GenerationParams {
  mode: GenMode
  unet: string
  clip: string
  vae: string
  loras: LoraEntry[]
  positive: string
  negative: string
  seed: number
  steps: number
  cfg: number
  sampler: string
  scheduler: string
  width: number
  height: number
  batchSize: number
  denoise: number // (구) 미사용 — i2i/inpaint는 아래 분리된 값을 쓴다
  i2iDenoise: number // i2i 전용 디노이즈
  inpaintDenoise: number // inpaint 전용 디노이즈
  sourceImage?: string // i2i/inpaint: /upload/image 결과 파일명 (input 폴더)
  maskImage?: string // inpaint: 흑백 마스크 (흰색 = 다시 그릴 영역)
  hires?: HiresParams
  spectrum?: SpectrumParams
  filenamePrefix: string
  // 설정되면 PeroPixSaveImage(포맷 선택)로 저장. 미설정 시 코어 SaveImage(PNG).
  save?: { format: 'png' | 'jpg' | 'webp'; quality: number }
}

export interface SpectrumParams {
  enabled: boolean
  // Anima Mod Guidance + adaptive SMC-CFG — 가속만으로 떨어지는 퀄리티를 보정.
  modWProfile?: string // off | step_i8_skip27 | step_i14 | uniform_w3
  smcAlpha?: number
  qualityTags?: string
}

export type NodeInput = string | number | boolean | [string, number]

export interface ApiNode {
  class_type: string
  inputs: Record<string, NodeInput>
}

export type ApiGraph = Record<string, ApiNode>
