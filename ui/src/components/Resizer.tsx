import type { PointerEvent as RPointerEvent } from 'react'
import { useT } from '../i18n'

/**
 * 패널 사이의 세로 분할 핸들. 드래그하면 onChange로 새 너비(px)를 알린다.
 *  - dir=1  : 오른쪽으로 끌면 value 증가 (좌측 패널의 우측 핸들)
 *  - dir=-1 : 왼쪽으로 끌면 value 증가 (우측 도크의 좌측 핸들)
 */
export function Resizer({
  value,
  onChange,
  dir,
  min = 280,
  max = 820,
}: {
  value: number
  onChange: (w: number) => void
  dir: 1 | -1
  min?: number
  max?: number
}) {
  const t = useT()
  const onPointerDown = (e: RPointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = value
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(max, Math.max(min, startW + dir * (ev.clientX - startX)))
      onChange(w)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className="resizer"
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      title={t('Drag to resize')}
    />
  )
}
