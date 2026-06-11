import { useEffect, useState } from 'react'
import { enumValues, fetchNodeInfo, uploadImage } from '../../api/comfy'
import { saveSettings } from '../../api/settings'
import { NumberField, SelectField } from '../../components/controls'
import { StyleDrawer } from '../../components/StyleDrawer'
import { useWorkbench } from '../../stores/workbench'
import { HIRES_DEFAULTS } from '../../workflow/defaults'
import type { GenMode } from '../../workflow/types'
import { LoraStack } from './LoraStack'

const MODES: { id: GenMode; label: string }[] = [
  { id: 't2i', label: 'T2I' },
  { id: 'i2i', label: 'I2I' },
  { id: 'inpaint', label: 'Inpaint' },
]

const RESOLUTION_PRESETS: [number, number][] = [
  [1216, 832],
  [832, 1216],
  [1024, 1024],
  [1152, 896],
]

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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [savedNote, setSavedNote] = useState(false)

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
      <div className="preset-row mode-row">
        {MODES.map((m) => (
          <button key={m.id} className={params.mode === m.id ? 'active' : ''}
            onClick={() => set({ mode: m.id, ...(m.id === 't2i' ? { sourceImage: undefined, maskImage: undefined } : {}) })}>
            {m.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="styles-open" onClick={() => setDrawerOpen(true)}
          title="Browse styles and apply to current settings">▤ Styles</button>
      </div>

      {params.mode !== 't2i' && (
        <div className="source-box">
          {params.sourceImage ? (
            <img src={sourcePreviewUrl(params.sourceImage)} alt="source" />
          ) : (
            <div className="placeholder">
              {params.mode === 'inpaint'
                ? 'Draw a mask via "Inpaint" on a result image, or load an image'
                : 'Use "To I2I" on a result image, or load an image'}
            </div>
          )}
          <input type="file" accept="image/*"
            onChange={(e) => e.target.files?.[0] && uploadSource(e.target.files[0])} />
          {params.mode === 'inpaint' && (
            <div className={`mask-status${params.maskImage ? ' ok' : ''}`}>
              {params.maskImage ? '✓ Mask applied' : 'No mask — draw one via "Inpaint" on a result image'}
            </div>
          )}
          <NumberField label="denoise" value={params.denoise} min={0} max={1} step={0.05}
            onChange={(v) => set({ denoise: v })} />
        </div>
      )}

      <SelectField label="Model (UNet)" value={params.unet} options={meta?.unets ?? []}
        onChange={(v) => set({ unet: v })} />

      <LoraStack available={meta?.loras ?? []} />

      <div className="field-label">Prompt</div>
      <textarea rows={8} value={params.positive} placeholder="positive"
        onChange={(e) => set({ positive: e.target.value })} />
      <textarea rows={4} value={params.negative} placeholder="negative"
        onChange={(e) => set({ negative: e.target.value })} />

      <div className="field-label">Resolution</div>
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
            onChange={(e) => setRandomize(e.target.checked)} /> Random
        </label>
      </div>

      <button className="toggle-advanced" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? '▾ Hide advanced' : '▸ Advanced'}
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
          <NumberField label="batch size" value={params.batchSize} min={1} max={16}
            onChange={(v) => set({ batchSize: v })} />

          <label className="checkbox" title={meta?.spectrumAvailable === false
            ? 'comfyui-spectrum-ksampler nodes are not loaded'
            : 'DiT Spectrum Patch — roughly 1.5-3x faster sampling'}>
            <input type="checkbox"
              checked={params.spectrum?.enabled ?? false}
              disabled={meta?.spectrumAvailable === false}
              onChange={(e) => set({ spectrum: { enabled: e.target.checked } })} />
            {' '}Spectrum acceleration{meta?.spectrumAvailable === false ? ' (node missing)' : ''}
          </label>

          <label className="checkbox">
            <input type="checkbox" checked={hires.enabled}
              onChange={(e) => setHires({ enabled: e.target.checked })} /> Hires fix
          </label>
          {hires.enabled && (
            <>
              <div className="grid-2">
                <SelectField label="method" value={hires.method}
                  options={['latent2pass', 'usdu']}
                  onChange={(v) => setHires({ method: v as 'latent2pass' | 'usdu' })} />
                <NumberField label="scale" value={hires.scale} min={1} max={4} step={0.25}
                  onChange={(v) => setHires({ scale: v })} />
              </div>
              <div className="grid-2">
                <NumberField label="hires denoise" value={hires.denoise} min={0} max={1} step={0.05}
                  onChange={(v) => setHires({ denoise: v })} />
                {hires.method === 'usdu' && (
                  <SelectField label="upscale model" value={hires.upscaleModel ?? ''}
                    options={meta?.upscaleModels ?? []}
                    onChange={(v) => setHires({ upscaleModel: v })} />
                )}
              </div>
            </>
          )}

          <button onClick={async () => {
            const { unet, clip, vae, sampler, scheduler, steps, cfg, width, height } = params
            await saveSettings({ unet, clip, vae, sampler, scheduler, steps, cfg, width, height })
            setSavedNote(true)
            setTimeout(() => setSavedNote(false), 1500)
          }}>
            {savedNote ? '✓ Saved' : 'Save model & sampler settings as defaults'}
          </button>
        </>
      )}

      <button className="generate" onClick={generate}>
        {progress ? `Generating ${progress.value}/${progress.max}` : 'Generate'}
      </button>
      {error && <pre className="error">{error}</pre>}

      <StyleDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}
