import { openOutputFolder, pickFolder } from '../api/comfy'
import { useT } from '../i18n'
import { useBatch } from '../stores/batch'
import { useUi, type Lang } from '../stores/ui'
import { useWorkbench } from '../stores/workbench'

/** 옵션 모달 — 언어 + Single/Multi 저장 폴더를 한 곳에서 설정. 상대=output 하위, 절대=자유 폴더. */
export function OptionsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const lang = useUi((s) => s.lang)
  const setPref = useUi((s) => s.setPref)
  const singleOutput = useWorkbench((s) => s.singleOutput)
  const setSingleOutput = useWorkbench((s) => s.setSingleOutput)
  const multiOutput = useBatch((s) => s.outputFolder)
  const setSetting = useBatch((s) => s.setSetting)

  const folderRow = (label: string, value: string, set: (v: string) => void, fallback: string, def: string) => (
    <label className="field">{label}
      <div className="folder-row">
        <input value={value} placeholder={fallback} onChange={(e) => set(e.target.value)} />
        <button type="button" title={t('Pick a folder (any location)')}
          onClick={() => void pickFolder().then((p) => { if (p) set(p) })}>{t('Select')}</button>
        <button type="button" title={t('Open the folder')}
          onClick={() => void openOutputFolder(value.trim() || fallback)}>{t('📂 Open')}</button>
        <button type="button" title={t('Reset to default')} disabled={value === def}
          onClick={() => set(def)}>{t('Reset')}</button>
      </div>
    </label>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="options-modal" onClick={(e) => e.stopPropagation()}>
        <div className="options-head">
          <span>{t('Settings')}</span>
          <button onClick={onClose}>{t('Close')}</button>
        </div>
        <label className="field">{t('Language')}
          <div className="folder-row">
            <select value={lang} onChange={(e) => setPref({ lang: e.target.value as Lang })}>
              <option value="en">English</option>
              <option value="ko">한국어</option>
            </select>
          </div>
        </label>
        {folderRow(t('Single output folder'), singleOutput, setSingleOutput, 'PeroPixfy/Single', '')}
        {folderRow(t('Multi output folder'), multiOutput, (v) => setSetting({ outputFolder: v }), 'PeroPixfy/Multi', 'PeroPixfy/Multi')}
        <p className="notice">
          {t("A relative path saves inside ComfyUI's output folder; pick any folder to save elsewhere. Single adds date/mode subfolders, Multi adds character/slot — automatically.")}
        </p>
      </div>
    </div>
  )
}
