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

  // Spectrum 가속: 로라 체인 뒤에 MODEL 패처 삽입 (README 권장 배선).
  // steps는 다운스트림 샘플러와 반드시 일치해야 함 — hires 2-pass도 같은 steps 사용.
  if (p.spectrum?.enabled) {
    g['spectrum'] = {
      class_type: 'DiTSpectrumPatch',
      inputs: {
        model,
        steps: p.steps,
        window_size: 2.0,
        flex_window: 0.25,
        warmup_steps: 6,
        tail_actual_steps: 3,
        blend_w: 0.3,
        cheby_degree: 3,
        ridge_lambda: 0.1,
        history_size: 100,
        enabled: true,
        one_sampler_only: false,
        verbose: false,
      },
    }
    model = ['spectrum', 0]
  }

  g['pos'] = { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: p.positive } }
  g['neg'] = { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: p.negative } }

  // latent 소스: t2i는 빈 latent, i2i/inpaint는 업로드 이미지 인코딩.
  // inpaint 마스크는 업로드 PNG의 알파 채널 (LoadImage MASK 출력 = 1 - alpha).
  let latent: [string, number]
  if (p.mode === 't2i') {
    g['latent'] = {
      class_type: 'EmptyLatentImage',
      inputs: { width: p.width, height: p.height, batch_size: p.batchSize },
    }
    latent = ['latent', 0]
  } else {
    if (!p.sourceImage) throw new Error(`${p.mode}: sourceImage가 없습니다`)
    g['src_img'] = { class_type: 'LoadImage', inputs: { image: p.sourceImage } }
    g['src_latent'] = { class_type: 'VAEEncode', inputs: { pixels: ['src_img', 0], vae: ['vae', 0] } }
    latent = ['src_latent', 0]
    if (p.mode === 'inpaint') {
      g['masked'] = { class_type: 'SetLatentNoiseMask', inputs: { samples: latent, mask: ['src_img', 1] } }
      latent = ['masked', 0]
    }
  }

  const sample = (id: string, latentIn: [string, number], denoise: number) => {
    g[id] = {
      class_type: 'KSampler',
      inputs: {
        model,
        positive: ['pos', 0],
        negative: ['neg', 0],
        latent_image: latentIn,
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: p.sampler,
        scheduler: p.scheduler,
        denoise,
      },
    }
  }
  sample('sampler', latent, p.mode === 't2i' ? 1 : p.denoise)

  let image: [string, number]
  const round8 = (n: number) => Math.round(n / 8) * 8
  if (p.hires?.enabled && p.hires.method === 'latent2pass') {
    g['hires_up'] = {
      class_type: 'LatentUpscale',
      inputs: {
        samples: ['sampler', 0],
        upscale_method: 'nearest-exact',
        width: round8(p.width * p.hires.scale),
        height: round8(p.height * p.hires.scale),
        crop: 'disabled',
      },
    }
    sample('sampler_hires', ['hires_up', 0], p.hires.denoise)
    g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler_hires', 0], vae: ['vae', 0] } }
    image = ['decode', 0]
  } else if (p.hires?.enabled && p.hires.method === 'usdu') {
    if (!p.hires.upscaleModel) throw new Error('USDU: 업스케일 모델이 선택되지 않았습니다')
    g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } }
    g['upmodel'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: p.hires.upscaleModel } }
    g['usdu'] = {
      class_type: 'UltimateSDUpscale',
      inputs: {
        image: ['decode', 0],
        model,
        positive: ['pos', 0],
        negative: ['neg', 0],
        vae: ['vae', 0],
        upscale_model: ['upmodel', 0],
        upscale_by: p.hires.scale,
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        sampler_name: p.sampler,
        scheduler: p.scheduler,
        denoise: p.hires.denoise,
        mode_type: 'Linear',
        tile_width: 512,
        tile_height: 512,
        mask_blur: 8,
        tile_padding: 32,
        seam_fix_mode: 'None',
        seam_fix_denoise: 1,
        seam_fix_width: 64,
        seam_fix_mask_blur: 8,
        seam_fix_padding: 16,
        force_uniform_tiles: true,
        tiled_decode: false,
      },
    }
    image = ['usdu', 0]
  } else {
    g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } }
    image = ['decode', 0]
  }

  g['save'] = { class_type: 'SaveImage', inputs: { images: image, filename_prefix: p.filenamePrefix } }
  return g
}
