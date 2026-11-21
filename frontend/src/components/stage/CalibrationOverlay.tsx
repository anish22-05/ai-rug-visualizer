/** Four draggable points the user aligns with a known square on the floor. */
import type { Pt } from '../../types'
import { useUIStore } from '../../store/uiStore'
import { isConvexQuad } from '../../lib/geometry/homography'

const LABELS = ['far left', 'far right', 'near right', 'near left']

export function CalibrationOverlay({ k, toImage }: { k: number; toImage: (e: { clientX: number; clientY: number }) => Pt }) {
  const draft = useUIStore((s) => s.calibDraft)
  if (!draft) return null
  const convex = isConvexQuad(draft)

  const startDrag = (e: React.PointerEvent, index: number) => {
    e.stopPropagation()
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const current = useUIStore.getState().calibDraft
      if (!current) return
      const next = [...current]
      next[index] = toImage(ev)
      useUIStore.getState().setCalibDraft(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <g>
      <polygon points={draft.map((p) => `${p.x},${p.y}`).join(' ')} className={convex ? 'calib-quad' : 'calib-quad invalid'} />
      {draft.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={10 * k} className="handle calib" onPointerDown={(e) => startDrag(e, i)} />
          <text x={p.x + 14 * k} y={p.y - 10 * k} fontSize={12 * k} className="calib-label">
            {LABELS[i]}
          </text>
        </g>
      ))}
    </g>
  )
}
