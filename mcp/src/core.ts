// PeroPixfy MCP 코어 — ComfyUI(+PeroPixfy 플러그인 라우트) HTTP API로 워크스페이스를 읽고
// 생성을 큐에 넣는다. 그래프 구성은 앱과 같은 빌더(ui/src/workflow/builder)를 그대로 import
// 한다 — 그래프 로직의 정본은 하나다. 제출·기록 순서도 앱의 generate()(stores/workbench.ts)와
// 동일: /prompt 제출 → gallery/record(workspace 귀속) → 완료 시 gallery/complete.
import { enumValues, type NodeObjectInfo, type OutputImage } from '../../ui/src/api/comfy'
import { findTagRun, insertTriggers, placeTokenAt, tagSpans } from '../../ui/src/tags/promptTags'
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
// '워크스페이스'는 workspace의 음역이라 기계적 별칭으로 치환한다 — 사용자가 한국어로 부르고
// 앱 기본 이름은 영문(Workspace_N)이라, 이 한 쌍만은 코드가 흡수해야 매칭이 된다 (실측 사례).
export async function resolveWorkspace(nameOrId: string): Promise<WsRow> {
  const rows = await listWorkspaces()
  const norm = (s: string) => s.replace(/워크스페이스/g, 'workspace').replace(/[\s_]+/g, '').toLowerCase()
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

// ---- 스타일 (라이브러리) ----

export interface StyleLoraRef {
  display_name: string
  lora_rel_path: string
  strength: number
  enabled: number
}

export interface StyleRecord {
  id: number
  name: string
  width: number
  height: number
  checkpoint: string
  positive_prompt: string
  negative_prompt: string
  sampler: string
  scheduler: string
  seed: number
  steps: number
  cfg: number
  tags: string
  nsfw: number
  trigger_meta?: string // JSON {triggers, order} — 저장 시점의 활성 트리거워드 스냅샷
  loras?: StyleLoraRef[]
}

async function fetchStyles(): Promise<StyleRecord[]> {
  const res = await api<{ styles?: StyleRecord[] }>('/peropixfy/api/library/styles/list')
  return res.styles ?? []
}

// 워크스페이스와 같은 규칙(id → 이름 정확 → 공백·밑줄·대소문자 무시)으로 스타일을 찾는다.
export async function resolveStyle(nameOrId: string): Promise<StyleRecord> {
  const rows = await fetchStyles()
  const norm = (s: string) => s.replace(/[\s_]+/g, '').toLowerCase()
  const found =
    rows.find((r) => String(r.id) === nameOrId) ??
    rows.find((r) => r.name === nameOrId) ??
    rows.find((r) => norm(r.name) === norm(nameOrId))
  if (!found) {
    const names = rows.map((r) => `${r.name} (id: ${r.id})`).join(', ')
    throw new Error(`Style "${nameOrId}" not found. Available: ${names || '(none)'}`)
  }
  return found
}

export async function listStyles() {
  const rows = await fetchStyles()
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ...(r.tags ? { tags: r.tags } : {}),
    checkpoint: r.checkpoint,
    size: `${r.width}x${r.height}`,
    loras: (r.loras ?? []).filter((l) => l.enabled).map((l) => l.lora_rel_path || l.display_name),
    nsfw: !!r.nsfw,
  }))
}

// 설치 목록 매칭 — 앱 applyStyle(ui/src/stores/library.ts)과 같은 규칙.
// 로라: basename(확장자 제거)으로, 체크포인트: 구분자(-_. 공백)까지 지워서 잡는다.
const baseOf = (s: string) =>
  s.replace(/\\/g, '/').split('/').pop()!.replace(/\.(safetensors|ckpt|pt)$/i, '').toLowerCase()
const stripKey = (s: string) =>
  s.replace(/\\/g, '/').split('/').pop()!.replace(/\.(safetensors|ckpt|gguf|sft|pt)$/i, '')
    .replace(/[-_.\s]/g, '').toLowerCase()

// 스타일의 로라 참조를 설치본 경로로 해석. 미설치면 적힌 이름 그대로 둔다 —
// 이후 제출 직전의 미설치 필터가 걸러서 skipped로 보고한다 (앱과 같은 2단 처리).
function resolveStyleLoras(st: StyleRecord, installed: Set<string> | null) {
  const byBase = new Map<string, string>()
  if (installed) for (const a of installed) if (!byBase.has(baseOf(a))) byBase.set(baseOf(a), a)
  return (st.loras ?? [])
    .map((l) => {
      const raw = (l.lora_rel_path || l.display_name || '').replace(/\\/g, '/')
      const relPath = !raw || !installed ? raw : installed.has(raw) ? raw : byBase.get(baseOf(raw)) ?? raw
      return { relPath, strength: l.strength, enabled: !!l.enabled }
    })
    .filter((l) => l.relPath)
}

// 스타일 스냅샷(trigger_meta) 파싱 — 자동 트리거워드로 생성한 스타일만 이 필드를 갖는다.
function styleMeta(st: StyleRecord): { template?: string; triggers?: string[]; order?: string[] } | null {
  try { return st.trigger_meta ? JSON.parse(st.trigger_meta) : null } catch { return null }
}

// 스타일 스냅샷의 트리거워드 — 스냅샷이 있으면 그대로가 정본이다.
// ★"제출 프롬프트에 이미 있으면 뺀다"는 문자열 대조를 하지 않는다. 에이전트가 스타일 프롬프트를
// 참고하며 트리거워드까지 옮겨 적으면 전부 '중복'으로 걸러져 기능이 통째로 꺼졌고(실측), 기록도
// 칩 없이 남았다. 중복은 아래 buildTemplate이 '그 자리를 @triggers 토큰으로 바꿔' 없앤다.
function styleTriggers(st: StyleRecord): string[] {
  return (styleMeta(st)?.triggers ?? []).filter(Boolean)
}

// 기준 프롬프트(스타일의 저장 template · 워크스페이스의 positive)가 @triggers 를 둔 자리를 제출
// 프롬프트에서 찾는다. 기준의 '토큰 앞 구간'과 제출 프롬프트를 앞에서부터 태그 단위로 맞춰 보고,
// 일치가 끊기는 지점을 돌려준다 — 도구 설명대로 스타일의 퀄리티·화가 블록을 재사용했다면 정확히
// 그 자리다. 겹치는 선두가 없으면 맨 앞(0)에 둔다.
// ★끝에 붙이지 않는다 (2026-08-28 사용자 지적·같은 시드 대조): 트리거를 맨 뒤로 보내면 화가·스타일
//   단어가 뒤로 밀려 같은 시드에서도 그림이 달라졌다.
function anchorOffset(positive: string, anchor: string | undefined, trigWords: string[]): number {
  if (!anchor) return 0
  // 기준이 토큰형이 아니라 트리거워드를 평문으로 갖고 있으면(워크스페이스 프롬프트가 그럴 수 있다)
  // 그 구간의 시작을 토큰 자리로 본다.
  let at = anchor.search(/@triggers/i)
  if (at < 0) {
    const words = new Set(trigWords.map((w) => w.toLowerCase()))
    const run = words.size ? findTagRun(anchor, (tag) => words.has(tag.toLowerCase())) : null
    if (!run) return 0
    at = run.start
  }
  const head = tagSpans(anchor.slice(0, at)).map((t) => t.text.trim().toLowerCase())
  if (!head.length) return 0
  const mine = tagSpans(positive)
  let k = 0
  while (k < head.length && k < mine.length && mine[k].text.trim().toLowerCase() === head[k]) k++
  return k ? mine[k - 1].end : 0
}

// 제출 프롬프트를 원형(@triggers 토큰이 든 template)으로 만든다. 이미 토큰이 있으면 그대로,
// 트리거워드가 평문으로 박혀 있으면 그 구간을 토큰으로 치환(자리 보존), 둘 다 없으면 기준
// 프롬프트가 토큰을 두었던 자리에 끼운다(anchorOffset).
export function buildTemplate(positive: string, trigWords: string[], anchor?: string): string {
  if (/@triggers/i.test(positive)) return positive
  const set = new Set(trigWords.map((w) => w.toLowerCase()))
  const run = set.size ? findTagRun(positive, (tag) => set.has(tag.toLowerCase())) : null
  if (run) return positive.slice(0, run.start) + '@triggers' + positive.slice(run.end)
  return placeTokenAt(positive, anchorOffset(positive, anchor, trigWords))
}

// get_style용 상세 — 프롬프트 전문 + 각 로라의 설치 여부까지.
export async function styleDetail(nameOrId: string) {
  const st = await resolveStyle(nameOrId)
  const info = await objectInfo('LoraLoaderModelOnly').catch(() => null)
  const installed = info ? new Set(enumValues(info, 'lora_name')) : null
  return {
    id: st.id,
    name: st.name,
    ...(st.tags ? { tags: st.tags } : {}),
    checkpoint: st.checkpoint,
    positive_prompt: st.positive_prompt,
    negative_prompt: st.negative_prompt,
    trigger_words: styleTriggers(st),
    loras: resolveStyleLoras(st, installed).map((l) => ({
      ...l, ...(installed ? { installed: installed.has(l.relPath) } : {}),
    })),
    size: { width: st.width, height: st.height },
    sampling: { steps: st.steps, cfg: st.cfg, sampler: st.sampler, scheduler: st.scheduler },
    nsfw: !!st.nsfw,
  }
}

// ---- 생성 ----

export interface GenerateOptions {
  workspace: string
  positive: string
  style?: string
  negative?: string
  count?: number
  width?: number
  height?: number
  steps?: number
  cfg?: number
  seed?: number
  lora_strengths?: Record<string, number>
  lut?: { name: string; strength?: number } | null
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
  const st = opts.style != null ? await resolveStyle(opts.style) : null

  const loraInfo = await objectInfo('LoraLoaderModelOnly').catch(() => null)
  const installed = loraInfo ? new Set(enumValues(loraInfo, 'lora_name')) : null

  // 스타일 지정 시 로라·모델·해상도·샘플링을 스타일 것으로 갈아끼운다 — 앱의 Apply
  // (ui/src/stores/library.ts applyStyle)와 같은 병합. 체크포인트는 설치본에 이름 매칭,
  // 미설치면 워크스페이스 모델 유지(제출 오류 방지). 시드는 스타일 것을 쓰지 않는다
  // (count장이 전부 같은 그림이 된다) — 재현이 필요하면 seed 인자로 지정한다.
  let stylePatch: Partial<GenerationParams> = {}
  if (st) {
    const unets = st.checkpoint
      ? enumValues(await objectInfo('UNETLoader').catch(() => null), 'unet_name')
      : []
    const wantUnet = st.checkpoint
      ? (unets.includes(st.checkpoint) ? st.checkpoint : unets.find((u) => stripKey(u) === stripKey(st.checkpoint)) ?? '')
      : ''
    stylePatch = {
      loras: resolveStyleLoras(st, installed),
      ...(wantUnet ? { unet: wantUnet } : {}),
      ...(st.width > 0 && st.height > 0 ? { width: st.width, height: st.height } : {}),
      ...(st.sampler ? { sampler: st.sampler } : {}),
      ...(st.scheduler ? { scheduler: st.scheduler } : {}),
      ...(st.steps > 0 ? { steps: st.steps } : {}),
      ...(st.cfg > 0 ? { cfg: st.cfg } : {}),
    }
  }
  const merged: GenerationParams = { ...base, ...stylePatch }

  // 이 작업에만 적용할 LoRA 강도 덮어쓰기. 키는 파일명 일부(공백·기호·대소문자 무시)로
  // 워크스페이스(스타일 지정 시 스타일)의 로라 목록에서 찾는다 — 목록에 없는 로라를 새로
  // 끼우지는 않는다(설치 확인·트리거 처리가 딸려온다). 명시한 로라는 꺼져 있어도 켠다.
  const loraOverrides: { lora: string; strength: number }[] = []
  for (const [key, strength] of Object.entries(opts.lora_strengths ?? {})) {
    if (typeof strength !== 'number' || !Number.isFinite(strength)) {
      throw new Error(`lora_strengths["${key}"] must be a finite number`)
    }
    const want = stripKey(key)
    const hits = merged.loras.filter((l) => stripKey(l.relPath).includes(want))
    if (hits.length === 0) {
      const names = merged.loras.map((l) => l.relPath).join(', ')
      throw new Error(`LoRA "${key}" is not in this ${st ? 'style' : 'workspace'}. Available: ${names || '(none)'}`)
    }
    if (hits.length > 1) {
      throw new Error(`LoRA "${key}" is ambiguous — matches: ${hits.map((l) => l.relPath).join(', ')}`)
    }
    merged.loras = merged.loras.map((l) =>
      l === hits[0] ? { ...l, strength, enabled: true } : l,
    )
    loraOverrides.push({ lora: hits[0].relPath, strength })
  }

  // LUT 이름은 노드가 자유 문자열로 받아(enum이 아니다) 오타를 걸러 주는 곳이 없다 —
  // 틀리면 색보정 없이 조용히 생성되므로 목록과 대조한다 (LoRA 처리와 같은 결).
  if (opts.lut) {
    const luts = (await api<{ luts?: string[] }>('/peropixfy/api/luts')).luts ?? []
    if (luts.length && !luts.includes(opts.lut.name)) {
      throw new Error(`LUT "${opts.lut.name}" not found. Available: ${luts.join(', ')}`)
    }
  }

  // 설치되지 않은 LoRA는 그래프에서 제외 — 앱의 generate()와 같은 보정(400 방지). 업스케일
  // 모델도 hires가 켜져 있으면 설치 목록에 맞춰 준다.
  const skipped = installed ? merged.loras.filter((l) => l.enabled && !installed.has(l.relPath)) : []
  const upscalers = merged.hires?.enabled
    ? enumValues(await objectInfo('UpscaleModelLoader').catch(() => null), 'model_name')
    : []

  // 트리거워드: 워크스페이스 기반이면 워크스페이스의 활성 트리거, 스타일 기반이면 스타일
  // 스냅샷(trigger_meta) 그대로 (로라가 스타일 것으로 바뀌므로 워크스페이스 트리거를 붙이면
  // 엉뚱한 로라의 단어가 들어간다).
  const trigWords = st ? styleTriggers(st) : (base.triggers ?? [])
  const trig = trigWords.filter(Boolean).join(', ')
  // 앱이 자동 트리거워드 ON으로 생성했을 때와 같은 기록을 남기기 위한 원형. 에이전트가 단어를
  // 평문으로 적어 보냈으면 그 구간이 토큰으로 바뀌므로 자리도 그대로고 중복도 생기지 않는다.
  // 토큰도 단어도 없으면 기준 프롬프트(스타일 template · 워크스페이스 positive)의 자리를 따른다.
  const anchorPrompt = st ? (styleMeta(st)?.template || st.positive_prompt) : base.positive
  const positiveTemplate = buildTemplate(opts.positive, trigWords, anchorPrompt)
  const styleOrder = st ? styleMeta(st)?.order : undefined
  const trigOrder = styleOrder?.length ? styleOrder : trigWords.filter(Boolean).map((w) => w.toLowerCase())
  const common: GenerationParams = resolveUpscaleModel({
    ...merged,
    // 삽입할 단어가 있으면 원형(토큰)으로 제출한다 — 빌더가 토큰 자리에 치환하므로 단어가 원래
    // 있던 자리에 그대로 들어가고, 평문으로 적혀 있던 것과 겹치지 않는다.
    positive: trig ? positiveTemplate : opts.positive,
    negative: opts.negative ?? (st?.negative_prompt || merged.negative),
    triggers: trigWords,
    width: opts.width ?? merged.width,
    height: opts.height ?? merged.height,
    steps: opts.steps ?? merged.steps,
    cfg: opts.cfg ?? merged.cfg,
    // 생략하면 워크스페이스에 저장된 LUT 그대로, null 이면 끈다, 객체면 이 작업에만 적용.
    // 빌더는 name 이 비면 LUT 노드를 넣지 않는다(ui/src/workflow/builder.ts).
    ...(opts.lut !== undefined
      ? { lut: opts.lut ? { name: opts.lut.name, strength: opts.lut.strength ?? 0.8 } : undefined }
      : {}),
    batchSize: 1, // 1 job = 1 image — count는 시드만 다른 별도 job으로 나눠 각각 기록을 갖는다
    filenamePrefix: defaultFilenamePrefix('t2i', row.data.singleOutput || `PeroPixfy/Single/${safeFolder(row.name)}`),
    save: { format: row.data.format ?? 'png', quality: row.data.quality ?? 95 },
    ...(installed ? { loras: merged.loras.filter((l) => !l.enabled || installed.has(l.relPath)) } : {}),
  }, upscalers)

  const jobs: { prompt_id: string; seed: number }[] = []
  for (let i = 0; i < count; i++) {
    const seed = opts.seed != null ? opts.seed + i : randomSeed()
    const params: GenerationParams = { ...common, seed }
    const res = await post<{ prompt_id: string }>('/prompt', { prompt: buildGraph(params), client_id: 'peropixfy-mcp' })
    // 기록에는 앱과 동일하게 트리거워드를 치환해 넣는다(불러오기·참고용 평문). 트리거워드가
    // 삽입된 생성이면 positiveTemplate·triggerOrder도 함께 — 앱의 restore()가 이 기록을
    // 자동 트리거워드 ON 상태(칩)로 복원한다. 삽입할 단어가 없으면 넣지 않는다(복원할 것이
    // 없는데 토큰형으로 남기면, 불러올 때 로라 트리거 전역 on/off까지 빈 집합으로 덮는다).
    const storeParams = {
      ...params,
      positive: insertTriggers(params.positive, trig),
      ...(trig ? { positiveTemplate, triggerOrder: trigOrder } : {}),
    }
    await post('/peropixfy/api/gallery/record', {
      prompt_id: res.prompt_id, params: storeParams, source: 'single', workspace: row.id,
    })
    jobs.push({ prompt_id: res.prompt_id, seed })
  }

  return {
    workspace: { id: row.id, name: row.name },
    ...(st ? { style: { id: st.id, name: st.name } } : {}),
    ...(loraOverrides.length ? { lora_overrides: loraOverrides } : {}),
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
