// 첫 설치 부트스트랩 API — 필요한 모델 누락 감지 + 다운로드(진행률 폴링).

export interface SetupProgress {
  status?: 'idle' | 'downloading' | 'done' | 'error'
  received?: number
  total?: number
  error?: string | null
}
export interface SetupAsset {
  key: string
  label: string
  required: boolean
  folder: string
  filename: string
  exact: boolean // 추천 파일 그 자체가 설치됨
  present: boolean // 충족(추천 파일이 있거나, 그 종류 폴더에 다른 모델이라도 있음)
  progress: SetupProgress
}

export async function fetchSetupStatus(): Promise<SetupAsset[]> {
  const res = await fetch('/peropix/api/setup/status')
  return (await res.json()).assets ?? []
}

export async function startSetupDownload(keys?: string[]): Promise<boolean> {
  const res = await fetch('/peropix/api/setup/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: keys ?? null }),
  })
  return (await res.json()).started
}
