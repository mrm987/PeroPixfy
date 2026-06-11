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
    setNote('CivitAI 조회 중…')
    const preview = await previewRescan(lora.rel_path)
    setBusy(false)
    if (!preview) {
      setNote('재조회 실패 (CivitAI 미응답 또는 파일 없음)')
      return
    }
    setForm((f) => ({ ...f, ...preview }))
    setNote('재조회 결과를 폼에 채웠습니다 — 저장을 눌러야 반영됩니다')
  }

  const uploadThumbnail = async (file: File) => {
    setBusy(true)
    await uploadThumb(lora.rel_path, file)
    setBusy(false)
    setNote('썸네일 업로드됨')
  }

  const remove = async () => {
    if (!confirm(`로라 파일을 디스크에서 삭제합니다 (복구 불가):\n${lora.rel_path}`)) return
    setBusy(true)
    await deleteLora(lora.rel_path)
    onDeleted()
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
        <div className="grid-2" style={{ alignItems: 'flex-end' }}>
          <Field label="썸네일 업로드">
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
          <button className="danger" onClick={remove} disabled={busy}>파일 삭제</button>
          <button onClick={rescanPreview} disabled={busy}>CivitAI 재조회</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>취소</button>
          <button className="generate" onClick={save} disabled={busy}>저장</button>
        </div>
      </div>
    </div>
  )
}
