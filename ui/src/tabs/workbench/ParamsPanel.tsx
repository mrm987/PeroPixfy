import { useEffect, useState } from 'react'
import { enumValues, fetchNodeInfo } from '../../api/comfy'
import { NumberField, SelectField } from '../../components/controls'
import { useWorkbench } from '../../stores/workbench'
import { LoraStack } from './LoraStack'

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
      ['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly', 'KSampler'].map(fetchNodeInfo),
    ).then(([unet, clip, vae, lora, sampler]) =>
      setMeta({
        unets: enumValues(unet, 'unet_name'),
        clips: enumValues(clip, 'clip_name'),
        vaes: enumValues(vae, 'vae_name'),
        loras: enumValues(lora, 'lora_name'),
        samplers: enumValues(sampler, 'sampler_name'),
        schedulers: enumValues(sampler, 'scheduler'),
      }),
    )
  }, [])

  return (
    <div className="params-panel">
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
        </>
      )}

      <button className="generate" onClick={generate}>
        {progress ? `생성 중 ${progress.value}/${progress.max}` : '생성'}
      </button>
      {error && <pre className="error">{error}</pre>}
    </div>
  )
}
