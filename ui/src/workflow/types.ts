export interface LoraEntry {
  relPath: string
  strength: number
  enabled: boolean
}

export interface GenerationParams {
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
  denoise: number
  filenamePrefix: string
}

export type NodeInput = string | number | boolean | [string, number]

export interface ApiNode {
  class_type: string
  inputs: Record<string, NodeInput>
}

export type ApiGraph = Record<string, ApiNode>
