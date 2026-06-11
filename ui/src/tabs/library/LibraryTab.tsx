import { useEffect, useRef, useState } from 'react'
import { uploadStyle } from '../../api/library'
import { useLibrary, type LibMode } from '../../stores/library'
import { LorasPanel } from './LorasPanel'
import { StylesPanel } from './StylesPanel'

const MODES: { id: LibMode; label: string }[] = [
  { id: 'split', label: 'Split' },
  { id: 'styles', label: 'Styles' },
  { id: 'loras', label: 'LoRAs' },
]

export function LibraryTab() {
  const { loaded, mode, setMode, load } = useLibrary()
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    if (!loaded) load()
  }, [loaded, load])

  // PNG 드래그앤드롭 → 스타일 등록 (Style-Manager와 동일)
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const files = [...e.dataTransfer.files].filter((f) => f.type === 'image/png')
    if (files.length === 0) return
    for (const f of files) {
      const r = await uploadStyle(f)
      if (!r.ok) alert(`Upload failed (${f.name}): ${r.error ?? 'no embedded workflow metadata?'}`)
    }
    load()
  }

  return (
    <div className="library"
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true) }}
      onDragLeave={() => { if (--dragDepth.current <= 0) setDragging(false) }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}>
      <div className="lib-mode-bar">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className={`lib-body ${mode}`}>
        {mode !== 'loras' && <StylesPanel />}
        {mode !== 'styles' && <LorasPanel />}
      </div>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-msg">Drop PNG to register as a style (needs embedded workflow)</div>
        </div>
      )}
    </div>
  )
}
