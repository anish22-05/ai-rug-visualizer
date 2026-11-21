/**
 * Floor-detection debug visualisation (requirement §5):
 * mask tint, floor polygon, other detected regions, line segments, vanishing point,
 * horizon, and a projected 50 cm floor grid. If the grid lines up with the floor
 * planks or tiles, the homography is right.
 */
import { useMemo } from 'react'
import type { Mat3, RoomAnalysis } from '../../types'
import type { DebugLayers } from '../../store/uiStore'
import { projectiveW, applyH } from '../../lib/geometry/homography'

const SEGMENT_COLORS: Record<string, string> = {
  wall: '#4da3ff',
  ceiling: '#b48cff',
  door: '#ff9f43',
  window: '#3ee6e6',
  furniture: '#ff5c7a',
}

interface Props {
  analysis: RoomAnalysis
  H: Mat3 | null
  width: number
  height: number
  layers: DebugLayers
  k: number
}

function floorGrid(H: Mat3, width: number, height: number, spacing = 50): string {
  const segs: string[] = []
  const range = 30
  const lim = 4 * Math.max(width, height)
  const line = (fn: (t: number) => { x: number; y: number }) => {
    let d = ''
    let pen = false
    for (let i = 0; i <= 120; i++) {
      const t = -range * spacing + (i / 120) * 2 * range * spacing
      const f = fn(t)
      const ok = projectiveW(H, f) > 1e-6
      const p = applyH(H, f)
      if (ok && Math.abs(p.x) < lim && Math.abs(p.y) < lim) {
        d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
        pen = true
      } else pen = false
    }
    if (d) segs.push(d)
  }
  for (let k = -range; k <= range; k++) {
    const c = k * spacing
    line((t) => ({ x: c, y: t }))
    line((t) => ({ x: t, y: c }))
  }
  return segs.join(' ')
}

export function DebugOverlay({ analysis, H, width, height, layers, k }: Props) {
  const polygon = analysis.floor.polygon.map(([x, y]) => `${x},${y}`).join(' ')
  const grid = useMemo(() => (H ? floorGrid(H, width, height) : ''), [H, width, height])
  const horizonY = analysis.geometry?.horizonY
  const vp = analysis.debug.vanishingPoint

  return (
    <g className="debug" pointerEvents="none">
      <defs>
        <filter id="maskTint" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 0.15  0 0 0 0 0.9  0 0 0 0 0.45  1 0 0 0 0" />
        </filter>
        <clipPath id="floorClip">
          <polygon points={polygon} />
        </clipPath>
      </defs>
      {layers.mask && (
        <image
          href={`data:image/png;base64,${analysis.floor.maskPng}`}
          x={0}
          y={0}
          width={width}
          height={height}
          preserveAspectRatio="none"
          filter="url(#maskTint)"
          opacity={0.5}
        />
      )}
      {layers.segments &&
        Object.entries(analysis.segments).flatMap(([name, polys]) =>
          polys.map((poly, i) => (
            <polygon
              key={`${name}-${i}`}
              points={poly.map(([x, y]) => `${x},${y}`).join(' ')}
              fill={SEGMENT_COLORS[name] ?? '#fff'}
              fillOpacity={0.12}
              stroke={SEGMENT_COLORS[name] ?? '#fff'}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
      {layers.grid && grid && (
        <path d={grid} clipPath={analysis.floor.detected ? 'url(#floorClip)' : undefined} stroke="#00f0ff" strokeOpacity={0.8} strokeWidth={1.2} fill="none" vectorEffect="non-scaling-stroke" />
      )}
      {layers.polygon && analysis.floor.detected && (
        <polygon points={polygon} fill="none" stroke="#ffd400" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      )}
      {layers.lines &&
        (analysis.debug.lines ?? []).map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ff8a00" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
      {layers.lines && vp && <circle cx={vp[0]} cy={vp[1]} r={7 * k} fill="#ff8a00" stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      {layers.horizon && horizonY != null && (
        <g>
          <line x1={0} y1={horizonY} x2={width} y2={horizonY} stroke="#ff3df2" strokeWidth={2} strokeDasharray="10 6" vectorEffect="non-scaling-stroke" />
          <text x={10 * k} y={horizonY - 6 * k} fontSize={12 * k} fill="#ff3df2" className="debug-text">
            horizon
          </text>
        </g>
      )}
    </g>
  )
}
