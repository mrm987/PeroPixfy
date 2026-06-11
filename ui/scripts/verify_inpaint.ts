// 인페인트 수정 검증: 소스 + 원형 마스크 업로드 → builder inpaint 그래프 실행 →
// 결과가 "마스크 안만 크게 변하고 밖은 원본 유지"인지 영역별 diff로 확인.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildGraph } from '../src/workflow/builder'
import { ANIMA_DEFAULTS } from '../src/workflow/defaults'
import { COMFY, submit, waitOutputs } from './verify_lib'

const PORTABLE = 'W:\\ComfyUI_windows_portable_nvidia_cu121_or_cpu\\ComfyUI_windows_portable'
const OUTPUT_DIR = path.join(PORTABLE, 'ComfyUI', 'output')
const PYTHON = path.join(PORTABLE, 'python_embeded', 'python.exe')
const SCRIPTS = path.resolve(import.meta.dirname, '..', '..', 'scripts')

// 소스: M1 검증 산출물 (832x1216)
const verifyDir = path.join(OUTPUT_DIR, 'PeroPix', 'verify')
const srcFile = fs.readdirSync(verifyDir).find((f) => f.startsWith('m1_ref'))
if (!srcFile) throw new Error('verify:m1 산출물이 필요합니다')
const srcPath = path.join(verifyDir, srcFile)

// 마스크 생성 (중앙 원형)
const maskPath = path.join(os.tmpdir(), 'peropix_test_mask.png')
execFileSync(PYTHON, [path.join(SCRIPTS, 'make_test_mask.py'), '832', '1216', maskPath])

async function upload(filePath: string, name: string): Promise<string> {
  const form = new FormData()
  form.append('image', new Blob([fs.readFileSync(filePath)], { type: 'image/png' }), name)
  form.append('overwrite', 'true')
  const res = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`/upload/image ${res.status}`)
  const d = await res.json()
  return d.subfolder ? `${d.subfolder}/${d.name}` : d.name
}

const sourceImage = await upload(srcPath, 'verify_inpaint_src.png')
const maskImage = await upload(maskPath, 'verify_inpaint_mask.png')
console.log('업로드:', sourceImage, '/', maskImage)

const imgs = await waitOutputs(await submit(
  buildGraph({
    ...ANIMA_DEFAULTS,
    mode: 'inpaint',
    sourceImage,
    maskImage,
    positive: '1girl, smile',
    negative: 'worst quality',
    seed: 42,
    steps: 20,
    denoise: 0.7,
    filenamePrefix: 'PeroPix/verify/inpaint_fix',
  }),
  'verify-inpaint',
))
const resultPath = path.join(OUTPUT_DIR, imgs[0].subfolder, imgs[0].filename)
console.log('결과:', imgs[0].filename)

const out = execFileSync(PYTHON, [path.join(SCRIPTS, 'inpaint_region_check.py'), srcPath, resultPath, maskPath], { encoding: 'utf8' })
console.log(out.trim())
