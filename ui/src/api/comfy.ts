import type { ApiGraph } from '../workflow/types'

export function clientId(): string {
  let id = localStorage.getItem('peropix.clientId')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('peropix.clientId', id)
  }
  return id
}

export async function submitPrompt(graph: ApiGraph): Promise<string> {
  const res = await fetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId() }),
  })
  if (!res.ok) throw new Error(`/prompt ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.prompt_id
}

export interface OutputImage {
  filename: string
  subfolder: string
  type: string
}

/** Returns output images for a finished prompt, or null if not in history yet. */
export async function fetchOutputs(promptId: string): Promise<OutputImage[] | null> {
  const res = await fetch(`/history/${promptId}`)
  const data = await res.json()
  const entry = data[promptId]
  if (!entry) return null
  const images: OutputImage[] = []
  for (const out of Object.values(entry.outputs ?? {}) as { images?: OutputImage[] }[]) {
    for (const img of out.images ?? []) images.push(img)
  }
  return images
}

/** prompt_id들의 집합 — 큐(실행 중 + 대기)에 들어있는 작업들. */
export async function fetchQueueIds(): Promise<Set<string>> {
  const res = await fetch('/queue')
  const data = await res.json()
  const ids = new Set<string>()
  for (const list of [data.queue_running ?? [], data.queue_pending ?? []]) {
    for (const item of list as unknown[][]) ids.add(item[1] as string)
  }
  return ids
}

/** 이미지를 ComfyUI input 폴더에 업로드. LoadImage에서 쓸 파일명을 반환. */
export async function uploadImage(blob: Blob, name: string): Promise<string> {
  const form = new FormData()
  form.append('image', blob, name)
  form.append('overwrite', 'true')
  const res = await fetch('/upload/image', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`/upload/image ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name
}

/** 대기 큐에서 특정 prompt들을 제거. */
export async function deleteQueued(promptIds: string[]): Promise<void> {
  await fetch('/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: promptIds }),
  })
}

/** 현재 실행 중인 작업 중단. */
export async function interrupt(): Promise<void> {
  await fetch('/interrupt', { method: 'POST' })
}

export function viewUrl(img: OutputImage): string {
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type })
  return `/view?${q}`
}

/** viewUrl()의 역변환 — 갤러리 기록에서 파일 참조를 복원할 때 사용. */
export function parseViewUrl(url: string): OutputImage | undefined {
  const q = new URLSearchParams(url.split('?')[1] ?? '')
  const filename = q.get('filename')
  if (!filename) return undefined
  return { filename, subfolder: q.get('subfolder') ?? '', type: q.get('type') ?? 'output' }
}

export interface NodeObjectInfo {
  input: {
    required?: Record<string, unknown[]>
    optional?: Record<string, unknown[]>
  }
}

export async function fetchNodeInfo(cls: string): Promise<NodeObjectInfo | null> {
  const res = await fetch(`/object_info/${encodeURIComponent(cls)}`)
  if (!res.ok) return null
  const data = await res.json()
  return data[cls] ?? null
}

/** Extracts the choices of an enum-typed input (e.g. sampler_name, unet_name). */
export function enumValues(info: NodeObjectInfo | null, field: string): string[] {
  const spec = info?.input.required?.[field] ?? info?.input.optional?.[field]
  return Array.isArray(spec) && Array.isArray(spec[0]) ? (spec[0] as string[]) : []
}

interface WsMessage {
  type: string
  data: Record<string, unknown>
}

export interface SocketHandlers {
  onProgress?: (promptId: string, value: number, max: number) => void
  onDone?: (promptId: string) => void
  onError?: (promptId: string) => void
}

export function openSocket(handlers: SocketHandlers): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws?clientId=${clientId()}`)
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return // binary latent previews: handled later
    const msg = JSON.parse(ev.data) as WsMessage
    if (msg.type === 'progress_state') {
      const promptId = msg.data.prompt_id as string
      const nodes = Object.values((msg.data.nodes ?? {}) as Record<string, { value: number; max: number; state: string }>)
      const running = nodes.find((n) => n.state === 'running')
      if (running) handlers.onProgress?.(promptId, running.value, running.max)
    } else if (msg.type === 'execution_success') {
      handlers.onDone?.(msg.data.prompt_id as string)
    } else if (msg.type === 'executing' && msg.data.node === null) {
      handlers.onDone?.(msg.data.prompt_id as string)
    } else if (msg.type === 'execution_error') {
      handlers.onError?.(msg.data.prompt_id as string)
    }
  }
  return ws
}
