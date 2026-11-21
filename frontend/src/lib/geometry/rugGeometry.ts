/** Rug geometry: floor-space rectangle -> image-space quad. */
import type { Corners, Mat3, Pt, Rug } from '../../types'
import { CORNER_KEYS } from '../../types'
import { add, applyH, arrayToCorners, cornersToArray, invert, projectiveW, rotate, solveHomography } from './homography'

export const MIN_RUG_CM = 30
export const MAX_RUG_CM = 1200

export const ZERO_CORNERS: Corners = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 0, y: 0 },
  bottomRight: { x: 0, y: 0 },
  bottomLeft: { x: 0, y: 0 },
}

/** Rug corners in its own local frame (cm), before rotation. Top = far edge. */
export function localCorners(width: number, height: number): Pt[] {
  const w = width / 2
  const h = height / 2
  return [
    { x: -w, y: -h },
    { x: w, y: -h },
    { x: w, y: h },
    { x: -w, y: h },
  ]
}

type RugPose = Pick<Rug, 'x' | 'y' | 'width' | 'height' | 'rotation'>

/** Floor-plane corners (cm): rotate the local rectangle, then translate to the centre. */
export function floorCorners(rug: RugPose): Pt[] {
  const c = { x: rug.x, y: rug.y }
  return localCorners(rug.width, rug.height).map((p) => add(rotate(p, rug.rotation), c))
}

/** Image-space quad: project floor corners with H, then add manual corner-pin offsets. */
export function imageCorners(rug: RugPose & Pick<Rug, 'perspective'>, H: Mat3): Corners {
  const projected = floorCorners(rug).map((p) => applyH(H, p))
  return arrayToCorners(projected.map((p, i) => add(p, rug.perspective[CORNER_KEYS[i]])))
}

/** All four corners in front of the camera (w > 0)? Otherwise the projection is invalid. */
export function isProjectable(rug: RugPose, H: Mat3): boolean {
  return floorCorners(rug).every((p) => projectiveW(H, p) > 1e-9)
}

/** Homography mapping the rug texture's unit square (u,v ∈ [0,1]) onto the image quad. */
export function textureToImage(corners: Corners): Mat3 {
  const unit = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]
  return solveHomography(unit, cornersToArray(corners))
}

/**
 * Inverse of textureToImage (image px -> texture uv), sign-oriented so that the
 * projective w is positive over the quad.
 *
 * A homography is only defined up to scale, and that includes the sign. invert()
 * normalises h33 = 1, which makes w > 0 at the image origin (top-left). If the
 * horizon lies between the origin and the rug, w would be negative over the
 * rug, and a "w <= 0 means behind the horizon" test would discard every rug pixel.
 */
export function imageToTexture(corners: Corners): Mat3 {
  const inv = invert(textureToImage(corners))
  const pts = cornersToArray(corners)
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 }
  return projectiveW(inv, c) < 0 ? inv.map((v) => -v) : inv
}

/** Expand a floor-space rectangle by a margin (cm), used for the soft shadow. */
export function expandedPose(rug: RugPose, marginCm: number, offset: Pt = { x: 0, y: 0 }): RugPose {
  return {
    ...rug,
    x: rug.x + offset.x,
    y: rug.y + offset.y,
    width: rug.width + 2 * marginCm,
    height: rug.height + 2 * marginCm,
  }
}

export function clampSize(v: number): number {
  return Math.min(MAX_RUG_CM, Math.max(MIN_RUG_CM, v))
}
