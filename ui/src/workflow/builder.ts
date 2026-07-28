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

  // latent 소스 + (인페인트) 조건화.
  //  - t2i: 빈 latent
  //  - i2i: 업로드 이미지 인코딩
  //  - inpaint: '칠한 곳만' 재생성(noise_mask:true) + DifferentialDiffusion으로 톤 유지 + 경계 블렌딩.
  //    추가로 crop-and-stitch — 마스크 bbox+패딩을 크롭해 ~1MP로 확대한 뒤 그 위에서 인페인트하고
  //    원래 크기로 줄여 원본에 다시 얹는다. 작은 마스크가 전체 latent에서 차지하는 해상도 지분이 작아
  //    디테일이 떨어지는 문제(전체 생성 대비)를 해결 — 마스크 영역을 모델이 훈련된 스케일에서 그린다.
  //    (A1111 'only masked'·ADetailer와 동일 원리.) bbox가 없거나 마스크가 프레임의 큰 부분이면 전체 프레임.
  // inpaint 마스크는 별도 흑백 이미지(흰색 = 다시 그릴 영역) — 알파 채널은 브라우저 premultiply로 손상됨.
  let posCond: [string, number] = ['pos', 0]
  let negCond: [string, number] = ['neg', 0]
  let latent: [string, number]
  // 인페인트 crop-and-stitch 상태: crop이면 원본 픽셀 좌표, 아니면 null(전체 프레임 폴백).
  // inpaintMask = 최종 합성용 마스크 노드(crop이면 크롭된 마스크, 아니면 전체 소프트 마스크).
  let inpaintCrop: { x0: number; y0: number; cw: number; ch: number } | null = null
  let inpaintMask: [string, number] | null = null
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
      // 이 소프트 마스크가 diff-diff의 픽셀별 denoise 강도이자 최종 합성 마스크가 된다.
      let maskOut: [string, number] = ['mask_grow', 0]
      if (feather > 0) {
        g['mask_fimg'] = { class_type: 'MaskToImage', inputs: { mask: ['mask_grow', 0] } }
        g['mask_blur'] = { class_type: 'ImageBlur', inputs: { image: ['mask_fimg', 0], blur_radius: Math.min(feather, 31), sigma: feather / 3 } }
        g['mask'] = { class_type: 'ImageToMask', inputs: { image: ['mask_blur', 0], channel: 'red' } }
        maskOut = ['mask', 0]
      }
      // DifferentialDiffusion: 모델을 패치해 noise_mask(그라디언트)를 픽셀별 denoise 임계값으로 해석 →
      // 페더 가장자리가 약하게만 denoise돼 경계가 매끄럽게 이어진다.
      g['model_dd'] = { class_type: 'DifferentialDiffusion', inputs: { model } }

      // crop-and-stitch 결정: 마스크 bbox+패딩을 크롭해 ~1MP로 확대(디테일 예산 확보). 확대 여지가
      // 적거나(작은 이득) 마스크가 프레임의 큰 부분이면 전체 프레임 인페인트로 폴백.
      let condPixels: [string, number] = ['src_img', 0]
      let condMask: [string, number] = maskOut
      const bb = p.maskBbox
      if (bb) {
        const pad = expand + feather + Math.max(32, Math.round(0.25 * Math.max(bb.w, bb.h)))
        const x0 = Math.max(0, bb.x - pad)
        const y0 = Math.max(0, bb.y - pad)
        const cw = Math.min(bb.w + 2 * pad, bb.iw - x0)
        const ch = Math.min(bb.h + 2 * pad, bb.ih - y0)
        const scale = Math.min(3.0, Math.sqrt(1048576 / (cw * ch)))
        if (scale >= 1.15 && cw * ch <= 0.75 * bb.iw * bb.ih) {
          // 업스케일 목표 치수는 16의 배수로 스냅(VAE 8x × Cosmos DiT patch 2) — InpaintModelConditioning
          // 내부 center-crop을 피해 스티치 좌표가 어긋나지 않게 한다.
          const W = Math.max(16, Math.round((cw * scale) / 16) * 16)
          const H = Math.max(16, Math.round((ch * scale) / 16) * 16)
          g['crop_img'] = { class_type: 'ImageCrop', inputs: { image: ['src_img', 0], width: cw, height: ch, x: x0, y: y0 } }
          g['crop_mask'] = { class_type: 'CropMask', inputs: { mask: maskOut, x: x0, y: y0, width: cw, height: ch } }
          g['crop_up'] = { class_type: 'ImageScale', inputs: { image: ['crop_img', 0], upscale_method: 'lanczos', width: W, height: H, crop: 'disabled' } }
          condPixels = ['crop_up', 0]
          condMask = ['crop_mask', 0]
          inpaintCrop = { x0, y0, cw, ch }
        }
      }
      inpaintMask = condMask
      // noise_mask:true → (크롭된) 소프트 마스크를 latent noise_mask로 설정(diff-diff가 그라디언트로 사용).
      g['inpaint_cond'] = {
        class_type: 'InpaintModelConditioning',
        inputs: {
          positive: ['pos', 0], negative: ['neg', 0], vae: ['vae', 0],
          pixels: condPixels, mask: condMask, noise_mask: true,
        },
      }
      posCond = ['inpaint_cond', 0]
      negCond = ['inpaint_cond', 1]
      latent = ['inpaint_cond', 2]
    } else {
      g['src_latent'] = { class_type: 'VAEEncode', inputs: { pixels: ['src_img', 0], vae: ['vae', 0] } }
      latent = ['src_latent', 0]
    }
  }

  // Spectrum이 켜져 있으면 표준 KSampler 대신 올인원 SpectrumKSamplerModGuidance
  // (가속 + Mod Guidance + adaptive SMC-CFG)를 쓴다 — 가속만 할 때의 퀄리티 저하 보정.
  const spec = p.spectrum?.enabled ? p.spectrum : null
  // pos/neg는 기본 posCond/negCond(인페인트면 조건화 노드 출력). hires 리샘플은 업스케일된
  // latent라 인페인트 concat 크기와 안 맞으므로 호출부에서 일반 ['pos'/'neg']를 명시로 넘긴다.
  const sample = (id: string, latentIn: [string, number], denoise: number, steps = p.steps, pos = posCond, neg = negCond, mdl: [string, number] = model) => {
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
  // 인페인트 base 샘플은 diff-diff로 패치한 모델을 쓴다(그라디언트 마스크 경계 블렌딩). 그 외/hires는 원본 모델.
  const baseModel: [string, number] = p.mode === 'inpaint' ? ['model_dd', 0] : model
  sample('sampler', latent, baseDenoise, p.steps, posCond, negCond, baseModel)

  let image: [string, number]
  const round8 = (n: number) => Math.round(n / 8) * 8
  if (p.mode === 'inpaint' && inpaintCrop) {
    // crop-and-stitch: 확대 크롭에서 인페인트한 결과를 원래 크롭 크기로 되돌린 뒤, 소프트 마스크로
    // 원본의 해당 영역에만 얹는다(마스크 밖 원본은 픽셀 그대로 보존). 이 경로는 hires를 사용하지 않는다.
    g['decode'] = { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } }
    g['crop_down'] = { class_type: 'ImageScale', inputs: { image: ['decode', 0], upscale_method: 'lanczos', width: inpaintCrop.cw, height: inpaintCrop.ch, crop: 'disabled' } }
    g['inpaint_composite'] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['src_img', 0], source: ['crop_down', 0], x: inpaintCrop.x0, y: inpaintCrop.y0, resize_source: false, mask: inpaintMask! },
    }
    image = ['inpaint_composite', 0]
  } else if (p.hires?.enabled) {
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

  // 인페인트 전체 프레임 폴백 합성: crop 경로는 위에서 이미 스티치했으므로 제외. 마스크 밖 원본을
  // 되살려 선명히 유지하고 소프트 마스크 경계만 부드럽게 잇는다. (업스케일 시엔 결과 크기가 원본과
  // 달라 합성이 불가하고 전체 재샘플이라 이득도 적어 생략 — 기존 동작 유지.)
  if (p.mode === 'inpaint' && !inpaintCrop && !p.hires?.enabled) {
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
