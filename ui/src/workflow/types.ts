export interface LoraEntry {
  relPath: string
  strength: number
  enabled: boolean
}

export type GenMode = 't2i' | 'i2i' | 'inpaint'

// inpaint 마스크의 흰 영역 bounding box. x,y,w,h는 소스 이미지 픽셀 좌표, iw/ih는 소스 이미지 크기.
export interface MaskBbox {
  x: number
  y: number
  w: number
  h: number
  iw: number
  ih: number
}

export interface HiresParams {
  enabled: boolean
  // upscale = 순수 업스케일(무샘플링) / resample = 업스케일 후 전체 재샘플 / usdu = 타일 단위 재확산.
  method?: 'upscale' | 'resample' | 'usdu'
  scale: number // 목표 배율 (× 원본). 세 방식 모두 이 배율로 맞춘다.
  denoise: number
  steps?: number // 재샘플 패스 전용 스텝 (미설정 시 본 steps 사용)
  upscaleModel: string // 사용할 업스케일 모델
}

export interface GenerationParams {
  mode: GenMode
  unet: string
  clip: string
  vae: string
  loras: LoraEntry[]
  positive: string
  negative: string
  triggers?: string[] // 활성·on 트리거워드(순서대로). 빌더가 positive의 @triggers 토큰 자리에 삽입.
  // 기록 전용: positive를 실제 트리거워드로 치환해 저장할 때(참고/스타일용), 무손실 복원을 위해
  // @triggers 토큰이 든 원본 positive를 함께 보관. 불러올(restore) 때 칩 버전으로 되돌리는 데 사용.
  positiveTemplate?: string
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
  inpaintMaskExpand: number // inpaint: 마스크 확장(px) — 합성 경계를 바깥으로 밀어 여유 확보
  inpaintMaskFeather: number // inpaint: 마스크 가장자리 페더(px) — 경계 전환 부드럽게
  sourceImage?: string // i2i/inpaint: /upload/image 결과 파일명 (input 폴더)
  maskImage?: string // inpaint: 흑백 마스크 (흰색 = 다시 그릴 영역)
  // inpaint: 마스크의 흰 영역 bounding box(소스 이미지 픽셀 좌표) + 소스 이미지 크기. 마스크를
  // 그릴 때 계산해 저장 → crop-and-stitch(마스크 영역만 ~1MP로 확대 인페인트)에 사용. 없으면 전체 프레임.
  maskBbox?: MaskBbox
  hires?: HiresParams
  spectrum?: SpectrumParams
  lut?: { name: string; strength: number } // models/luts의 .cube 색보정 LUT (name 비면 미적용)
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
