// 날짜 prefix 수정 검증: 앱과 동일한 빌더 경로로 4스텝 생성 → 저장 성공 확인
import { buildGraph } from '../src/workflow/builder'
import { ANIMA_DEFAULTS, defaultFilenamePrefix } from '../src/workflow/defaults'
import { submit, waitOutputs } from './verify_lib'

const g = buildGraph({
  ...ANIMA_DEFAULTS,
  positive: '1girl',
  negative: 'worst quality',
  seed: 7,
  steps: 4,
  filenamePrefix: defaultFilenamePrefix('t2i'),
})
console.log('prefix:', (g['save'].inputs as Record<string, unknown>)['filename_prefix'])
const imgs = await waitOutputs(await submit(g, 'prefix-test'))
console.log('SAVED:', imgs[0].subfolder + '/' + imgs[0].filename)
