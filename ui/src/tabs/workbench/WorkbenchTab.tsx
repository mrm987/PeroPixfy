import { useState } from 'react'
import { uploadImage } from '../../api/comfy'
import { MaskEditor } from '../../components/MaskEditor'
import { SaveStyleModal } from '../../components/SaveStyleModal'
import { useWorkbench, type HistoryItem } from '../../stores/workbench'
import { ParamsPanel } from './ParamsPanel'

async function fetchAsBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob()
}

export function WorkbenchTab() {
  const [maskTarget, setMaskTarget] = useState<string | null>(null)
  const [saveTarget, setSaveTarget] = useState<HistoryItem | null>(null)
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
    if (!maskTarget) return
    const stamp = Date.now()
    const [sourceImage, maskImage] = await Promise.all([
      uploadImage(await fetchAsBlob(maskTarget), `peropix_inpaint_src_${stamp}.png`),
      uploadImage(blob, `peropix_inpaint_mask_${stamp}.png`),
    ])
    set({ mode: 'inpaint', sourceImage, maskImage })
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
            <div className="placeholder">Generating…</div>
          ) : selected?.status === 'error' ? (
            <div className="placeholder error">Generation failed</div>
          ) : (
            <div className="placeholder">Results will appear here</div>
          )}
        </div>
        {selected && (
          <div className="result-meta">
            <span>seed {selected.params.seed}</span>
            <button onClick={() => restore(selected.params)} title="Load this result's settings back into the panel">
              Reuse settings
            </button>
            <button className={selected.starred ? 'starred' : ''} onClick={() => star(selected.promptId)}>
              {selected.starred ? '★' : '☆'}
            </button>
            {selected.imageUrls[0] && (
              <>
                <button onClick={() => setSaveTarget(selected)}
                  title="Save this result's model, prompts and LoRA stack as a style">Save as style</button>
                <button onClick={() => sendToI2i(selected.imageUrls[0])}>To I2I</button>
                <button onClick={() => setMaskTarget(selected.imageUrls[0])}>Inpaint</button>
              </>
            )}
            <button onClick={() => remove(selected.promptId)} title="Remove from history (files are kept)">
              Delete
            </button>
          </div>
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
        {maskTarget && (
          <MaskEditor imageUrl={maskTarget} onApply={applyMask} onClose={() => setMaskTarget(null)} />
        )}
        {saveTarget && (
          <SaveStyleModal item={saveTarget} onClose={() => setSaveTarget(null)} />
        )}
      </div>
    </div>
  )
}
