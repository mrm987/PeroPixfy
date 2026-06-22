import { useEffect, useState } from 'react'
import { checkUpdate, getVersion, openOutputFolder, pickFolder, type UpdateInfo, type VersionInfo } from '../api/comfy'
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

  // 버전 표시 + 업데이트 확인(읽기 전용). 적용은 update_peropixfy.bat이 담당.
  const [ver, setVer] = useState<VersionInfo | null>(null)
  const [upd, setUpd] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => { void getVersion().then(setVer).catch(() => {}) }, [])
  const check = async () => {
    setChecking(true)
    setUpd(null)
    try { setUpd(await checkUpdate()) }
    catch (e) { setUpd({ ok: false, error: String(e) }) }
    finally { setChecking(false) }
  }
  const verText = !ver ? '…' : [
    ver.version ? `v${ver.version}` : '',
    ver.commit ? `${ver.commit}${ver.date ? ` (${ver.date})` : ''}` : (ver.isGit ? '' : t('not a git checkout')),
  ].filter(Boolean).join('  ·  ')

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

        <label className="field">{t('Version')}
          <div className="folder-row">
            <input value={verText} readOnly />
            <button type="button" onClick={() => void check()} disabled={checking}>
              {checking ? t('Checking…') : t('Check for updates')}
            </button>
            {ver && (
              <button type="button" title={t('Open the folder with the update bat')}
                onClick={() => void openOutputFolder(ver.rootPath)}>{t('📂 Open')}</button>
            )}
          </div>
        </label>
        {upd && (
          <p className="notice">
            {!upd.ok
              ? t('Update check failed: {error}', { error: upd.error ?? '' })
              : upd.hasUpdate
                ? t('Update available — {n} commit(s) behind. Run peropixfy_update.bat in the ComfyUI portable root, then restart ComfyUI.', { n: String(upd.behind ?? 0) })
                : t('You are up to date.')}
          </p>
        )}
      </div>
    </div>
  )
}
