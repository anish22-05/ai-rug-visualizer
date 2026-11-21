import { useUIStore } from '../../store/uiStore'
import { useRoomStore } from '../../store/roomStore'
import { Icon } from '../ui/Icon'

export function ZoomControls() {
  const zoom = useUIStore((s) => s.zoom)
  const center = useUIStore((s) => s.center)
  const setView = useUIStore((s) => s.setView)
  const resetView = useUIStore((s) => s.resetView)
  const ready = useRoomStore((s) => s.status === 'ready')
  if (!ready) return null
  return (
    <div className="zoom-controls">
      <button className="icon-btn" onClick={() => setView(zoom / 1.25, center)} disabled={zoom <= 1} aria-label="Zoom out">
        <Icon name="minus" size={16} />
      </button>
      <span className="small">{Math.round(zoom * 100)}%</span>
      <button className="icon-btn" onClick={() => setView(zoom * 1.25, center)} disabled={zoom >= 8} aria-label="Zoom in">
        <Icon name="plus" size={16} />
      </button>
      <button className="icon-btn" onClick={resetView} disabled={zoom === 1} aria-label="Fit to screen" title="Fit">
        <Icon name="fit" size={16} />
      </button>
    </div>
  )
}
