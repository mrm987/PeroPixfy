import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { fetchSetupStatus, startSetupDownload, type SetupAsset } from '../api/setup'

const fmt = (n?: number) => {
  if (!n) return '0'
  const u = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)}${u[i]}`
}

/**
 * 첫 설치 안내 배너 — 동작에 필요한 모델이 없으면 상단에 떠서 다운로드를 돕는다.
 * 필수 모델이 모두 있고 진행/완료 상태도 없으면 아무것도 렌더하지 않는다.
 */
export function SetupBanner() {
  const t = useT()
  const [assets, setAssets] = useState<SetupAsset[]>([])
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      setAssets(await fetchSetupStatus())
      setLoaded(true)
    } catch { /* 서버 미준비 — 다음 폴링에서 재시도 */ }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const downloading = assets.some((a) => a.progress?.status === 'downloading')
  // 다운로드 중에만 1.5초 폴링.
  useEffect(() => {
    if (downloading && !timer.current) {
      timer.current = setInterval(() => void refresh(), 1500)
    } else if (!downloading && timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
  }, [downloading, refresh])

  if (!loaded) return null
  const missing = assets.filter((a) => !a.present)
  const reqMissing = assets.filter((a) => a.required && !a.present)
  const finished = assets.some((a) => a.progress?.status === 'done')
  const errored = assets.some((a) => a.progress?.status === 'error')
  if (missing.length === 0 && !downloading && !finished && !errored) return null

  const allPresent = missing.length === 0
  const startAll = () => void startSetupDownload(missing.map((a) => a.key)).then(refresh)

  return (
    <div className={`setup-banner${reqMissing.length ? ' warn' : ''}`}>
      <div className="setup-head">
        <span>
          {allPresent
            ? (finished ? t('Models downloaded — reload to use them.') : t('All required models are installed.'))
            : reqMissing.length
              ? t('Required models are missing — generation will fail until you download them.')
              : t('An optional model is missing.')}
        </span>
        {allPresent && finished ? (
          <button onClick={() => location.reload()}>{t('Reload')}</button>
        ) : !downloading && missing.length > 0 ? (
          <button onClick={startAll}>{t('Download all missing ({n})', { n: missing.length })}</button>
        ) : downloading ? (
          <span className="setup-busy">{t('Downloading…')}</span>
        ) : null}
      </div>
      <div className="setup-list">
        {assets.map((a) => {
          const p = a.progress || {}
          const pct = p.total && p.received != null ? Math.floor((p.received / p.total) * 100) : 0
          return (
            <div key={a.key} className="setup-row">
              <span className="setup-name">{a.label}{a.required ? '' : t(' (optional)')}</span>
              {a.present ? (
                <span className="setup-ok">{a.exact ? t('✓ installed') : t('✓ you already have models here')}</span>
              ) : p.status === 'downloading' ? (
                <span className="setup-prog">
                  <span className="setup-bar"><span style={{ width: `${pct}%` }} /></span>
                  {fmt(p.received)} / {fmt(p.total)} ({pct}%)
                </span>
              ) : p.status === 'error' ? (
                <span className="setup-err">✕ {p.error}</span>
              ) : (
                <span className="setup-miss">{t('missing')}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
