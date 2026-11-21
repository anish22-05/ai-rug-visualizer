/** Room analysis info, render settings, debug layers and floor calibration. */
import { useRoomStore } from '../../store/roomStore'
import { useUIStore, type DebugLayers, type RenderOptions } from '../../store/uiStore'
import { applyCalibration, cancelCalibration, startCalibration } from '../../lib/actions'
import { useShallow } from 'zustand/react/shallow'

const METHOD_LABEL: Record<string, string> = {
  'depth-plane': 'Depth plane fit (RANSAC)',
  'depth-plane-rescaled': 'Depth plane fit (scale reset)',
  'vanishing-point': 'Vanishing point',
  heuristic: 'Heuristic fallback',
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function RoomPanel() {
  const { analysis, calibration, setCalibration } = useRoomStore(
    useShallow((s) => ({ analysis: s.analysis, calibration: s.calibration, setCalibration: s.setCalibration })),
  )
  const ui = useUIStore(
    useShallow((s) => ({
      debug: s.debug,
      toggleDebug: s.toggleDebug,
      layers: s.debugLayers,
      setLayer: s.setDebugLayer,
      render: s.render,
      setRender: s.setRender,
      mode: s.mode,
      calibSize: s.calibSize,
      setCalibSize: s.setCalibSize,
    })),
  )
  if (!analysis) return null
  const geo = analysis.geometry

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Room</h2>
        <Toggle label="Debug view" checked={ui.debug} onChange={ui.toggleDebug} />
      </header>

      <div className="render-toggles">
        {(
          [
            ['shadows', 'Soft shadows'],
            ['lighting', 'Match lighting'],
            ['occlusion', 'Furniture occlusion'],
          ] as [keyof RenderOptions, string][]
        ).map(([k, label]) => (
          <Toggle key={k} label={label} checked={ui.render[k]} onChange={(v) => ui.setRender(k, v)} />
        ))}
      </div>

      {ui.debug && (
        <>
          <dl className="stats">
            <dt>Floor</dt>
            <dd>
              {analysis.floor.detected ? 'detected' : 'not detected'} · {(analysis.floor.confidence * 100).toFixed(0)}% conf ·{' '}
              {(analysis.floor.areaRatio * 100).toFixed(0)}% of image
            </dd>
            <dt>Orientation</dt>
            <dd>{calibration ? 'Manual calibration' : geo ? METHOD_LABEL[geo.method] ?? geo.method : '—'}</dd>
            {geo && !calibration && (
              <>
                <dt>Camera</dt>
                <dd>
                  pitch {geo.pitchDeg.toFixed(1)}° · roll {geo.rollDeg.toFixed(1)}° · height {geo.cameraHeightM.toFixed(2)} m
                </dd>
                <dt>Focal</dt>
                <dd>
                  {geo.intrinsics.f.toFixed(0)} px ({geo.focalSource})
                </dd>
              </>
            )}
            <dt>Timing</dt>
            <dd>
              {analysis.timingsMs.total} ms (seg {analysis.timingsMs.segmentation}, depth {analysis.timingsMs.depth ?? '—'})
            </dd>
          </dl>
          <div className="debug-layers">
            {(
              [
                ['mask', 'Floor mask'],
                ['polygon', 'Floor polygon'],
                ['grid', '50 cm floor grid'],
                ['horizon', 'Horizon'],
                ['lines', 'Lines + vanishing pt'],
                ['segments', 'Walls / doors / furniture'],
              ] as [keyof DebugLayers, string][]
            ).map(([k, label]) => (
              <Toggle key={k} label={label} checked={ui.layers[k]} onChange={(v) => ui.setLayer(k, v)} />
            ))}
          </div>
        </>
      )}

      <div className="calibrate">
        {ui.mode === 'calibrate' ? (
          <>
            <p className="small">
              Drag the 4 points onto the corners of a square on the floor (tiles, a known rug, a taped square…).
            </p>
            <label className="field inline">
              <span>Square size</span>
              <span className="input-wrap">
                <input type="number" min={20} max={1000} value={ui.calibSize} onChange={(e) => ui.setCalibSize(Number(e.target.value))} />
                <em>cm</em>
              </span>
            </label>
            <div className="row gap">
              <button className="btn small primary" onClick={applyCalibration}>
                Apply
              </button>
              <button className="btn small" onClick={cancelCalibration}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="row gap wrap">
            <button className="btn small" onClick={startCalibration} title="Correct the floor perspective by hand">
              Calibrate floor
            </button>
            {calibration && geo && (
              <button className="btn small" onClick={() => setCalibration(null)}>
                Use detected floor
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
