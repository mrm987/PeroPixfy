import { useEffect, useRef, useState } from 'react'
import { fetchOutputs, openSocket, submitPrompt, viewUrl } from './api/comfy'
import { buildGraph } from './workflow/builder'
import { ANIMA_DEFAULTS } from './workflow/defaults'

const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

export default function App() {
  const [positive, setPositive] = useState('')
  const [negative, setNegative] = useState('')
  const [seed, setSeed] = useState(randomSeed())
  const [randomize, setRandomize] = useState(true)
  const [progress, setProgress] = useState<{ value: number; max: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingId = useRef<string | null>(null)

  useEffect(() => {
    const ws = openSocket({
      onProgress: (value, max) => setProgress({ value, max }),
      onDone: async (promptId) => {
        if (promptId !== pendingId.current) return
        const outputs = await fetchOutputs(promptId)
        if (outputs && outputs.length > 0) setImageUrl(viewUrl(outputs[0]))
        setBusy(false)
        setProgress(null)
      },
    })
    return () => ws.close()
  }, [])

  const generate = async () => {
    setError(null)
    setBusy(true)
    const usedSeed = randomize ? randomSeed() : seed
    setSeed(usedSeed)
    try {
      pendingId.current = await submitPrompt(buildGraph({ ...ANIMA_DEFAULTS, positive, negative, seed: usedSeed }))
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h2>PeroPix — M1</h2>
      <textarea value={positive} onChange={(e) => setPositive(e.target.value)} placeholder="positive prompt"
        rows={6} style={{ width: '100%', boxSizing: 'border-box' }} />
      <textarea value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="negative prompt"
        rows={3} style={{ width: '100%', boxSizing: 'border-box', marginTop: 8 }} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
        <label>
          seed{' '}
          <input type="number" value={seed} disabled={randomize}
            onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 180 }} />
        </label>
        <label>
          <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} /> 랜덤
        </label>
        <button onClick={generate} disabled={busy} style={{ padding: '8px 24px' }}>
          {busy ? '생성 중…' : '생성'}
        </button>
        {progress && <span>{progress.value} / {progress.max}</span>}
      </div>
      {error && <pre style={{ color: '#c33', whiteSpace: 'pre-wrap' }}>{error}</pre>}
      {imageUrl && <img src={imageUrl} alt="result" style={{ width: '100%', marginTop: 16 }} />}
    </div>
  )
}
