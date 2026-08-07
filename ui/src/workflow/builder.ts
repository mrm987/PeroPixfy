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
/**
 * 제출 직전 업스케일 모델 보정.
 *
 * ★ hires.upscaleModel의 기본값은 빈 문자열이고, 값을 채워 주는 것은 ParamsPanel의
 * 자동 선택뿐이다. 그런데 그 자동 선택은 **지금 편집 중인 대상**(Single의 params,
 * Multi의 활성 캐릭터 base)에만 적용된다. 그래서 Multi에서 활성이 아닌 캐릭터로
 * 생성하거나, 목록이 로드되기 전에 큐에 넣은 요청은 빈 값 그대로 빌더에 도달해
 * "no upscale model" 로 실패했다.
 *
 * 설치된 모델 중 무엇을 쓸지는 창작 결정이 아니라 환경에 맞추는 일이므로, 설치되지 않은
 * LoRA를 제출 직전에 빼는 것과 같은 자리에서 함께 정리한다. 저장된 이름이 더 이상 설치돼
 * 있지 않은 경우(모델을 지웠거나 이름이 바뀐 경우)도 여기서 걸러진다.
 * Anima는 애니 계열이라 anime/ultrasharp 이름을 우선한다(ParamsPanel의 자동 선택과 동일).
 */
export function resolveUpscaleModel(p: GenerationParams, available: string[]): GenerationParams {
  if (!p.hires?.enabled || !available.length) return p
  if (p.hires.upscaleModel && available.includes(p.hires.upscaleModel)) return p
  const pick = available.find((m) => /anime|ultrasharp/i.test(m)) ?? available[0]
  return { ...p, hires: { ...p.hires, upscaleModel: pick } }
}

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

  // latent 소스.
  //  - t2i: 빈 latent
  //  - i2i: 업로드 이미지 인코딩
  //  - inpaint: 원본 전체를 인코딩하고 마스크만 noise_mask로 열어 준다(전체 프레임).
  //
  // ★한때 여기에 crop-and-stitch(마스크 주변을 잘라 확대) + DifferentialDiffusion +
  // InpaintModelConditioning이 있었다. 같은 시드로 하나씩 빼고 비교한 결과 **어느 것도 결과를
  // 개선하지 않았다.** 크롭은 오히려 해로웠다 — 모델에게서 '그림 전체'를 빼앗아, 손처럼 몸에
  // 붙어 있어야 하는 것이 어긋났다(칠한 손 안에 인물이 통째로 그려지는 사고도 여기서 났다).
  // 결과를 실제로 가른 것은 cfg와 LoRA 구성이었다 → 아래 터보 분기와 sample()의 cfg 참조.
  // 마스크는 별도 흑백 이미지(흰색 = 다시 그릴 영역) — 알파 채널은 브라우저 premultiply로 손상됨.
  let latent: [string, number]
  let inpaintMask: [string, number] | null = null // 최종 합성용 소프트 마스크
  if (p.mode === 't2i') {
    g['latent'] = {
      class_type: 'EmptyLatentImage',
      inputs: { width: p.width, height: p.height, batch_size: p.batchSize },
    }
    latent = ['latent', 0]
  } else {
    if (!p.sourceImage) throw new Error(`${p.mode}: no source image — load one or send a result to ${p.mode === 'i2i' ? 'I2I' : 'Inpaint'}`)
    g['src_img'] = { class_type: 'LoadImage', inputs: { image: p.sourceImage } }
    if (p.mode === 'inpaint') {
      if (!p.maskImage) throw new Error('inpaint: no mask — draw one via "Inpaint" on a result image')
      g['mask_img'] = { class_type: 'LoadImage', inputs: { image: p.maskImage } }
      g['mask_raw'] = { class_type: 'ImageToMask', inputs: { image: ['mask_img', 0], channel: 'red' } }
      const expand = p.inpaintMaskExpand ?? 12
      const feather = p.inpaintMaskFeather ?? 12
      g['mask_grow'] = { class_type: 'GrowMask', inputs: { mask: ['mask_raw', 0], expand, tapered_corners: true } }
      // 진짜 blob 페더: 코어 FeatherMask는 '이미지 캔버스 테두리'만 페이드해 중앙 blob엔 무효다. blob
      // 가장자리를 실제로 그라디언트화하려면 마스크를 이미지로 바꿔 ImageBlur한 뒤 다시 마스크로 돌린다.
      // 이 소프트 마스크가 latent noise_mask이자 최종 합성의 경계가 된다.
      let maskOut: [string, number] = ['mask_grow', 0]
      if (feather > 0) {
        g['mask_fimg'] = { class_type: 'MaskToImage', inputs: { mask: ['mask_grow', 0] } }
        g['mask_blur'] = { class_type: 'ImageBlur', inputs: { image: ['mask_fimg', 0], blur_radius: Math.min(feather, 31), sigma: feather / 3 } }
        g['mask'] = { class_type: 'ImageToMask', inputs: { image: ['mask_blur', 0], channel: 'red' } }
        maskOut = ['mask', 0]
      }
      inpaintMask = maskOut
      // 원본 전체를 인코딩하고 마스크만 열어 준다 — 마스크 밖 latent는 매 스텝 원본으로 고정되어
      // 모델이 그림 전체를 보면서 마스크 안만 다시 그린다.
      g['src_latent'] = { class_type: 'VAEEncode', inputs: { pixels: ['src_img', 0], vae: ['vae', 0] } }
      g['masked'] = { class_type: 'SetLatentNoiseMask', inputs: { samples: ['src_latent', 0], mask: maskOut } }
      latent = ['masked', 0]
    } else {
      g['src_latent'] = { class_type: 'VAEEncode', inputs: { pixels: ['src_img', 0], vae: ['vae', 0] } }
      latent = ['src_latent', 0]
    }
  }

  // Spectrum이 켜져 있으면 표준 KSampler 대신 올인원 SpectrumKSamplerModGuidance
  // (가속 + Mod Guidance + adaptive SMC-CFG)를 쓴다 — 가속만 할 때의 퀄리티 저하 보정.
  const spec = p.spectrum?.enabled ? p.spectrum : null
  const sample = (id: string, latentIn: [string, number], denoise: number, steps = p.steps,
                  pos: [string, number] = ['pos', 0], neg: [string, number] = ['neg', 0],
                  mdl: [string, number] = model) => {
    const base: ApiNode['inputs'] = {
      model: mdl,
      positive: pos,
      negative: neg,
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
    if (!p.hires.upscaleModel) {
      throw new Error('hires: no upscale model installed — put one in ComfyUI/models/upscale_models')
    }
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
      // upscale/resample 공통: 업스케일 모델로 키운 뒤 목표 배율(scale × 원본)로 리사이즈.
      g['up_img'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['upmodel', 0], image: ['decode_base', 0] } }
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
      if (p.hires.method === 'upscale') {
        image = ['up_resized', 0] // 순수 업스케일 — 재샘플 없이 여기서 끝.
      } else {
        // resample: 리사이즈한 이미지를 다시 인코딩 → 전체 재샘플.
        g['hires_latent'] = { class_type: 'VAEEncode', inputs: { pixels: ['up_resized', 0], vae: ['vae', 0] } }
        sample('sampler_hires', ['hires_latent', 0], p.hires.denoise, p.hires.steps ?? p.steps, ['pos', 0], ['neg', 0])
        g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler_hires', 0], vae: ['vae', 0] } }
        image = ['decode', 0]
      }
    }
  } else {
    g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } }
    image = ['decode', 0]
  }

  // 인페인트 합성: 마스크 밖은 원본 픽셀을 그대로 되살린다. 결과가 눈에 띄게 달라지진 않지만
  // (빼고 비교해도 차이 없음) 반복 인페인트에서 손대지 않은 영역이 VAE 왕복으로 조금씩 뭉개지는
  // 것을 막아 준다. (업스케일 시엔 결과 크기가 원본과 달라 합성이 불가 — 기존 동작 유지.)
  if (p.mode === 'inpaint' && !p.hires?.enabled) {
    g['inpaint_composite'] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['src_img', 0], source: image, x: 0, y: 0, resize_source: false, mask: inpaintMask! },
    }
    image = ['inpaint_composite', 0]
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
