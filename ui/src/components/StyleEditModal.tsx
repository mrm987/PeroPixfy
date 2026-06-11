import { useState } from 'react'
import { deleteStyle, updateStyle, type StyleEditableFields, type StyleRecord } from '../api/library'
import { Field } from './controls'

export function StyleEditModal({
  style, onSaved, onClose,
}: {
  style: StyleRecord
  onSaved: () => void
  onClose: () => void
}) {
  const [form, setForm] = useState<Required<StyleEditableFields>>({
    name: style.name || '',
    tags: style.tags || '',
    positive_prompt: style.positive_prompt || '',
    negative_prompt: style.negative_prompt || '',
    notes: style.notes || '',
    nsfw: style.nsfw,
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    await updateStyle(style.id, form)
    onSaved()
    onClose()
  }

  const remove = async () => {
    if (!confirm(`Delete style "${style.name || style.id}"?`)) return
    setBusy(true)
    await deleteStyle(style.id)
    onSaved()
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit style</h3>
        <Field label="Name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Tags (comma separated)">
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </Field>
        <Field label="Positive prompt">
          <textarea rows={4} value={form.positive_prompt}
            onChange={(e) => setForm({ ...form, positive_prompt: e.target.value })} />
        </Field>
        <Field label="Negative prompt">
          <textarea rows={2} value={form.negative_prompt}
            onChange={(e) => setForm({ ...form, negative_prompt: e.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea rows={2} value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={!!form.nsfw}
            onChange={(e) => setForm({ ...form, nsfw: e.target.checked ? 1 : 0 })} /> NSFW
        </label>
        <div className="modal-actions">
          <button className="danger" onClick={remove} disabled={busy}>Delete</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button className="generate" onClick={save} disabled={busy}>Save</button>
        </div>
      </div>
    </div>
  )
}
