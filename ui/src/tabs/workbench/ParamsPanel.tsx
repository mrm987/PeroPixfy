import { useEffect, useState } from 'react'
import { enumValues, fetchNodeInfo, installNode, nodeInstallStatus, uploadImage } from '../../api/comfy'
import { useT } from '../../i18n'
import { MaskEditor } from '../../components/MaskEditor'
import { NumberField, SelectField } from '../../components/controls'
import { Section } from '../../components/Section'
import { activeCharOf, useBatch, type ImageFormat } from '../../stores/batch'
import { useUi } from '../../stores/ui'
import { useWorkbench } from '../../stores/workbench'
import { TagAutocompleteTextarea } from '../../tags/TagAutocompleteTextarea'
import { ANIMA_DEFAULTS, HIRES_DEFAULTS, SPECTRUM_DEFAULTS } from '../../workflow/defaults'
import type { GenMode } from '../../workflow/types'
import { LoraStack } from './LoraStack'

const MODES: { id: GenMode; label: string }[] = [
  { id: 't2i', label: 'T2I' },
  { id: 'i2i', label: 'I2I' },
  { id: 'inpaint', label: 'Inpaint' },
]

// 접었을 때 타이틀 옆에 보여줄 프롬프트 한 줄 미리보기.
const promptSummary = (text: string): string | undefined => {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > 48 ? t.slice(0, 48) + '…' : t
}

const RESOLUTION_PRESETS: [number, number][] = [
  [1536, 640],
  [1344, 768],
  [1216, 832],
  [1152, 896],
  [1024, 1024],
  [896, 1152],
  [832, 1216],
  [768, 1344],
  [640, 1536],
]

// 종횡비를 34px 박스 안의 사각형 크기로 환산 (긴 변 = 34px).
const ratioBox = (w: number, h: number, max = 34) => {
  const s = max / Math.max(w, h)
  return { width: Math.round(w * s), height: Math.round(h * s) }
}
const orientation = (w: number, h: number) => (w > h ? 'landscape' : w < h ? 'portrait' : 'square')

const sourcePreviewUrl = (name: string) => {
  const [sub, file] = name.includes('/') ? name.split(/\/(.+)/) : ['', name]
  return `/view?filename=${encodeURIComponent(file)}&subfolder=${encodeURIComponent(sub)}&type=input`
}

interface Meta {
  unets: string[]
  clips: string[]
  vaes: string[]
  loras: string[]
  samplers: string[]
  schedulers: string[]
  upscaleModels: string[]
  spectrumAvailable: boolean
  usduAvailable: boolean
  modWProfiles: string[]
}

export function ParamsPanel({ width, embedded = false }: { width?: number; embedded?: boolean }) {
  // embedded(Multi Base) = 활성 캐릭터 base를 편집(Single과 분리). 아니면 workbench params.
  const t = useT()
  const wbParams = useWorkbench((s) => s.params)
  const wbSet = useWorkbench((s) => s.set)
  const charBase = useBatch((s) => activeCharOf(s)?.base)
  const setCharBase = useBatch((s) => s.setCharBase)
  const batchRandom = useBatch((s) => s.randomizeSeed)
  const setBatchSetting = useBatch((s) => s.setSetting)
  const params = embedded ? (charBase ?? ANIMA_DEFAULTS) : wbParams
  const set = embedded ? setCharBase : wbSet
  const randomizeSeed = useWorkbench((s) => s.randomizeSeed)
  const setRandomize = useWorkbench((s) => s.setRandomize)
  const generate = useWorkbench((s) => s.generate)
  const stop = useWorkbench((s) => s.stop)
  const clearQueue = useWorkbench((s) => s.clearQueue)
  const queue = useWorkbench((s) => s.history.filter((h) => h.status === 'pending').length)
  const progress = useWorkbench((s) => s.progress)
  const error = useWorkbench((s) => s.error)
  const notice = useWorkbench((s) => s.notice)
  const format = useWorkbench((s) => s.format)
  const quality = useWorkbench((s) => s.quality)
  const setSave = useWorkbench((s) => s.setSave)
  const promptH = useUi((s) => s.promptH)
  const negativeH = useUi((s) => s.negativeH)
  const setPref = useUi((s) => s.setPref)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [editMask, setEditMask] = useState(false)
  // USDU 노드 원클릭 설치 상태
  const [usduInstall, setUsduInstall] = useState<'idle' | 'installing' | 'done' | 'error'>('idle')
  const [usduInstallErr, setUsduInstallErr] = useState('')

  const installUsdu = async () => {
    setUsduInstall('installing')
    setUsduInstallErr('')
    try {
      await installNode('usdu')
    } catch {
      setUsduInstall('error'); setUsduInstallErr('request failed'); return
    }
    const poll = setInterval(async () => {
      try {
        const s = await nodeInstallStatus()
        if (s.status === 'done') { clearInterval(poll); setUsduInstall('done') }
        else if (s.status === 'error') { clearInterval(poll); setUsduInstall('error'); setUsduInstallErr(s.error || 'install failed') }
      } catch { /* keep polling */ }
    }, 1500)
  }

  useEffect(() => {
    Promise.all(
      ['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'KSampler', 'UpscaleModelLoader', 'SpectrumKSamplerModGuidance', 'UltimateSDUpscale'].map(fetchNodeInfo),
    ).then(([unet, clip, vae, lora, sampler, upscale, spectrum, usdu]) => {
      const loraList = enumValues(lora, 'lora_name')
      const unetList = enumValues(unet, 'unet_name')
      useWorkbench.getState().setAvailableLoras(loraList) // 생성 시 미설치 LoRA 검증용
      useWorkbench.getState().setAvailableUnets(unetList) // 스타일 적용 시 미설치 모델 검증용
      setMeta({
        unets: unetList,
        clips: enumValues(clip, 'clip_name'),
        vaes: enumValues(vae, 'vae_name'),
        loras: loraList,
        samplers: enumValues(sampler, 'sampler_name'),
        schedulers: enumValues(sampler, 'scheduler'),
        upscaleModels: enumValues(upscale, 'model_name'),
        spectrumAvailable: spectrum !== null,
        usduAvailable: usdu !== null,
        modWProfiles: enumValues(spectrum, 'mod_w_profile'),
      })
    })
  }, [])

  const uploadSource = async (file: File) => {
    const name = await uploadImage(file, `peropix_src_${Date.now()}.png`)
    set({ sourceImage: name, maskImage: undefined }) // 새 소스 → 이전 마스크 제거(다른 이미지의 마스크가 남는 것 방지)
  }

  // i2i/inpaint는 출력 해상도가 소스 이미지 크기로 강제된다(VAEEncode). 소스가 바뀌면
  // 해상도 표시를 실제 이미지 크기로 맞춘다. (Resolution 섹션은 이 모드에서 읽기전용)
  useEffect(() => {
    if (params.mode === 't2i' || !params.sourceImage) return
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth && (img.naturalWidth !== params.width || img.naturalHeight !== params.height)) {
        set({ width: img.naturalWidth, height: img.naturalHeight })
      }
    }
    img.src = sourcePreviewUrl(params.sourceImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.sourceImage, params.mode])
  const hires = params.hires ?? HIRES_DEFAULTS
  const setHires = (patch: Partial<typeof hires>) => set({ hires: { ...hires, ...patch } })
  const hiresMethod = hires.method ?? (meta?.usduAvailable === false ? 'resample' : 'usdu')
  // USDU인데 업스케일 모델이 안 골라졌으면 자동 선택 (생성 시 오류 방지). Anima는 애니
  // 계열이라 anime/ultrasharp 모델을 우선, 없으면 설치된 첫 모델.
  useEffect(() => {
    const models = meta?.upscaleModels ?? []
    if (hires.enabled && !hires.upscaleModel && models.length) {
      setHires({ upscaleModel: models.find((m) => /anime|ultrasharp/i.test(m)) ?? models[0] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hires.enabled, hires.upscaleModel, meta])
  // hires 방식 자동결정: method 미지정 설정만 노드 유무로 채운다(usdu 없으면 resample → 불필요한
  // 설치 안내 방지). 사용자가 명시적으로 USDU를 고른 건 건드리지 않는다(노드 없으면 설치 안내 표시).
  useEffect(() => {
    if (!hires.enabled || !meta || hires.method != null) return
    setHires({ method: meta.usduAvailable ? 'usdu' : 'resample' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hires.enabled, hires.method, meta])
  const spectrum = { ...SPECTRUM_DEFAULTS, ...params.spectrum }
  const setSpectrum = (patch: Partial<typeof spectrum>) => set({ spectrum: { ...spectrum, ...patch } })

  return (
    <div className={`params-panel${embedded ? ' embedded' : ''}`} style={{ width: embedded ? undefined : width }}>
      <div className="params-scroll">
        {/* Multi(embedded)는 t2i 전용 — 모드 전환 미노출. */}
        {!embedded && (
          <div className="preset-row mode-row">
            {MODES.map((m) => (
              <button key={m.id} className={params.mode === m.id ? 'active' : ''}
                onClick={() => set({ mode: m.id })}>
                {t(m.label)}
              </button>
            ))}
          </div>
        )}

        {params.mode !== 't2i' && (
          <Section id="source" title={t('Source image')}>
            <div className="source-box">
              {params.sourceImage ? (
                <div className="source-thumb">
                  <img src={sourcePreviewUrl(params.sourceImage)} alt="source" />
                  {params.mode === 'inpaint' && params.maskImage && (
                    <div className="mask-overlay" style={{
                      maskImage: `url(${sourcePreviewUrl(params.maskImage)})`,
                      WebkitMaskImage: `url(${sourcePreviewUrl(params.maskImage)})`,
                    }} />
                  )}
                  <button className="source-remove" title={t('Remove source image')}
                    onClick={() => set({ sourceImage: undefined, maskImage: undefined })}>✕</button>
                </div>
              ) : (
                <div className="placeholder">
                  {params.mode === 'inpaint'
                    ? t('Draw a mask via "Inpaint" on a result image, or load an image')
                    : t('Use "To I2I" on a result image, or load an image')}
                </div>
              )}
              <input type="file" accept="image/*"
                onChange={(e) => e.target.files?.[0] && uploadSource(e.target.files[0])} />
              {params.mode === 'inpaint' && (
                <div className="mask-row">
                  <span className={`mask-status${params.maskImage ? ' ok' : ''}`}>
                    {params.maskImage ? t('✓ Mask applied (red = repaint area)') : t('No mask yet')}
                  </span>
                  {params.sourceImage && (
                    <button onClick={() => setEditMask(true)}>{params.maskImage ? t('Edit mask') : t('Draw mask')}</button>
                  )}
                </div>
              )}
              <NumberField label={t('denoise')}
                value={params.mode === 'inpaint' ? params.inpaintDenoise : params.i2iDenoise}
                min={0} max={1} step={0.05}
                onChange={(v) => set(params.mode === 'inpaint' ? { inpaintDenoise: v } : { i2iDenoise: v })} />
            </div>
          </Section>
        )}

        <Section id="model" title={t('Model')}>
          <SelectField label={t('Model (UNet)')} value={params.unet} options={meta?.unets ?? []}
            onChange={(v) => set({ unet: v })} />
          <div className="grid-2">
            <SelectField label={t('CLIP')} value={params.clip} options={meta?.clips ?? []}
              onChange={(v) => set({ clip: v })} />
            <SelectField label={t('VAE')} value={params.vae} options={meta?.vaes ?? []}
              onChange={(v) => set({ vae: v })} />
          </div>
        </Section>

        <Section id="loras" title={t('LoRAs')}>
          <LoraStack available={meta?.loras ?? []}
            loras={params.loras}
            setLoras={(loras) => set({ loras })}
            positive={params.positive}
            setPositive={(positive) => set({ positive })} />
        </Section>

        <Section id="positive" title={t('Positive')} summary={promptSummary(params.positive)}>
          <TagAutocompleteTextarea rows={8} value={params.positive} placeholder={t('positive')}
            style={{ height: promptH ?? undefined }}
            onMouseUp={(e) => { const h = e.currentTarget.offsetHeight; if (h && h !== promptH) setPref({ promptH: h }) }}
            onChange={(v) => set({ positive: v })} />
        </Section>
        <Section id="negative" title={t('Negative')} summary={promptSummary(params.negative)}>
          <TagAutocompleteTextarea rows={4} value={params.negative} placeholder={t('negative')}
            style={{ height: negativeH ?? undefined }}
            onMouseUp={(e) => { const h = e.currentTarget.offsetHeight; if (h && h !== negativeH) setPref({ negativeH: h }) }}
            onChange={(v) => set({ negative: v })} />
        </Section>

        <Section id="resolution" title={t('Resolution')} summary={`${params.width} × ${params.height}`}>
          {params.mode !== 't2i' ? (
            <p className="notice">{t('Fixed to source image: {w} × {h} (i2i/inpaint keeps the source resolution)', { w: params.width, h: params.height })}</p>
          ) : (
            <>
              <div className="res-list">
                {RESOLUTION_PRESETS.map(([w, h]) => {
                  const active = params.width === w && params.height === h
                  const box = ratioBox(w, h)
                  return (
                    <button key={`${w}x${h}`} className={`res-item${active ? ' active' : ''}`}
                      onClick={() => set({ width: w, height: h })}>
                      <span className="res-rect-wrap">
                        <span className="res-rect" style={{ width: box.width, height: box.height }} />
                      </span>
                      <span className="res-dim">{w} × {h}</span>
                      <span className="res-orient">{t(orientation(w, h))}</span>
                    </button>
                  )
                })}
              </div>
              <div className="field-label">{t('Custom')}</div>
              <div className="grid-2">
                <NumberField label={t('width')} value={params.width} min={64} max={4096} step={8}
                  onChange={(v) => set({ width: v })} />
                <NumberField label={t('height')} value={params.height} min={64} max={4096} step={8}
                  onChange={(v) => set({ height: v })} />
              </div>
            </>
          )}
        </Section>

        <Section id="sampling" title={t('Sampling')}>
          <div className="grid-2">
            <NumberField label={t('steps')} value={params.steps} min={1} max={200}
              onChange={(v) => set({ steps: v })} />
            <NumberField label={t('cfg')} value={params.cfg} min={0} max={30} step={0.5}
              onChange={(v) => set({ cfg: v })} />
          </div>
          <div className="seed-row">
            <NumberField label={t('seed')} value={params.seed} min={0}
              onChange={(v) => set({ seed: v })} />
            {/* Multi(embedded)는 배치 설정의 randomizeSeed에 바인딩 — 끄면 위 seed로 고정 생성. */}
            {embedded ? (
              <label className="checkbox" title={t('Randomize the seed for each generated image (off = use the seed above)')}>
                <input type="checkbox" checked={batchRandom}
                  onChange={(e) => setBatchSetting({ randomizeSeed: e.target.checked })} /> {t('Random')}
              </label>
            ) : (
              <label className="checkbox">
                <input type="checkbox" checked={randomizeSeed}
                  onChange={(e) => setRandomize(e.target.checked)} /> {t('Random')}
              </label>
            )}
          </div>
        </Section>

        <Section id="advanced" title={t('Advanced')}>
          <div className="grid-2">
            <SelectField label={t('sampler')} value={params.sampler} options={meta?.samplers ?? []}
              onChange={(v) => set({ sampler: v })} />
            <SelectField label={t('scheduler')} value={params.scheduler} options={meta?.schedulers ?? []}
              onChange={(v) => set({ scheduler: v })} />
          </div>
          <NumberField label={t('batch size')} value={params.batchSize} min={1} max={16}
            onChange={(v) => set({ batchSize: v })} />

          <label className="checkbox" title={meta?.spectrumAvailable === false
            ? t('Spectrum nodes are not loaded')
            : t('Speeds up generation while keeping quality.')}>
            <input type="checkbox"
              checked={spectrum.enabled}
              disabled={meta?.spectrumAvailable === false}
              onChange={(e) => setSpectrum({ enabled: e.target.checked })} />
            {' '}{t('Spectrum (+ Mod Guidance)')}{meta?.spectrumAvailable === false ? t(' (node missing)') : ''}
          </label>
          {spectrum.enabled && (
            <>
              <div className="grid-2">
                <SelectField label={t('mod guidance')} value={spectrum.modWProfile}
                  options={meta?.modWProfiles?.length ? meta.modWProfiles : ['off', 'step_i8_skip27', 'step_i14', 'uniform_w3']}
                  onChange={(v) => setSpectrum({ modWProfile: v })} />
                <NumberField label={t('SMC α')} value={spectrum.smcAlpha} min={0} max={1} step={0.05}
                  onChange={(v) => setSpectrum({ smcAlpha: v })} />
              </div>
              <div className="field-label">{t('Quality tags (mod guidance)')}</div>
              <textarea rows={2} value={spectrum.qualityTags}
                onChange={(e) => setSpectrum({ qualityTags: e.target.value })} />
            </>
          )}

          <label className="checkbox"
            title={t('Generate the image, then redraw it larger for more detail. Slower.')}>
            <input type="checkbox" checked={hires.enabled}
              onChange={(e) => setHires({ enabled: e.target.checked })} /> {t('Hires fix')}
          </label>
          {hires.enabled && (
            <div className="sub-opts">
              <div className="preset-row">
                <button type="button" className={hiresMethod === 'usdu' ? 'active' : ''}
                  title={meta?.usduAvailable === false ? t('Needs the Ultimate SD Upscale node — click to install') : t('Tiled re-diffusion — adds real detail (slower)')}
                  onClick={() => setHires({ method: 'usdu' })}>
                  {t('USDU (tiled)')}{meta?.usduAvailable === false ? t(' (node missing)') : ''}
                </button>
                <button type="button" className={hiresMethod === 'resample' ? 'active' : ''}
                  title={t('Upscale then one full resample (faster, less detail)')}
                  onClick={() => setHires({ method: 'resample' })}>
                  {t('2-pass resample')}
                </button>
              </div>
              {hiresMethod === 'usdu' && meta?.usduAvailable === false && (
                <div className="install-hint">
                  <div>{t('USDU needs the "Ultimate SD Upscale" node.')}</div>
                  {usduInstall === 'done' ? (
                    <div className="ok">{t('✓ Installed — restart ComfyUI to enable it.')}</div>
                  ) : (
                    <button type="button" className="generate" disabled={usduInstall === 'installing'}
                      onClick={installUsdu}>
                      {usduInstall === 'installing' ? t('Installing…') : t('Install node (one click)')}
                    </button>
                  )}
                  {usduInstall === 'error' && <div className="error">{t('Install failed:')} {usduInstallErr}</div>}
                </div>
              )}
              <SelectField label={t('upscale model')} value={hires.upscaleModel ?? ''}
                options={meta?.upscaleModels ?? []}
                onChange={(v) => setHires({ upscaleModel: v })} />
              <div className="grid-2">
                <NumberField label={t('hires denoise')} value={hires.denoise} min={0} max={1} step={0.05}
                  onChange={(v) => setHires({ denoise: v })} />
                <NumberField label={t('hires steps')} value={hires.steps ?? params.steps} min={1} max={100} step={1}
                  onChange={(v) => setHires({ steps: v })} />
              </div>
              {hiresMethod === 'usdu' ? (
                <NumberField label={t('target scale (× orig)')} value={hires.scale} min={1} max={4} step={0.25}
                  onChange={(v) => setHires({ scale: v })} />
              ) : (
                <>
                  <label className="checkbox"
                    title={t("Upscale models only enlarge by a fixed factor — turn this on to auto-adjust the result to your exact target size. Off keeps the model's own factor.")}>
                    <input type="checkbox" checked={hires.useTargetScale === true}
                      onChange={(e) => setHires({ useTargetScale: e.target.checked })} /> {t('Use target scale')}
                  </label>
                  {hires.useTargetScale === true && (
                    <NumberField label={t('target scale (× orig)')} value={hires.scale} min={1} max={4} step={0.25}
                      onChange={(v) => setHires({ scale: v })} />
                  )}
                </>
              )}
              <label className="checkbox"
                title={t("Hires can make colors look duller — this restores the original image's vivid colors.")}>
                <input type="checkbox" checked={hires.colorMatch !== false}
                  onChange={(e) => setHires({ colorMatch: e.target.checked })} /> {t('Color match (restore original colors)')}
              </label>
              {hires.colorMatch !== false && (
                <div className="grid-2">
                  <SelectField label={t('color method')} value={hires.colorMatchMethod ?? 'reinhard'}
                    options={['reinhard', 'mkl', 'mvgd', 'hm-mkl-hm', 'hm-mvgd-hm', 'hm']}
                    onChange={(v) => setHires({ colorMatchMethod: v })} />
                  <NumberField label={t('color strength')} value={hires.colorMatchStrength ?? 0.8} min={0} max={1} step={0.05}
                    onChange={(v) => setHires({ colorMatchStrength: v })} />
                </div>
              )}
            </div>
          )}

        </Section>

        {/* 저장 포맷 — Single 전용(Multi는 Slot 패널의 'Save settings'에서 따로 설정). 세션 지속. */}
        {!embedded && (
          <Section id="save" title={t('Save format')} summary={format.toUpperCase()}>
            <div className="grid-2">
              <SelectField label={t('format')} value={format} options={['png', 'jpg', 'webp']}
                onChange={(v) => setSave({ format: v as ImageFormat })} />
              {format !== 'png' && (
                <NumberField label={t('quality')} value={quality} min={1} max={100} step={1}
                  onChange={(v) => setSave({ quality: v })} />
              )}
            </div>
            {format !== 'png' && (
              <p className="notice">{t("jpg/webp don't save the generation info inside the image (png only).")}</p>
            )}
          </Section>
        )}
      </div>

      {!embedded && (
        <div className="params-footer">
          {/* 큐/진행/오류 UI는 Generate 버튼 '위'에 쌓고, 버튼은 항상 맨 아래 고정. */}
          {error && <pre className="error">{error}</pre>}
          {notice && <pre className="notice">{notice}</pre>}
          {(queue > 0 || progress) && (
            <div className="queue-bar">
              <span className="queue-count">
                {t('Queue {n}', { n: queue })}{progress ? ` · ${progress.value}/${progress.max}` : ''}
              </span>
              <button className="queue-btn" onClick={stop}
                title={t('Interrupt the current generation (the queue keeps going)')}>{t('Cancel current')}</button>
              <button className="queue-btn danger" onClick={clearQueue}
                title={t('Clear the entire queue and stop everything')}>{t('Clear queue')}</button>
            </div>
          )}
          <button className="generate" onClick={generate}>{t('Generate')}</button>
        </div>
      )}

      {editMask && params.sourceImage && (
        <MaskEditor imageUrl={sourcePreviewUrl(params.sourceImage)}
          initialMask={params.maskImage ? sourcePreviewUrl(params.maskImage) : undefined}
          onApply={async (blob) => {
            const name = await uploadImage(blob, `peropix_mask_${Date.now()}.png`)
            set({ maskImage: name })
            setEditMask(false)
          }}
          onClose={() => setEditMask(false)} />
      )}
    </div>
  )
}
