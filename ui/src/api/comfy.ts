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

/** 이미지 저장 폴더를 OS 탐색기로 연다. file(상대경로)을 주면 그 파일을 선택해 연다. */
export async function openOutputFolder(file?: string): Promise<void> {
  await fetch('/peropix/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: file ?? '' }),
  })
}

/** 대기 큐 전체 비우기 (실행 중인 작업은 별도 interrupt 필요). */
export async function clearQueue(): Promise<void> {
  await fetch('/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true }),
  })
}

export function viewUrl(img: OutputImage): string {
  // type 'abs' = output 밖 절대경로 저장물 → /view로는 못 받으니 전용 라우트로.
  if (img.type === 'abs') {
    const q = new URLSearchParams({ dir: img.subfolder, file: img.filename })
    return `/peropix/api/localview?${q}`
  }
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type })
  return `/view?${q}`
}

/** 네이티브 폴더 선택 다이얼로그(서버=내 PC)를 띄워 고른 절대경로를 반환. 취소 시 null. */
export async function pickFolder(): Promise<string | null> {
  const res = await fetch('/peropix/api/pick-folder', { method: 'POST' })
  return (await res.json()).path ?? null
}

export interface VersionInfo {
  version: string | null
  commit: string | null
  date: string | null
  branch: string | null
  isGit: boolean
  path: string
}
/** 현재 버전 정보 (선언 버전 + git 커밋/날짜 + 플러그인 경로). */
export async function getVersion(): Promise<VersionInfo> {
  return (await fetch('/peropix/api/version')).json()
}

export interface UpdateInfo {
  ok: boolean
  behind?: number
  hasUpdate?: boolean
  current?: string
  latest?: string
  branch?: string
  error?: string
}
/** origin과 비교해 업데이트 존재 여부 확인 (읽기 전용 — 적용은 update_peropixfy.bat). */
export async function checkUpdate(): Promise<UpdateInfo> {
  return (await fetch('/peropix/api/check-update', { method: 'POST' })).json()
}

/** 파일 참조들이 실제로 존재하는지 일괄 확인(인덱스 대응 bool 배열). */
export async function checkFilesExist(files: OutputImage[]): Promise<boolean[]> {
  const res = await fetch('/peropix/api/exists', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }),
  })
  return (await res.json()).exists ?? []
}

/** 다운스케일 webp 썸네일 URL (캔버스 줌아웃 LOD용). 백엔드에서 가로 w로 리사이즈. */
export function thumbUrl(img: OutputImage, w = 360): string {
  const q = new URLSearchParams({
    filename: img.filename, subfolder: img.subfolder, type: img.type, w: String(w),
  })
  return `/peropix/api/thumb?${q}`
}

/** viewUrl()의 역변환 — 갤러리 기록에서 파일 참조를 복원할 때 사용. */
export function parseViewUrl(url: string): OutputImage | undefined {
  const q = new URLSearchParams(url.split('?')[1] ?? '')
  if (url.startsWith('/peropix/api/localview')) {
    const file = q.get('file')
    if (!file) return undefined
    return { filename: file, subfolder: q.get('dir') ?? '', type: 'abs' }
  }
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
  if (!Array.isArray(spec)) return []
  // 구형 스키마: [[opt1, opt2, ...], {config}] — spec[0]이 옵션 배열.
  if (Array.isArray(spec[0])) return spec[0] as string[]
  // 신형 COMBO 스키마: ["COMBO", { options: [...] }] — 일부(커스텀) 노드가 이 형식을 쓴다.
  const cfg = spec[1] as { options?: unknown } | undefined
  return Array.isArray(cfg?.options) ? (cfg!.options as string[]) : []
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
