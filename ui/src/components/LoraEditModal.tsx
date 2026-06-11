import { useState } from 'react'
import {
  deleteLora, previewRescan, uploadThumb,
  type LoraEditableFields, type LoraRecord,
} from '../api/library'
import { Field } from './controls'

export function LoraEditModal({
  lora, onSave, onDeleted, onClose,
}: {
  lora: LoraRecord
  onSave: (fields: LoraEditableFields) => Promise<void>
  onDeleted: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<Required<LoraEditableFields>>({
    name: lora.name || '',
    trigger_words: lora.trigger_words || '',
    base_category: lora.base_category || '',
    base_model: lora.base_model || '',
    civitai_url: lora.civitai_url || '',
    nsfw: lora.nsfw,
  })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    await onSave(form)
    onClose()
  }

  // CivitAI + safetensors 재조회 — DB에 쓰지 않고 폼만 채움, 저장 시 반영
  const rescanPreview = async () => {
    setBusy(true)
    setNote('Fetching from CivitAI…')
    const preview = await previewRescan(lora.rel_path)
    setBusy(false)
    if (!preview) {
      setNote('Re-fetch failed (CivitAI unreachable or file missing)')
      return
    }
    setForm((f) => ({ ...f, ...preview }))
    setNote('Form filled with fetched data — press Save to apply')
  }

  const uploadThumbnail = async (file: File) => {
    setBusy(true)
    await uploadThumb(lora.rel_path, file)
    setBusy(false)
    setNote('Thumbnail uploaded')
  }

  const remove = async () => {
    if (!confirm(`Delete this LoRA file from disk (cannot be undone):\n${lora.rel_path}`)) return
    setBusy(true)
    await deleteLora(lora.rel_path)
    onDeleted()
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{lora.file_name}</h3>
        <Field label="Name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Trigger words (comma separated)">
          <textarea rows={2} value={form.trigger_words}
            onChange={(e) => setForm({ ...form, trigger_words: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Base category">
            <input value={form.base_category}
              onChange={(e) => setForm({ ...form, base_category: e.target.value })} />
          </Field>
          <Field label="Base model">
            <input value={form.base_model}
              onChange={(e) => setForm({ ...form, base_model: e.target.value })} />
          </Field>
        </div>
        <Field label="CivitAI URL">
          <input value={form.civitai_url}
            onChange={(e) => setForm({ ...form, civitai_url: e.target.value })} />
        </Field>
        <div className="grid-2" style={{ alignItems: 'flex-end' }}>
          <Field label="Upload thumbnail">
            <input type="file" accept="image/*"
              onChange={(e) => e.target.files?.[0] && uploadThumbnail(e.target.files[0])} />
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={!!form.nsfw}
              onChange={(e) => setForm({ ...form, nsfw: e.target.checked ? 1 : 0 })} /> NSFW
          </label>
        </div>
        {note && <div className="modal-note">{note}</div>}
        <div className="modal-actions">
          <button className="danger" onClick={remove} disabled={busy}>Delete file</button>
          <button onClick={rescanPreview} disabled={busy}>Re-fetch from CivitAI</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button className="generate" onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
    </div>
  )
}
