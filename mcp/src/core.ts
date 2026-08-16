// PeroPixfy MCP 코어 — ComfyUI(+PeroPixfy 플러그인 라우트) HTTP API로 워크스페이스를 읽고
// 생성을 큐에 넣는다. 그래프 구성은 앱과 같은 빌더(ui/src/workflow/builder)를 그대로 import
// 한다 — 그래프 로직의 정본은 하나다. 제출·기록 순서도 앱의 generate()(stores/workbench.ts)와
// 동일: /prompt 제출 → gallery/record(workspace 귀속) → 완료 시 gallery/complete.
import { enumValues, type NodeObjectInfo, type OutputImage } from '../../ui/src/api/comfy'
import { insertTriggers } from '../../ui/src/tags/promptTags'
import { buildGraph, resolveUpscaleModel } from '../../ui/src/workflow/builder'
import { ANIMA_DEFAULTS, defaultFilenamePrefix } from '../../ui/src/workflow/defaults'
import type { GenerationParams } from '../../ui/src/workflow/types'

const BASE = (process.env.PEROPIXFY_COMFY ?? 'http://127.0.0.1:8188').replace(/\/+$/, '')

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, init)
  } catch (e) {
    throw new Error(`Cannot reach ComfyUI at ${BASE} — is it running? (${String(e)})`)
  }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

const post = <T = unknown>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ---- 워크스페이스 (원장: 플러그인 서버의 loras.db) ----

export interface WsData {
  params?: Partial<GenerationParams>
  singleOutput?: string
  format?: 'png' | 'jpg' | 'webp'
  quality?: number
}

export interface WsRow {
  id: string
  name: string
  data: WsData
}

export async function listWorkspaces(): Promise<WsRow[]> {
  const res = await api<{ workspaces?: WsRow[] }>('/peropixfy/api/workspaces')
  return res.workspaces ?? []
}

// 이름 → 폴더 정규화. ui/src/stores/workbench.ts의 safeFolder와 동일해야 한다
// (그 모듈은 zustand persist가 import 시점에 localStorage를 만져 node로 못 불러온다 → 복사).
const safeFolder = (name: string) =>
  name.trim().replace(/[^\w\-가-힣 ]+/g, '').replace(/\s+/g, '_').slice(0, 40) || 'ws'

// id 정확 일치 → 이름 정확 일치 → 공백·밑줄·대소문자 무시 일치 순으로 찾는다
// ("워크스페이스10" ↔ "워크스페이스 10", "workspace 10" ↔ "Workspace_10" 표기 차이 흡수).
export async function resolveWorkspace(nameOrId: string): Promise<WsRow> {
  const rows = await listWorkspaces()
  const norm = (s: string) => s.replace(/[\s_]+/g, '').toLowerCase()
  const found =
    rows.find((r) => r.id === nameOrId) ??
    rows.find((r) => r.name === nameOrId) ??
    rows.find((r) => norm(r.name) === norm(nameOrId))
  if (!found) {
    const names = rows.map((r) => `${r.name} (id: ${r.id})`).join(', ')
    throw new Error(`Workspace "${nameOrId}" not found. Available: ${names || '(none)'}`)
  }
  return found
}

// 워크스페이스 저장 세팅 → 완전한 GenerationParams. 앱의 워크스페이스 로드(loadWorkspaces)와
// 같은 처리: 신규 필드는 기본값으로 백필, i2i/inpaint 소스는 세션 밖에서 무의미하므로 t2i 고정.
export function wsBaseParams(row: WsRow): GenerationParams {
  return { ...ANIMA_DEFAULTS, ...(row.data.params ?? {}), mode: 't2i', sourceImage: undefined, maskImage: undefined }
}

export function workspaceState(row: WsRow) {
  const p = wsBaseParams(row)
  return {
    id: row.id,
    name: row.name,
    model: { unet: p.unet, clip: p.clip, vae: p.vae },
    positive: p.positive,
    negative: p.negative,
    trigger_words: p.triggers ?? [],
    loras: p.loras.map((l) => ({ lora: l.relPath, strength: l.strength, enabled: l.enabled })),
    size: { width: p.width, height: p.height },
    sampling: { steps: p.steps, cfg: p.cfg, sampler: p.sampler, scheduler: p.scheduler, seed: p.seed },
    spectrum: p.spectrum?.enabled ? p.spectrum : { enabled: false },
    hires: p.hires?.enabled ? p.hires : { enabled: false },
    lut: p.lut?.name ? p.lut : null,
    output: {
      folder: row.data.singleOutput || `PeroPixfy/Single/${safeFolder(row.name)}`,
      format: row.data.format ?? 'png',
      quality: row.data.quality ?? 95,
    },
  }
}

// ---- 생성 ----

export interface GenerateOptions {
  workspace: string
  positive: string
  negative?: string
  count?: number
  width?: number
  height?: number
  steps?: number
  cfg?: number
  seed?: number
}

const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

const objectInfo = async (cls: string): Promise<NodeObjectInfo | null> => {
  const data = await api<Record<string, NodeObjectInfo>>(`/object_info/${encodeURIComponent(cls)}`)
  return data[cls] ?? null
}

export async function generate(opts: GenerateOptions) {
  const row = await resolveWorkspace(opts.workspace)
  const base = wsBaseParams(row)
  const count = Math.max(1, Math.min(20, Math.round(opts.count ?? 1)))

  // 설치되지 않은 LoRA는 그래프에서 제외 — 앱의 generate()와 같은 보정(400 방지). 업스케일
  // 모델도 hires가 켜져 있으면 설치 목록에 맞춰 준다.
  const loraInfo = await objectInfo('LoraLoaderModelOnly').catch(() => null)
  const installed = loraInfo ? new Set(enumValues(loraInfo, 'lora_name')) : null
  const skipped = installed ? base.loras.filter((l) => l.enabled && !installed.has(l.relPath)) : []
  const upscalers = base.hires?.enabled
    ? enumValues(await objectInfo('UpscaleModelLoader').catch(() => null), 'model_name')
    : []

  const trig = (base.triggers ?? []).filter(Boolean).join(', ')
  const common: GenerationParams = resolveUpscaleModel({
    ...base,
    positive: opts.positive,
    negative: opts.negative ?? base.negative,
    width: opts.width ?? base.width,
    height: opts.height ?? base.height,
    steps: opts.steps ?? base.steps,
    cfg: opts.cfg ?? base.cfg,
    batchSize: 1, // 1 job = 1 image — count는 시드만 다른 별도 job으로 나눠 각각 기록을 갖는다
    filenamePrefix: defaultFilenamePrefix('t2i', row.data.singleOutput || `PeroPixfy/Single/${safeFolder(row.name)}`),
    save: { format: row.data.format ?? 'png', quality: row.data.quality ?? 95 },
    ...(installed ? { loras: base.loras.filter((l) => !l.enabled || installed.has(l.relPath)) } : {}),
  }, upscalers)

  const jobs: { prompt_id: string; seed: number }[] = []
  for (let i = 0; i < count; i++) {
    const seed = opts.seed != null ? opts.seed + i : randomSeed()
    const params: GenerationParams = { ...common, seed }
    const res = await post<{ prompt_id: string }>('/prompt', { prompt: buildGraph(params), client_id: 'peropixfy-mcp' })
    // 기록에는 앱과 동일하게 트리거워드를 치환해 넣는다(불러오기·참고용 평문).
    const storeParams = { ...params, positive: insertTriggers(params.positive, trig) }
    await post('/peropixfy/api/gallery/record', {
      prompt_id: res.prompt_id, params: storeParams, source: 'single', workspace: row.id,
    })
    jobs.push({ prompt_id: res.prompt_id, seed })
  }

  return {
    workspace: { id: row.id, name: row.name },
    jobs,
    ...(skipped.length ? { skipped_loras_not_installed: skipped.map((l) => l.relPath) } : {}),
  }
}

// ---- 상태 조회 ----

interface QueueSnapshot {
  running: Set<string>
  pending: string[] // 대기 순서대로
}

async function fetchQueue(): Promise<QueueSnapshot> {
  const data = await api<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>('/queue')
  return {
    running: new Set((data.queue_running ?? []).map((it) => it[1] as string)),
    pending: (data.queue_pending ?? []).map((it) => it[1] as string),
  }
}

async function fetchHistoryOutputs(promptId: string): Promise<{ found: boolean; images: OutputImage[] }> {
  const data = await api<Record<string, { outputs?: Record<string, { images?: OutputImage[] }> }>>(
    `/history/${encodeURIComponent(promptId)}`)
  const entry = data[promptId]
  if (!entry) return { found: false, images: [] }
  const images: OutputImage[] = []
  for (const out of Object.values(entry.outputs ?? {})) for (const img of out.images ?? []) images.push(img)
  return { found: true, images }
}

interface GalleryRecord { prompt_id: string; status: 'pending' | 'done' | 'error'; files_json: string }

export interface StatusOptions {
  prompt_ids?: string[]
  workspace?: string
}

// 각 prompt의 상태를 큐/히스토리와 대조하고, 끝난 것은 갤러리 기록도 확정한다
// (앱의 recoverPending과 같은 판정 — 브라우저가 안 떠 있어도 기록이 pending에 방치되지 않게).
export async function generationStatus(opts: StatusOptions) {
  let ids = opts.prompt_ids ?? []
  let wsId: string | undefined
  if (opts.workspace) {
    const row = await resolveWorkspace(opts.workspace)
    wsId = row.id
    if (ids.length === 0) {
      const res = await api<{ generations?: GalleryRecord[] }>(
        `/peropixfy/api/gallery/list?limit=100&source=single&workspace=${encodeURIComponent(row.id)}`)
      ids = (res.generations ?? []).filter((g) => g.status === 'pending').map((g) => g.prompt_id)
    }
  }
  if (ids.length === 0) {
    const q = await fetchQueue()
    return { queue: { running: q.running.size, waiting: q.pending.length }, jobs: [], ...(wsId ? { note: 'no pending records in this workspace' } : {}) }
  }

  const q = await fetchQueue()
  const jobs = []
  for (const id of ids) {
    if (q.running.has(id)) {
      jobs.push({ prompt_id: id, status: 'running' as const })
    } else if (q.pending.includes(id)) {
      jobs.push({ prompt_id: id, status: 'queued' as const, position: q.pending.indexOf(id) + 1 })
    } else {
      const h = await fetchHistoryOutputs(id)
      if (h.images.length > 0) {
        await post('/peropixfy/api/gallery/complete', { prompt_id: id, files: h.images })
        jobs.push({
          prompt_id: id, status: 'done' as const,
          files: h.images.map((f) => (f.subfolder ? `${f.subfolder}/${f.filename}` : f.filename)),
        })
      } else {
        // 큐에도 없고 출력도 없다 — 실행 실패이거나 큐가 비워진 것. 기록도 error로 확정.
        await post('/peropixfy/api/gallery/fail', { prompt_id: id })
        jobs.push({ prompt_id: id, status: 'error' as const, ...(h.found ? {} : { note: 'not found in queue or history' }) })
      }
    }
  }
  return { queue: { running: q.running.size, waiting: q.pending.length }, jobs }
}
