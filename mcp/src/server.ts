// PeroPixfy MCP 서버 (stdio) — 도구 등록만 담당. 실제 동작은 core.ts.
// 실행: node dist/server.cjs  (환경변수 PEROPIXFY_COMFY로 ComfyUI 주소 지정, 기본 127.0.0.1:8188)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { generate, generationStatus, listStyles, listWorkspaces, resolveWorkspace, styleDetail, workspaceState } from './core'

const server = new McpServer({ name: 'peropixfy', version: '0.1.0' })

const jsonResult = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const errorResult = (e: unknown) => ({ content: [{ type: 'text' as const, text: String(e instanceof Error ? e.message : e) }], isError: true })

server.registerTool(
  'list_workspaces',
  { description: 'List PeroPixfy workspaces (Single tab work units) with their id and name.' },
  async () => {
    try {
      return jsonResult((await listWorkspaces()).map((r) => ({ id: r.id, name: r.name })))
    } catch (e) { return errorResult(e) }
  },
)

server.registerTool(
  'get_workspace_state',
  {
    description: 'Get a workspace\'s current generation setup: model, positive/negative prompt, LoRA stack with trigger words, size, steps/cfg/sampler, hires/spectrum, output folder and format.',
    inputSchema: { workspace: z.string().describe('Workspace name or id (spacing/case-insensitive match)') },
  },
  async ({ workspace }) => {
    try {
      return jsonResult(workspaceState(await resolveWorkspace(workspace)))
    } catch (e) { return errorResult(e) }
  },
)

server.registerTool(
  'list_styles',
  { description: 'List saved styles from the PeroPixfy library (id, name, tags, checkpoint, size, LoRAs). A style is a reusable look: prompt + LoRA stack + model + sampling settings.' },
  async () => {
    try {
      return jsonResult(await listStyles())
    } catch (e) { return errorResult(e) }
  },
)

server.registerTool(
  'get_style',
  {
    description: 'Get a style\'s full definition: positive/negative prompt, LoRA stack (with installed flags), checkpoint, size, sampling. Read this before generating with the style — reuse its quality/artist/style blocks in your positive prompt and replace only the character/scene part.',
    inputSchema: { style: z.string().describe('Style name or id (spacing/case-insensitive match)') },
  },
  async ({ style }) => {
    try {
      return jsonResult(await styleDetail(style))
    } catch (e) { return errorResult(e) }
  },
)

server.registerTool(
  'generate',
  {
    description: 'Queue image generation in a PeroPixfy workspace. Uses the workspace\'s saved setup (model, LoRAs + trigger words, size, steps, cfg, output folder) as the base — you supply the positive prompt (Danbooru-style tags; the workspace\'s active LoRA trigger words are appended automatically). With `style`, that style\'s LoRAs, checkpoint, size and sampling replace the workspace base (output folder stays the workspace\'s) — call get_style first and compose your positive from its prompt. Each job renders 1 image with its own seed and appears live in that workspace\'s queue/history in the app. Returns prompt_ids; poll with get_generation_status.',
    inputSchema: {
      workspace: z.string().describe('Workspace name or id'),
      style: z.string().optional().describe('Style name or id from list_styles — use its LoRAs/model/size/sampling as the base'),
      positive: z.string().describe('Positive prompt (Danbooru-style tags, e.g. "1girl, silver hair, knight armor, ...")'),
      negative: z.string().optional().describe('Negative prompt override (default: workspace\'s saved negative)'),
      count: z.number().int().min(1).max(20).optional().describe('Number of images to queue (default 1, each with a different seed)'),
      width: z.number().int().optional().describe('Width override (default: workspace setting)'),
      height: z.number().int().optional().describe('Height override (default: workspace setting)'),
      steps: z.number().int().optional().describe('Steps override'),
      cfg: z.number().optional().describe('CFG override'),
      seed: z.number().int().optional().describe('Fixed seed (job i uses seed+i). Omit for random seeds.'),
    },
  },
  async (args) => {
    try {
      return jsonResult(await generate(args))
    } catch (e) { return errorResult(e) }
  },
)

server.registerTool(
  'get_generation_status',
  {
    description: 'Check generation progress. With prompt_ids: status of those jobs (queued position / running / done with output files / error). With only workspace: checks that workspace\'s pending records. Finished jobs are finalized in the gallery so they show as done in the app.',
    inputSchema: {
      prompt_ids: z.array(z.string()).optional().describe('prompt_ids returned by generate'),
      workspace: z.string().optional().describe('Workspace name or id — check its pending generations'),
    },
  },
  async (args) => {
    try {
      return jsonResult(await generationStatus(args))
    } catch (e) { return errorResult(e) }
  },
)

async function main() {
  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
