import { useWorkbench } from '../../stores/workbench'
import { ParamsPanel } from './ParamsPanel'

export function WorkbenchTab() {
  const history = useWorkbench((s) => s.history)
  const selectedId = useWorkbench((s) => s.selectedId)
  const select = useWorkbench((s) => s.select)
  const restore = useWorkbench((s) => s.restore)
  const star = useWorkbench((s) => s.star)
  const remove = useWorkbench((s) => s.remove)

  const selected = history.find((h) => h.promptId === selectedId) ?? history[0]

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
            <button onClick={() => remove(selected.promptId)} title="기록에서 제거 (파일은 유지)">삭제</button>
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
      </div>
    </div>
  )
}
