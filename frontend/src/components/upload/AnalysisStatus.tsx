/** Processing indicator and error / no-floor states shown over the stage. */
import { useEffect, useState } from 'react'
import { useRoomStore } from '../../store/roomStore'
import { startCalibration } from '../../lib/actions'

const STEPS = [
  { at: 0, label: 'Uploading photo' },
  { at: 600, label: 'Segmenting the room (walls, floor, furniture)' },
  { at: 2600, label: 'Estimating depth' },
  { at: 4600, label: 'Fitting the floor plane' },
]

export function AnalysisProgress() {
  const status = useRoomStore((s) => s.status)
  const startedAt = useRoomStore((s) => s.analyzeStartedAt)
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (status !== 'analyzing' && status !== 'preparing') return
    const id = setInterval(() => setNow(performance.now()), 200)
    return () => clearInterval(id)
  }, [status])

  if (status !== 'analyzing' && status !== 'preparing') return null
  const elapsed = status === 'preparing' ? 0 : now - startedAt
  const current = status === 'preparing' ? -1 : STEPS.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0)

  return (
    <div className="analysis-overlay" role="status" aria-live="polite">
      <div className="analysis-card">
        <div className="spinner" />
        <h3>{status === 'preparing' ? 'Preparing image…' : 'Analyzing your room…'}</h3>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.label} className={i < current ? 'done' : i === current ? 'active' : ''}>
              {s.label}
            </li>
          ))}
        </ol>
        <p className="muted small">Usually takes 3–8 seconds.</p>
      </div>
    </div>
  )
}

export function AnalysisError() {
  const error = useRoomStore((s) => s.error)
  const status = useRoomStore((s) => s.status)
  const retry = useRoomStore((s) => s.retry)
  const changeRoom = useRoomStore((s) => s.changeRoom)
  const hasImage = useRoomStore((s) => !!s.image)
  if (status !== 'error' || !error) return null
  return (
    <div className="analysis-overlay">
      <div className="analysis-card error" role="alert">
        <h3>{error.title}</h3>
        <p>{error.message}</p>
        <div className="row gap">
          {error.retryable && hasImage && (
            <button className="btn primary" onClick={() => retry()}>
              Try again
            </button>
          )}
          <button className="btn" onClick={changeRoom}>
            Choose another photo
          </button>
        </div>
      </div>
    </div>
  )
}

/** Shown when analysis finished but no floor was confidently found. */
export function NoFloorBanner() {
  const analysis = useRoomStore((s) => s.analysis)
  const calibration = useRoomStore((s) => s.calibration)
  const changeRoom = useRoomStore((s) => s.changeRoom)
  if (!analysis || analysis.floor.detected || calibration) return null
  return (
    <div className="banner warn" role="alert">
      <div>
        <strong>Unable to confidently detect the floor.</strong> Please try another room image, or mark the floor yourself.
      </div>
      <div className="row gap">
        <button className="btn small primary" onClick={startCalibration}>
          Mark floor manually
        </button>
        <button className="btn small" onClick={changeRoom}>
          Another photo
        </button>
      </div>
    </div>
  )
}
