export interface LoraEntry {
  relPath: string
  strength: number
  enabled: boolean
}

export type GenMode = 't2i' | 'i2i' | 'inpaint'

export interface HiresParams {
  enabled: boolean
  method: 'latent2pass' | 'usdu'
  scale: number
  denoise: number
  upscaleModel?: string // usdu 전용
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
  denoise: number // i2i/inpaint에서만 사용 (t2i는 1 고정)
  sourceImage?: string // i2i/inpaint: /upload/image 결과 파일명 (input 폴더)
  maskImage?: string // inpaint: 흑백 마스크 (흰색 = 다시 그릴 영역)
  hires?: HiresParams
  spectrum?: { enabled: boolean }
  filenamePrefix: string
}

export type NodeInput = string | number | boolean | [string, number]

export interface ApiNode {
  class_type: string
  inputs: Record<string, NodeInput>
}

export type ApiGraph = Record<string, ApiNode>
