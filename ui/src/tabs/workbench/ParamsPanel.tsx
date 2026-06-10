import { useEffect, useState } from 'react'
import { enumValues, fetchNodeInfo, uploadImage } from '../../api/comfy'
import { saveSettings } from '../../api/settings'
import { NumberField, SelectField } from '../../components/controls'
import { useWorkbench } from '../../stores/workbench'
import { HIRES_DEFAULTS } from '../../workflow/defaults'
import type { GenMode } from '../../workflow/types'
import { LoraStack } from './LoraStack'

const MODES: { id: GenMode; label: string }[] = [
  { id: 't2i', label: 'T2I' },
  { id: 'i2i', label: 'I2I' },
  { id: 'inpaint', label: '인페인트' },
]

const sourcePreviewUrl = (name: string) => {
  const [sub, file] = name.includes('/') ? name.split(/\/(.+)/) : ['', name]
  return `/view?filename=${encodeURIComponent(file)}&subfolder=${encodeURIComponent(sub)}&type=input`
}

const RESOLUTION_PRESETS: [number, number][] = [
  [1216, 832],
  [832, 1216],
  [1024, 1024],
  [1152, 896],
]

interface Meta {
  unets: string[]
  clips: string[]
  vaes: string[]
  loras: string[]
  samplers: string[]
  schedulers: string[]
  upscaleModels: string[]
  spectrumAvailable: boolean
}

export function ParamsPanel() {
  const params = useWorkbench((s) => s.params)
  const set = useWorkbench((s) => s.set)
  const randomizeSeed = useWorkbench((s) => s.randomizeSeed)
  const setRandomize = useWorkbench((s) => s.setRandomize)
  const generate = useWorkbench((s) => s.generate)
  const progress = useWorkbench((s) => s.progress)
  const error = useWorkbench((s) => s.error)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    Promise.all(
      ['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'KSampler', 'UpscaleModelLoader', 'DiTSpectrumPatch'].map(fetchNodeInfo),
    ).then(([unet, clip, vae, lora, sampler, upscale, spectrum]) =>
      setMeta({
        unets: enumValues(unet, 'unet_name'),
        clips: enumValues(clip, 'clip_name'),
        vaes: enumValues(vae, 'vae_name'),
        loras: enumValues(lora, 'lora_name'),
        samplers: enumValues(sampler, 'sampler_name'),
        schedulers: enumValues(sampler, 'scheduler'),
        upscaleModels: enumValues(upscale, 'model_name'),
        spectrumAvailable: spectrum !== null,
      }),
    )
  }, [])

  const uploadSource = async (file: File) => {
    const name = await uploadImage(file, `peropix_src_${Date.now()}.png`)
    set({ sourceImage: name })
  }
  const hires = params.hires ?? HIRES_DEFAULTS
  const setHires = (patch: Partial<typeof hires>) => set({ hires: { ...hires, ...patch } })

  return (
    <div className="params-panel">
      <div className="preset-row">
        {MODES.map((m) => (
          <button key={m.id} className={params.mode === m.id ? 'active' : ''}
            onClick={() => set({ mode: m.id, ...(m.id === 't2i' ? { sourceImage: undefined } : {}) })}>
            {m.label}
          </button>
        ))}
      </div>

      {params.mode !== 't2i' && (
        <div className="source-box">
          {params.sourceImage ? (
            <img src={sourcePreviewUrl(params.sourceImage)} alt="source" />
          ) : (
            <div className="placeholder">
              {params.mode === 'inpaint'
                ? '결과 이미지의 "인페인트" 버튼으로 마스크를 그리거나, 이미지를 불러오세요'
                : '결과 이미지의 "i2i로" 버튼을 쓰거나, 이미지를 불러오세요'}
            </div>
          )}
          <input type="file" accept="image/*"
            onChange={(e) => e.target.files?.[0] && uploadSource(e.target.files[0])} />
          <NumberField label="denoise" value={params.denoise} min={0} max={1} step={0.05}
            onChange={(v) => set({ denoise: v })} />
        </div>
      )}

      <SelectField label="모델 (UNet)" value={params.unet} options={meta?.unets ?? []}
        onChange={(v) => set({ unet: v })} />

      <LoraStack available={meta?.loras ?? []} />

      <div className="field-label">프롬프트</div>
      <textarea rows={8} value={params.positive} placeholder="positive"
        onChange={(e) => set({ positive: e.target.value })} />
      <textarea rows={4} value={params.negative} placeholder="negative"
        onChange={(e) => set({ negative: e.target.value })} />

      <div className="field-label">해상도</div>
      <div className="preset-row">
        {RESOLUTION_PRESETS.map(([w, h]) => (
          <button key={`${w}x${h}`}
            className={params.width === w && params.height === h ? 'active' : ''}
            onClick={() => set({ width: w, height: h })}>
            {w}×{h}
          </button>
        ))}
      </div>

      <div className="grid-2">
        <NumberField label="steps" value={params.steps} min={1} max={200}
          onChange={(v) => set({ steps: v })} />
        <NumberField label="cfg" value={params.cfg} min={0} max={30} step={0.5}
          onChange={(v) => set({ cfg: v })} />
      </div>

      <div className="seed-row">
        <NumberField label="seed" value={params.seed} min={0}
          onChange={(v) => set({ seed: v })} />
        <label className="checkbox">
          <input type="checkbox" checked={randomizeSeed}
            onChange={(e) => setRandomize(e.target.checked)} /> 랜덤
        </label>
      </div>

      <button className="toggle-advanced" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? '▾ 고급 설정 접기' : '▸ 고급 설정'}
      </button>
      {showAdvanced && (
        <>
          <div className="grid-2">
            <SelectField label="sampler" value={params.sampler} options={meta?.samplers ?? []}
              onChange={(v) => set({ sampler: v })} />
            <SelectField label="scheduler" value={params.scheduler} options={meta?.schedulers ?? []}
              onChange={(v) => set({ scheduler: v })} />
          </div>
          <div className="grid-2">
            <SelectField label="CLIP" value={params.clip} options={meta?.clips ?? []}
              onChange={(v) => set({ clip: v })} />
            <SelectField label="VAE" value={params.vae} options={meta?.vaes ?? []}
              onChange={(v) => set({ vae: v })} />
          </div>
          <NumberField label="batch" value={params.batchSize} min={1} max={16}
            onChange={(v) => set({ batchSize: v })} />

          <label className="checkbox" title={meta?.spectrumAvailable === false ? 'comfyui-spectrum-ksampler 노드가 로드되지 않았습니다' : 'DiT Spectrum Patch — 약 2-3배 가속'}>
            <input type="checkbox"
              checked={params.spectrum?.enabled ?? false}
              disabled={meta?.spectrumAvailable === false}
              onChange={(e) => set({ spectrum: { enabled: e.target.checked } })} />
            {' '}Spectrum 가속{meta?.spectrumAvailable === false ? ' (노드 없음)' : ''}
          </label>

          <label className="checkbox">
            <input type="checkbox" checked={hires.enabled}
              onChange={(e) => setHires({ enabled: e.target.checked })} /> Hires fix
          </label>
          {hires.enabled && (
            <>
              <div className="grid-2">
                <SelectField label="방식" value={hires.method}
                  options={['latent2pass', 'usdu']}
                  onChange={(v) => setHires({ method: v as 'latent2pass' | 'usdu' })} />
                <NumberField label="배율" value={hires.scale} min={1} max={4} step={0.25}
                  onChange={(v) => setHires({ scale: v })} />
              </div>
              <div className="grid-2">
                <NumberField label="hires denoise" value={hires.denoise} min={0} max={1} step={0.05}
                  onChange={(v) => setHires({ denoise: v })} />
                {hires.method === 'usdu' && (
                  <SelectField label="업스케일 모델" value={hires.upscaleModel ?? ''}
                    options={meta?.upscaleModels ?? []}
                    onChange={(v) => setHires({ upscaleModel: v })} />
                )}
              </div>
            </>
          )}

          <button onClick={async () => {
            const { unet, clip, vae, sampler, scheduler, steps, cfg, width, height } = params
            await saveSettings({ unet, clip, vae, sampler, scheduler, steps, cfg, width, height })
          }}>
            현재 모델·샘플러 설정을 기본값으로 저장
          </button>
        </>
      )}

      <button className="generate" onClick={generate}>
        {progress ? `생성 중 ${progress.value}/${progress.max}` : '생성'}
      </button>
      {error && <pre className="error">{error}</pre>}
    </div>
  )
}
