/**
 * Projective geometry helpers.
 *
 * A homography H (3x3) maps a point on one plane to another plane:
 *   [x', y', w']ᵀ = H · [x, y, 1]ᵀ,   result = (x'/w', y'/w')
 * We use it for:
 *   - floor plane (cm) <-> image pixels (computed by the backend, or by calibration)
 *   - rug texture (unit square) -> image pixels (for rendering)
 */
import type { Corners, Mat3, Pt } from '../../types'

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function applyH(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  }
}

/** The projective w of a point; > 0 means it is in front of the camera / valid. */
export function projectiveW(H: Mat3, p: Pt): number {
  return H[6] * p.x + H[7] * p.y + H[8]
}

export function multiply(A: Mat3, B: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]
  return out
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is not invertible')
  const inv = [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ].map((v) => v / det)
  return normalize(inv)
}

export function normalize(m: Mat3): Mat3 {
  const s = Math.abs(m[8]) > 1e-12 ? m[8] : 1
  return m.map((v) => v / s)
}

/** Scale the *output* space of H (e.g. image px -> export px). */
export function scaleOutput(H: Mat3, s: number): Mat3 {
  return multiply([s, 0, 0, 0, s, 0, 0, 0, 1], H)
}

/**
 * Solve the homography mapping 4 source points to 4 destination points (DLT with
 * h33 = 1). Builds the 8x8 linear system and solves it with Gaussian elimination.
 */
export function solveHomography(src: Pt[], dst: Pt[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) throw new Error('Need exactly 4 point pairs')
  const A: number[][] = []
  const bvec: number[] = []
  for (let k = 0; k < 4; k++) {
    const { x, y } = src[k]
    const { x: u, y: v } = dst[k]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    bvec.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    bvec.push(v)
  }
  const h = solveLinear(A, bvec)
  return [...h, 1]
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('Degenerate point configuration')
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col] / M[col][col]
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

// ------------------------------------------------------------------ 2-D helpers

export const deg2rad = (d: number) => (d * Math.PI) / 180
export const rad2deg = (r: number) => (r * 180) / Math.PI

export function rotate(p: Pt, deg: number): Pt {
  const r = deg2rad(deg)
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
export const len = (p: Pt) => Math.hypot(p.x, p.y)

export function cornersToArray<T>(c: Corners<T>): T[] {
  return [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft]
}

export function arrayToCorners<T>(a: T[]): Corners<T> {
  return { topLeft: a[0], topRight: a[1], bottomRight: a[2], bottomLeft: a[3] }
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function polygonCentroid(poly: Pt[]): Pt {
  const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 })
  return { x: s.x / poly.length, y: s.y / poly.length }
}

/** True if the quad is convex and not self-intersecting (all cross products share a sign). */
export function isConvexQuad(q: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = q[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) return false
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}
