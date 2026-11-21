/**
 * Interactive SVG layer drawn over the WebGL canvas, in the same image-px coordinates.
 * - An invisible hit polygon per rug, in z-order, so the top-most rug wins naturally.
 * - Selection outline, 4 resize handles, a rotation handle and a size label for the active rug.
 * - Corner-pin handles in perspective-adjust mode.
 */
import type { Mat3, Pt, Rug } from '../../types'
import { CORNER_KEYS } from '../../types'
import { cornersToArray, len, polygonCentroid, sub } from '../../lib/geometry/homography'
import { imageCorners, isProjectable } from '../../lib/geometry/rugGeometry'
import type { useRugGestures } from './useRugGestures'

interface Props {
  rugs: Rug[] // sorted bottom -> top
  selectedId: string | null
  H: Mat3
  pxToImg: number // image px per CSS px (keeps handles a constant on-screen size)
  cornerPin: boolean
  gestures: ReturnType<typeof useRugGestures>
}

const toPoints = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')

export function RugOverlay({ rugs, selectedId, H, pxToImg, cornerPin, gestures }: Props) {
  const visible = rugs.filter((r) => isProjectable(r, H))
  const selected = visible.find((r) => r.id === selectedId)

  return (
    <g>
      {visible.map((rug) => (
        <polygon
          key={rug.id}
          points={toPoints(cornersToArray(imageCorners(rug, H)))}
          className="rug-hit"
          onPointerDown={(e) => gestures.onRugPointerDown(e, rug.id)}
          aria-label={rug.name}
        />
      ))}
      {selected && <Selection rug={selected} H={H} k={pxToImg} cornerPin={cornerPin} gestures={gestures} />}
    </g>
  )
}

function Selection({ rug, H, k, cornerPin, gestures }: { rug: Rug; H: Mat3; k: number; cornerPin: boolean; gestures: Props['gestures'] }) {
  const quad = cornersToArray(imageCorners(rug, H))
  const center = polygonCentroid(quad)
  const topMid = { x: (quad[0].x + quad[1].x) / 2, y: (quad[0].y + quad[1].y) / 2 }
  const out = sub(topMid, center)
  const outLen = Math.max(1e-6, len(out))
  const rotHandle = { x: topMid.x + (out.x / outLen) * 34 * k, y: topMid.y + (out.y / outLen) * 34 * k }
  const bottomMid = { x: (quad[2].x + quad[3].x) / 2, y: (quad[2].y + quad[3].y) / 2 }

  return (
    <g className="selection">
      <polygon points={toPoints(quad)} className={cornerPin ? 'sel-outline dashed' : 'sel-outline'} />
      {cornerPin ? (
        CORNER_KEYS.map((key, i) => (
          <rect
            key={key}
            x={quad[i].x - 7 * k}
            y={quad[i].y - 7 * k}
            width={14 * k}
            height={14 * k}
            className="handle pin"
            onPointerDown={(e) => gestures.onCornerPinPointerDown(e, rug.id, key)}
          >
            <title>Drag to adjust perspective</title>
          </rect>
        ))
      ) : (
        <>
          <line x1={topMid.x} y1={topMid.y} x2={rotHandle.x} y2={rotHandle.y} className="rot-stem" />
          <circle cx={rotHandle.x} cy={rotHandle.y} r={9 * k} className="handle rotate" onPointerDown={(e) => gestures.onRotatePointerDown(e, rug.id)}>
            <title>Drag to rotate (Shift snaps to 15°)</title>
          </circle>
          {quad.map((p, i) => (
            <circle
              key={CORNER_KEYS[i]}
              cx={p.x}
              cy={p.y}
              r={8 * k}
              className="handle resize"
              onPointerDown={(e) => gestures.onResizePointerDown(e, rug.id)}
            >
              <title>Drag to resize (Shift for free aspect)</title>
            </circle>
          ))}
        </>
      )}
      <text x={bottomMid.x} y={bottomMid.y + 24 * k} fontSize={13 * k} className="size-label" textAnchor="middle">
        {Math.round(rug.width)} × {Math.round(rug.height)} cm · {Math.round(rug.rotation)}°
      </text>
    </g>
  )
}
