// M7 검증:
//  1) settings GET/POST 라운드트립
//  2) spectrum 토글 그래프 실행 성공 + 일반 대비 속도 비교
// (시드를 달리해 ComfyUI 캐시 재사용을 방지 — 순수 샘플링 시간 비교)
//
// 실행: ComfyUI 린 프로파일이 8188에 떠 있는 상태에서 `npm run verify:m7`

import { buildGraph } from '../src/workflow/builder'
import { ANIMA_DEFAULTS } from '../src/workflow/defaults'
import { NEGATIVE, POSITIVE } from './fixtures'
import { COMFY, submit, waitOutputs } from './verify_lib'

// 1) settings 라운드트립
const before = await (await fetch(`${COMFY}/peropix/api/settings`)).json()
await fetch(`${COMFY}/peropix/api/settings`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...before, steps: 30 }),
})
const after = await (await fetch(`${COMFY}/peropix/api/settings`)).json()
console.log('[1/2] settings roundtrip:', after.steps === 30 ? 'OK' : 'FAIL')
await fetch(`${COMFY}/peropix/api/settings`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(before),
})

// 2) spectrum 속도 비교
const base = { ...ANIMA_DEFAULTS, positive: POSITIVE, negative: NEGATIVE }

async function timedRun(label: string, seed: number, spectrum: boolean): Promise<number> {
  const t0 = Date.now()
  await waitOutputs(await submit(
    buildGraph({ ...base, seed, spectrum: { enabled: spectrum }, filenamePrefix: `PeroPix/verify/m7_${label}` }),
    'verify-m7',
  ))
  const sec = (Date.now() - t0) / 1000
  console.log(`      ${label}: ${sec.toFixed(1)}s`)
  return sec
}

console.log('[2/2] 속도 비교 (30 steps)...')
await timedRun('warmup(모델로딩포함)', 111, false)
const plain = await timedRun('plain', 222, false)
const spectrum = await timedRun('spectrum', 333, true)
console.log(`RESULT: spectrum ${(plain / spectrum).toFixed(2)}x faster (${plain.toFixed(1)}s → ${spectrum.toFixed(1)}s)`)
