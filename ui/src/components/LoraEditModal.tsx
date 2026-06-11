import { useState } from 'react'
import type { LoraEditableFields, LoraRecord } from '../api/library'
import { Field } from './controls'

export function LoraEditModal({
  lora, onSave, onClose,
}: {
  lora: LoraRecord
  onSave: (fields: LoraEditableFields) => Promise<void>
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

  const save = async () => {
    setBusy(true)
    await onSave(form)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{lora.file_name}</h3>
        <Field label="이름">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="트리거 워드 (쉼표 구분)">
          <textarea rows={2} value={form.trigger_words}
            onChange={(e) => setForm({ ...form, trigger_words: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="베이스 카테고리">
            <input value={form.base_category}
              onChange={(e) => setForm({ ...form, base_category: e.target.value })} />
          </Field>
          <Field label="베이스 모델">
            <input value={form.base_model}
              onChange={(e) => setForm({ ...form, base_model: e.target.value })} />
          </Field>
        </div>
        <Field label="CivitAI URL">
          <input value={form.civitai_url}
            onChange={(e) => setForm({ ...form, civitai_url: e.target.value })} />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={!!form.nsfw}
            onChange={(e) => setForm({ ...form, nsfw: e.target.checked ? 1 : 0 })} /> NSFW
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>취소</button>
          <button className="generate" onClick={save} disabled={busy}>저장</button>
        </div>
      </div>
    </div>
  )
}
