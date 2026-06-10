import type { ApiGraph, GenerationParams } from './types'

/**
 * Builds an API-format prompt graph for the Anima t2i pipeline.
 *
 * Disabled LoRAs are omitted entirely and the MODEL link is rewired past
 * them — the API format has no bypass concept. Node IDs are deterministic
 * ("unet", "lora_0", "sampler", ...) so graphs are easy to diff.
 */
export function buildGraph(p: GenerationParams): ApiGraph {
  const g: ApiGraph = {}
  g['unet'] = { class_type: 'UNETLoader', inputs: { unet_name: p.unet, weight_dtype: 'default' } }
  g['clip'] = { class_type: 'CLIPLoader', inputs: { clip_name: p.clip, type: 'stable_diffusion' } }
  g['vae'] = { class_type: 'VAELoader', inputs: { vae_name: p.vae } }

  let model: [string, number] = ['unet', 0]
  for (const [i, lora] of p.loras.filter((l) => l.enabled).entries()) {
    const id = `lora_${i}`
    g[id] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model, lora_name: lora.relPath, strength_model: lora.strength },
    }
    model = [id, 0]
  }

  g['pos'] = { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: p.positive } }
  g['neg'] = { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: p.negative } }
  g['latent'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: p.width, height: p.height, batch_size: p.batchSize },
  }
  g['sampler'] = {
    class_type: 'KSampler',
    inputs: {
      model,
      positive: ['pos', 0],
      negative: ['neg', 0],
      latent_image: ['latent', 0],
      seed: p.seed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: p.sampler,
      scheduler: p.scheduler,
      denoise: p.denoise,
    },
  }
  g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } }
  g['save'] = { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: p.filenamePrefix } }
  return g
}
