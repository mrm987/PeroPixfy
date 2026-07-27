import { useEffect, useMemo, useState } from 'react'
import { tr, useT } from '../i18n'
import { loadWildcards, parseWildcardDoc, saveWildcards } from '../tags/wildcards'

/** 와일드카드 정의 문서 편집 모달 — #이름 섹션 + 한 줄=한 후보. 저장 시 서버 파일과 풀 캐시 갱신. */
export function WildcardModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [text, setText] = useState<string | null>(null) // null = 로딩 중
  const [savedText, setSavedText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadWildcards()
      .then((c) => { setText(c); setSavedText(c) })
      .catch(() => { setText(''); setError(t('Failed to load wildcards')) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pools = useMemo(() => parseWildcardDoc(text ?? ''), [text])

  const save = async () => {
    if (busy || text == null) return
    setBusy(true)
    setError(null)
    try {
      await saveWildcards(text)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // 저장 안 한 편집이 있으면 닫기 전에 확인(폐기).
  const attemptClose = () => {
    if (text != null && text !== savedText && !confirm(tr('Discard unsaved wildcard changes?'))) return
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={attemptClose}>
      <div className="edit-modal wildcard-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('Wildcards')}</h3>
        <div className="lib-meta">
          {t('Define a pool with a "#name" line followed by one candidate per line ("//" = comment). Type #name in a prompt to insert a random candidate on every generation.')}
        </div>
        {Object.keys(pools).length > 0 && (
          <div className="wc-pools">
            {Object.entries(pools).map(([n, c]) => (
              <span key={n} className="wc-pool-chip">#{n}<em>{c.length}</em></span>
            ))}
          </div>
        )}
        <textarea className="wc-editor" spellCheck={false}
          value={text ?? ''} disabled={text == null}
          placeholder={'#hair\nblonde hair\nwhite hair'}
          onChange={(e) => setText(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button onClick={attemptClose}>{t('Cancel')}</button>
          <button className="generate" onClick={save} disabled={busy || text == null}>
            {busy ? t('Saving…') : t('Save')}
          </button>
        </div>
      </div>
    </div>
  )
}
