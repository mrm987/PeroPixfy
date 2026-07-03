import { useEffect, useState } from 'react'
import { getVersion, openOutputFolder, pickFolder, type VersionInfo } from '../api/comfy'
import { useT } from '../i18n'
import { useBatch } from '../stores/batch'
import { useWorkbench } from '../stores/workbench'

/** 옵션 모달 — 언어 + Single/Multi 저장 폴더를 한 곳에서 설정. 상대=output 하위, 절대=자유 폴더. */
export function OptionsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const singleOutput = useWorkbench((s) => s.singleOutput)
  const setSingleOutput = useWorkbench((s) => s.setSingleOutput)
  const multiOutput = useBatch((s) => s.outputFolder)
  const setSetting = useBatch((s) => s.setSetting)

  // 버전 표시(읽기 전용). 업데이트 확인/적용은 이제 ComfyUI-Manager가 담당.
  const [ver, setVer] = useState<VersionInfo | null>(null)
  useEffect(() => { void getVersion().then(setVer).catch(() => {}) }, [])
  // 레지스트리 게시 버전(pyproject.toml)을 표시 — git 커밋/날짜는 노출하지 않는다.
  const verText = !ver ? '…' : (ver.version ? `v${ver.version}` : '—')

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
        {folderRow(t('Single output folder'), singleOutput, setSingleOutput, 'PeroPixfy/Single', '')}
        {folderRow(t('Multi output folder'), multiOutput, (v) => setSetting({ outputFolder: v }), 'PeroPixfy/Multi', 'PeroPixfy/Multi')}
        <p className="notice">
          {t("A relative path saves inside ComfyUI's output folder; pick any folder to save elsewhere. Single adds date/mode subfolders, Multi adds character/slot — automatically.")}
        </p>

        <label className="field">{t('Version')}
          <div className="folder-row">
            <input value={verText} readOnly />
          </div>
        </label>
      </div>
    </div>
  )
}
