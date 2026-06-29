import { insertTriggers } from '../tags/promptTags'
import { SPECTRUM_DEFAULTS } from './defaults'
import type { ApiGraph, ApiNode, GenerationParams } from './types'

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

  // LoRA를 모델(UNet)과 CLIP(텍스트 인코더)에 모두 적용하는 풀 LoraLoader 체인 — 사용자의
  // 실제 워크플로우('LoRA 로드' 노드)와 동일. 모델만 거는 LoraLoaderModelOnly로는 LoRA의
  // 텍스트 인코더 키(lora_te_*)가 적용 안 돼 "lora key not loaded" 경고 + 결과가 달라진다.
  // 스택의 단일 strength를 model/clip 양쪽에 동일 적용(노드 기본값처럼 대칭).
  let model: [string, number] = ['unet', 0]
  let clip: [string, number] = ['clip', 0]
  for (const [i, lora] of p.loras.filter((l) => l.enabled).entries()) {
    const id = `lora_${i}`
    g[id] = {
      class_type: 'LoraLoader',
      inputs: { model, clip, lora_name: lora.relPath, strength_model: lora.strength, strength_clip: lora.strength },
    }
    model = [id, 0]
    clip = [id, 1]
  }

  // Spectrum(가속) + Mod Guidance + adaptive SMC-CFG는 전용 올인원 샘플러
  // SpectrumKSamplerModGuidance가 한 노드에서 처리한다 (아래 sample()). 별도 모델
  // 패치는 넣지 않으며, 이는 사용자의 실제 워크플로우(그 노드)와 동일한 구성이다.

  // 트리거워드는 프롬프트와 분리 관리 — positive 안의 @triggers 토큰 자리에 치환 삽입.
  const trig = (p.triggers ?? []).filter(Boolean).join(', ')
  const posText = insertTriggers(p.positive, trig)
  g['pos'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: posText } }
  g['neg'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: p.negative } }

  // latent 소스: t2i는 빈 latent, i2i/inpaint는 업로드 이미지 인코딩.
  // inpaint 마스크는 별도의 흑백 이미지(흰색 = 다시 그릴 영역)로 업로드 —
  // 알파 채널 방식은 브라우저 캔버스의 premultiply 때문에 원본 RGB가 손상됨.
  let latent: [string, number]
  if (p.mode === 't2i') {
    g['latent'] = {
      class_type: 'EmptyLatentImage',
      inputs: { width: p.width, height: p.height, batch_size: p.batchSize },
    }
    latent = ['latent', 0]
  } else {
    if (!p.sourceImage) throw new Error(`${p.mode}: no source image — load one or send a result to ${p.mode === 'i2i' ? 'I2I' : 'Inpaint'}`)
    g['src_img'] = { class_type: 'LoadImage', inputs: { image: p.sourceImage } }
    g['src_latent'] = { class_type: 'VAEEncode', inputs: { pixels: ['src_img', 0], vae: ['vae', 0] } }
    latent = ['src_latent', 0]
    if (p.mode === 'inpaint') {
      if (!p.maskImage) throw new Error('inpaint: no mask — draw one via "Inpaint" on a result image')
      g['mask_img'] = { class_type: 'LoadImage', inputs: { image: p.maskImage } }
      g['mask'] = { class_type: 'ImageToMask', inputs: { image: ['mask_img', 0], channel: 'red' } }
      g['masked'] = { class_type: 'SetLatentNoiseMask', inputs: { samples: latent, mask: ['mask', 0] } }
      latent = ['masked', 0]
    }
  }

  // Spectrum이 켜져 있으면 표준 KSampler 대신 올인원 SpectrumKSamplerModGuidance
  // (가속 + Mod Guidance + adaptive SMC-CFG)를 쓴다 — 가속만 할 때의 퀄리티 저하 보정.
  const spec = p.spectrum?.enabled ? p.spectrum : null
  const sample = (id: string, latentIn: [string, number], denoise: number, steps = p.steps) => {
    const base: ApiNode['inputs'] = {
      model,
      positive: ['pos', 0],
      negative: ['neg', 0],
      latent_image: latentIn,
      seed: p.seed,
      steps,
      cfg: p.cfg,
      sampler_name: p.sampler,
      scheduler: p.scheduler,
      denoise,
    }
    g[id] = spec
      ? {
          class_type: 'SpectrumKSamplerModGuidance',
          inputs: {
            ...base,
            clip,
            quality_tags: spec.qualityTags ?? SPECTRUM_DEFAULTS.qualityTags,
            mod_w_profile: spec.modWProfile ?? SPECTRUM_DEFAULTS.modWProfile,
            adaptive_smc_alpha: spec.smcAlpha ?? SPECTRUM_DEFAULTS.smcAlpha,
          },
        }
      : { class_type: 'KSampler', inputs: base }
  }
  const baseDenoise = p.mode === 'i2i' ? p.i2iDenoise : p.mode === 'inpaint' ? p.inpaintDenoise : 1
  sample('sampler', latent, baseDenoise)

  let image: [string, number]
  const round8 = (n: number) => Math.round(n / 8) * 8
  if (p.hires?.enabled) {
    // 업스케일 모델로 키운 뒤(모델 고유 배율) 목표 배율(scale × 원본)로 리사이즈 → 재샘플.
    // 2배 모델로 키우고 1.5배로 줄여 KSampler를 돌리면 GPU 부하를 줄일 수 있다.
    if (!p.hires.upscaleModel) throw new Error('hires: no upscale model selected')
    g['decode_base'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } }
    g['upmodel'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: p.hires.upscaleModel } }
    if (p.hires.method === 'usdu') {
      // Ultimate SD Upscale: 업스케일 모델로 키운 뒤 타일 단위로 재확산(각 타일을 모델 native
      // 해상도에서 다시 그림) → 전체 1패스 재샘플보다 실제 디테일이 더 들어간다. upscale_by=목표 배율.
      g['usdu'] = {
        class_type: 'UltimateSDUpscale',
        inputs: {
          image: ['decode_base', 0], model, positive: ['pos', 0], negative: ['neg', 0], vae: ['vae', 0],
          upscale_by: p.hires.scale,
          seed: p.seed, steps: p.hires.steps ?? p.steps, cfg: p.cfg,
          sampler_name: p.sampler, scheduler: p.scheduler, denoise: p.hires.denoise,
          upscale_model: ['upmodel', 0],
          mode_type: 'Linear', tile_width: 1024, tile_height: 1024,
          mask_blur: 8, tile_padding: 32,
          seam_fix_mode: 'Half Tile', seam_fix_denoise: 1, seam_fix_width: 64, seam_fix_mask_blur: 8, seam_fix_padding: 16,
          force_uniform_tiles: true, tiled_decode: false,
          batch_size: 1, // 최신 USDU 필수 입력 — 한 번에 처리할 타일 묶음 수(1=저VRAM/안전)
        },
      }
      image = ['usdu', 0]
    } else {
      // resample: 모델 업스케일 → (목표 스케일 on이면 lanczos 리사이즈) → 전체 재샘플.
      g['up_img'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['upmodel', 0], image: ['decode_base', 0] } }
      let upscaled: [string, number] = ['up_img', 0]
      if (p.hires.useTargetScale === true) {
        g['up_resized'] = {
          class_type: 'ImageScale',
          inputs: {
            image: ['up_img', 0],
            upscale_method: 'lanczos',
            width: round8(p.width * p.hires.scale),
            height: round8(p.height * p.hires.scale),
            crop: 'disabled',
          },
        }
        upscaled = ['up_resized', 0]
      }
      g['hires_latent'] = { class_type: 'VAEEncode', inputs: { pixels: upscaled, vae: ['vae', 0] } }
      sample('sampler_hires', ['hires_latent', 0], p.hires.denoise, p.hires.steps ?? p.steps)
      g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler_hires', 0], vae: ['vae', 0] } }
      image = ['decode', 0]
    }
    // 하이레스 색감 보정: 1패스 원본(decode_base)의 색 통계로 되돌린다. (reference 해상도가 달라도 OK)
    if (p.hires.colorMatch !== false) {
      g['hires_cm'] = {
        class_type: 'PeroPixColorMatch',
        inputs: {
          image,
          reference: ['decode_base', 0],
          method: p.hires.colorMatchMethod ?? 'reinhard',
          strength: p.hires.colorMatchStrength ?? 0.8,
        },
      }
      image = ['hires_cm', 0]
    }
  } else {
    g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } }
    image = ['decode', 0]
  }

  // 색보정 LUT(.cube) 적용 — 최종 이미지에 (hires/색매치 다음, 저장 직전).
  if (p.lut?.name) {
    g['lut'] = {
      class_type: 'PeroPixApplyLUT',
      inputs: { image, lut_name: p.lut.name, strength: p.lut.strength ?? 1 },
    }
    image = ['lut', 0]
  }

  // save 설정이 있으면(Multi 탭) 포맷 지정 가능한 PeroPixSaveImage로, 없으면(Single)
  // 코어 SaveImage(PNG)로 저장한다. 둘 다 PNG는 워크플로우 메타데이터를 보존한다.
  g['save'] = p.save
    ? {
        class_type: 'PeroPixSaveImage',
        inputs: { images: image, filename_prefix: p.filenamePrefix, format: p.save.format, quality: p.save.quality },
      }
    : { class_type: 'SaveImage', inputs: { images: image, filename_prefix: p.filenamePrefix } }
  return g
}
