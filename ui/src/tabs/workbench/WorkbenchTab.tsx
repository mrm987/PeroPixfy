import { useState } from 'react'
import { uploadImage } from '../../api/comfy'
import { MaskEditor } from '../../components/MaskEditor'
import { useWorkbench } from '../../stores/workbench'
import { ParamsPanel } from './ParamsPanel'

async function fetchAsBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob()
}

export function WorkbenchTab() {
  const [maskTarget, setMaskTarget] = useState<string | null>(null)
  const history = useWorkbench((s) => s.history)
  const selectedId = useWorkbench((s) => s.selectedId)
  const select = useWorkbench((s) => s.select)
  const restore = useWorkbench((s) => s.restore)
  const star = useWorkbench((s) => s.star)
  const remove = useWorkbench((s) => s.remove)
  const set = useWorkbench((s) => s.set)

  const selected = history.find((h) => h.promptId === selectedId) ?? history[0]

  const sendToI2i = async (imageUrl: string) => {
    const name = await uploadImage(await fetchAsBlob(imageUrl), `peropix_i2i_${Date.now()}.png`)
    set({ mode: 'i2i', sourceImage: name })
  }

  const applyMask = async (blob: Blob) => {
    const name = await uploadImage(blob, `peropix_inpaint_${Date.now()}.png`)
    set({ mode: 'inpaint', sourceImage: name })
    setMaskTarget(null)
  }

  return (
    <div className="workbench">
      <ParamsPanel />
      <div className="result-area">
        <div className="result-main">
          {selected?.status === 'done' && selected.imageUrls.length > 0 ? (
            <img src={selected.imageUrls[0]} alt="result" />
          ) : selected?.status === 'pending' ? (
            <div className="placeholder">생성 중…</div>
          ) : selected?.status === 'error' ? (
            <div className="placeholder error">생성 실패</div>
          ) : (
            <div className="placeholder">결과가 여기에 표시됩니다</div>
          )}
        </div>
        {selected && (
          <div className="result-meta">
            <span>seed {selected.params.seed}</span>
            <button onClick={() => restore(selected.params)}>이 설정으로</button>
            <button className={selected.starred ? 'starred' : ''} onClick={() => star(selected.promptId)}>
              {selected.starred ? '★' : '☆'}
            </button>
            {selected.imageUrls[0] && (
              <>
                <button onClick={() => sendToI2i(selected.imageUrls[0])}>i2i로</button>
                <button onClick={() => setMaskTarget(selected.imageUrls[0])}>인페인트</button>
              </>
            )}
            <button onClick={() => remove(selected.promptId)} title="기록에서 제거 (파일은 유지)">삭제</button>
          </div>
        )}
        {maskTarget && (
          <MaskEditor imageUrl={maskTarget} onApply={applyMask} onClose={() => setMaskTarget(null)} />
        )}
        {history.length > 0 && (
          <div className="history-strip">
            {history.map((h) => (
              <button key={h.promptId}
                className={`history-thumb${h.promptId === selected?.promptId ? ' active' : ''}`}
                onClick={() => select(h.promptId)}
                title={`seed ${h.params.seed}`}>
                {h.status === 'done' && h.imageUrls[0] ? (
                  <img src={h.imageUrls[0]} alt="" />
                ) : (
                  <span>{h.status === 'pending' ? '…' : '✕'}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
