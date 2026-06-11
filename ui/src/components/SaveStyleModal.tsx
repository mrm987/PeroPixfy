import { useState } from 'react'
import { parseViewUrl } from '../api/comfy'
import { createStyle } from '../api/library'
import { useLibrary } from '../stores/library'
import type { HistoryItem } from '../stores/workbench'
import { Field } from './controls'

/** Save a generated result (image + its exact params) as a reusable style. */
export function SaveStyleModal({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    const p = item.params
    await createStyle({
      name: name.trim(),
      tags: tags.trim() || undefined,
      checkpoint: p.unet,
      positive_prompt: p.positive,
      negative_prompt: p.negative,
      width: p.width,
      height: p.height,
      loras: p.loras.map((l) => ({ lora_rel_path: l.relPath, strength: l.strength, enabled: l.enabled })),
      image: item.imageUrls[0] ? parseViewUrl(item.imageUrls[0]) : undefined,
    })
    await useLibrary.getState().load()
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Save as style</h3>
        {item.imageUrls[0] && <img className="save-style-preview" src={item.imageUrls[0]} alt="" />}
        <Field label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="Style name" />
        </Field>
        <Field label="Tags (comma separated)">
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. cel, soft-light" />
        </Field>
        <div className="lib-meta">
          Saves model, prompts, LoRA stack ({item.params.loras.filter((l) => l.enabled).length} active)
          and resolution from this result.
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="generate" onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
