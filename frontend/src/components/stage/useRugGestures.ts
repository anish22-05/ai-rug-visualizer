/**
 * Pointer gestures for rugs. Every gesture is computed on the *floor plane*:
 * pointer positions are mapped image px -> floor cm with H⁻¹, the rug pose is
 * updated in floor space, and the renderer re-projects it. That is why moving a rug
 * "into" the room shrinks it correctly and rotating never breaks perspective.
 *
 * Mouse, pen and touch share one code path (Pointer Events). Two touch pointers
 * on a rug = pinch (scale) + twist (rotate).
 */
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { CornerKey, Mat3, Pt, Rug } from '../../types'
import { CORNER_KEYS } from '../../types'
import { applyH, isConvexQuad, len, pointInPolygon, rad2deg, rotate, sub } from '../../lib/geometry/homography'
import { clampSize, floorCorners, isProjectable, MAX_RUG_CM, MIN_RUG_CM } from '../../lib/geometry/rugGeometry'
import { useSceneStore } from '../../store/sceneStore'

type Gesture =
  | { kind: 'move'; rugId: string; grabOffset: Pt }
  | { kind: 'resize'; rugId: string; start: Rug; startLocal: Pt }
  | { kind: 'rotate'; rugId: string; start: Rug; startAngle: number }
  | { kind: 'pinch'; rugId: string; start: Rug; a0: Pt; b0: Pt }
  | { kind: 'corner'; rugId: string; corner: CornerKey }

interface Env {
  H: Mat3
  Hinv: Mat3
  floorPolygon: Pt[]
  toImage: (e: { clientX: number; clientY: number }) => Pt
}

const normAngle = (d: number) => ((d % 360) + 360) % 360

export function useRugGestures(env: Env) {
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Pt>()) // pointerId -> floor point
  const envRef = useRef(env)
  useLayoutEffect(() => {
    envRef.current = env
  })

  const toFloor = useCallback((e: { clientX: number; clientY: number }) => {
    const { toImage, Hinv } = envRef.current
    return applyH(Hinv, toImage(e))
  }, [])

  const getRug = (id: string) => useSceneStore.getState().rugs.find((r) => r.id === id)

  /** Accept a new pose only if the rug stays on the floor and in front of the camera. */
  const isValidPose = (pose: Pick<Rug, 'x' | 'y' | 'width' | 'height' | 'rotation'>) => {
    const { H, floorPolygon } = envRef.current
    return isProjectable(pose, H) && pointInPolygon(applyH(H, pose), floorPolygon)
  }

  const start = (e: React.PointerEvent, g: Gesture) => {
    // Capture on the <svg> root so moves keep arriving even when the pointer leaves the rug.
    const target = e.currentTarget as SVGElement
    ;(target.ownerSVGElement ?? target).setPointerCapture?.(e.pointerId)
    e.stopPropagation()
    useSceneStore.getState().select(g.rugId)
    if (!gesture.current) useSceneStore.getState().beginGesture()
    gesture.current = g
  }

  // ------------------------------------------------------------- starters

  const onRugPointerDown = (e: React.PointerEvent, rugId: string) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const f = toFloor(e)
    pointers.current.set(e.pointerId, f)
    const rug = getRug(rugId)
    if (!rug) return

    // Second finger on the same rug -> pinch/twist.
    if (pointers.current.size === 2 && gesture.current?.rugId === rugId) {
      const [a0, b0] = [...pointers.current.values()]
      gesture.current = { kind: 'pinch', rugId, start: rug, a0, b0 }
      e.stopPropagation()
      return
    }
    start(e, { kind: 'move', rugId, grabOffset: sub(f, rug) })
  }

  const onResizePointerDown = (e: React.PointerEvent, rugId: string) => {
    const rug = getRug(rugId)
    if (!rug) return
    const f = toFloor(e)
    pointers.current.set(e.pointerId, f)
    // Remember where the handle was grabbed in the rug's local frame; scale relative to it.
    const startLocal = rotate(sub(f, rug), -rug.rotation)
    start(e, { kind: 'resize', rugId, start: rug, startLocal })
  }

  const onRotatePointerDown = (e: React.PointerEvent, rugId: string) => {
    const rug = getRug(rugId)
    if (!rug) return
    const f = toFloor(e)
    pointers.current.set(e.pointerId, f)
    const d = sub(f, rug)
    start(e, { kind: 'rotate', rugId, start: rug, startAngle: rad2deg(Math.atan2(d.y, d.x)) })
  }

  const onCornerPinPointerDown = (e: React.PointerEvent, rugId: string, corner: CornerKey) => {
    pointers.current.set(e.pointerId, toFloor(e))
    start(e, { kind: 'corner', rugId, corner })
  }

  // ------------------------------------------------------------- move / end

  const onPointerMove = (e: React.PointerEvent): boolean => {
    const g = gesture.current
    if (!g || !pointers.current.has(e.pointerId)) return false
    const f = toFloor(e)
    pointers.current.set(e.pointerId, f)
    const update = useSceneStore.getState().updateRug
    const rug = getRug(g.rugId)
    if (!rug) return true

    switch (g.kind) {
      case 'move': {
        const target = sub(f, g.grabOffset)
        // Slide along the floor boundary instead of stopping dead: try x+y, then x only, then y only.
        const candidates = [target, { x: target.x, y: rug.y }, { x: rug.x, y: target.y }]
        const ok = candidates.find((c) => isValidPose({ ...rug, ...c }))
        if (ok) update(rug.id, ok)
        break
      }
      case 'resize': {
        const local = rotate(sub(f, g.start), -g.start.rotation)
        let width: number
        let height: number
        if (e.shiftKey) {
          // Free resize (aspect unlocked).
          width = clampSize(2 * Math.abs(local.x))
          height = clampSize(2 * Math.abs(local.y))
        } else {
          // Aspect ratio locked (default): uniform scale from the centre.
          const minScale = MIN_RUG_CM / Math.min(g.start.width, g.start.height)
          const maxScale = MAX_RUG_CM / Math.max(g.start.width, g.start.height)
          const s = Math.min(maxScale, Math.max(minScale, len(local) / Math.max(1e-6, len(g.startLocal))))
          width = g.start.width * s
          height = g.start.height * s
        }
        const pose = { ...rug, width, height }
        if (isProjectable(pose, envRef.current.H)) update(rug.id, { width, height, sizeId: 'custom' })
        break
      }
      case 'rotate': {
        const d = sub(f, g.start)
        const angle = rad2deg(Math.atan2(d.y, d.x))
        let rotation = g.start.rotation + (angle - g.startAngle)
        if (e.shiftKey) rotation = Math.round(rotation / 15) * 15
        rotation = normAngle(rotation)
        if (isProjectable({ ...rug, rotation }, envRef.current.H)) update(rug.id, { rotation })
        break
      }
      case 'pinch': {
        const pts = [...pointers.current.values()]
        if (pts.length < 2) break
        const [a, b] = pts
        const v0 = sub(g.b0, g.a0)
        const v1 = sub(b, a)
        const s = len(v1) / Math.max(1e-6, len(v0))
        const dAngle = rad2deg(Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x))
        const mid0 = { x: (g.a0.x + g.b0.x) / 2, y: (g.a0.y + g.b0.y) / 2 }
        const mid1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const scale = Math.min(
          MAX_RUG_CM / Math.max(g.start.width, g.start.height),
          Math.max(MIN_RUG_CM / Math.min(g.start.width, g.start.height), s),
        )
        const pose = {
          x: g.start.x + mid1.x - mid0.x,
          y: g.start.y + mid1.y - mid0.y,
          width: g.start.width * scale,
          height: g.start.height * scale,
          rotation: normAngle(g.start.rotation + dAngle),
        }
        if (isValidPose(pose)) update(rug.id, { ...pose, sizeId: scale === 1 ? g.start.sizeId : 'custom' })
        break
      }
      case 'corner': {
        // Corner-pin: offset = pointer - automatically projected corner.
        const { H, toImage } = envRef.current
        const idx = CORNER_KEYS.indexOf(g.corner)
        const projected = floorCorners(rug).map((p) => applyH(H, p))
        const p = toImage(e)
        const offset = sub(p, projected[idx])
        const perspective = { ...rug.perspective, [g.corner]: offset }
        const quad = CORNER_KEYS.map((k, i) => ({
          x: projected[i].x + perspective[k].x,
          y: projected[i].y + perspective[k].y,
        }))
        if (isConvexQuad(quad)) update(rug.id, { perspective })
        break
      }
    }
    return true
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (!gesture.current) return
    if (gesture.current.kind === 'pinch' && pointers.current.size === 1) {
      // One finger lifted: continue as a move with the remaining finger.
      const rug = getRug(gesture.current.rugId)
      const [f] = [...pointers.current.values()]
      if (rug) gesture.current = { kind: 'move', rugId: rug.id, grabOffset: sub(f, rug) }
      return
    }
    if (pointers.current.size === 0) {
      gesture.current = null
      useSceneStore.getState().endGesture()
    }
  }

  const isActive = () => gesture.current !== null

  return {
    onRugPointerDown,
    onResizePointerDown,
    onRotatePointerDown,
    onCornerPinPointerDown,
    onPointerMove,
    onPointerUp,
    isActive,
  }
}
