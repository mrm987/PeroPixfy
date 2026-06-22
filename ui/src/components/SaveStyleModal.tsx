import { useState } from 'react'
import { parseViewUrl } from '../api/comfy'
import { createStyle } from '../api/library'
import { useT } from '../i18n'
import { useUi } from '../stores/ui'
import type { HistoryItem } from '../stores/workbench'
import { Field } from './controls'

/** Save a generated result (image + its exact params) as a reusable style. */
export function SaveStyleModal({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (busy || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const p = item.params
      const res = await createStyle({
        name: name.trim(),
        tags: tags.trim() || undefined,
        checkpoint: p.unet,
        positive_prompt: p.positive,
        negative_prompt: p.negative,
        sampler: p.sampler,
        scheduler: p.scheduler,
        seed: p.seed,
        steps: p.steps,
        cfg: p.cfg,
        width: p.width,
        height: p.height,
        loras: p.loras.map((l) => ({ lora_rel_path: l.relPath, strength: l.strength, enabled: l.enabled })),
        image: item.imageUrls[0] ? parseViewUrl(item.imageUrls[0]) : undefined,
      })
      if (!res.ok) throw new Error(String(res.error ?? 'Save failed'))
      // 저장 성공 → 라이브러리 도크를 열고(이미 열려 있으면 styles 새로고침해) 방금 만든 스타일을 보여준다
      useUi.getState().openLib()
      useUi.getState().bumpStyleRev()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('Save as style')}</h3>
        {item.imageUrls[0] && <img className="save-style-preview" src={item.imageUrls[0]} alt="" />}
        <Field label={t('Name')}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()} placeholder={t('Style name')} />
        </Field>
        <Field label={t('Tags (comma separated)')}>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('e.g. cel, soft-light')} />
        </Field>
        <div className="lib-meta">
          {t('Saves model, prompts, LoRA stack ({n} active) and resolution from this result.', { n: item.params.loras.filter((l) => l.enabled).length })}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="generate" onClick={save} disabled={busy || !name.trim()}>
            {busy ? t('Saving…') : t('Save')}
          </button>
        </div>
      </div>
    </div>
  )
}
