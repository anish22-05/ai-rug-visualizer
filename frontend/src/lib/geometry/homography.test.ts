import { describe, expect, it } from 'vitest'
import type { Mat3, Rug } from '../../types'
import { applyH, invert, isConvexQuad, multiply, normalize, pointInPolygon, projectiveW, solveHomography } from './homography'
import { floorCorners, imageCorners, imageToTexture, isProjectable, textureToImage, ZERO_CORNERS } from './rugGeometry'

// A realistic floor homography (camera pitched down ~20°), floor cm -> image px.
const H: Mat3 = [1.6, 0.2, 800, 0, 0.55, 700, 0, -0.0004, 1]

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('homography', () => {
  it('inverts', () => {
    const I = normalize(multiply(H, invert(H))) // homographies are defined up to scale
    ;[1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => close(I[i], v))
  })

  it('round-trips points through H and H⁻¹', () => {
    const Hi = invert(H)
    for (const p of [{ x: 0, y: 0 }, { x: -150, y: 220 }, { x: 300, y: -400 }]) {
      const back = applyH(Hi, applyH(H, p))
      close(back.x, p.x, 1e-6)
      close(back.y, p.y, 1e-6)
    }
  })

  it('solves the 4-point homography exactly', () => {
    const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    const dst = src.map((p) => applyH(H, { x: p.x * 200 - 100, y: p.y * 200 - 100 }))
    const S = solveHomography(src, dst)
    src.forEach((p, i) => {
      const q = applyH(S, p)
      close(q.x, dst[i].x, 1e-6)
      close(q.y, dst[i].y, 1e-6)
    })
    // An interior point also matches (true projective map, not just the corners).
    const mid = applyH(S, { x: 0.25, y: 0.75 })
    const truth = applyH(H, { x: -50, y: 50 })
    close(mid.x, truth.x, 1e-6)
    close(mid.y, truth.y, 1e-6)
  })

  it('rejects degenerate configurations', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]
    expect(() => solveHomography(pts, pts)).toThrow()
  })

  it('point in polygon / convexity', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false)
    expect(isConvexQuad(sq)).toBe(true)
    expect(isConvexQuad([sq[0], sq[2], sq[1], sq[3]])).toBe(false)
  })
})

describe('rug geometry', () => {
  const rug: Rug = {
    id: 'r', productId: 'p', name: 'n', sizeId: 'm', x: 20, y: -40, width: 160, height: 230,
    rotation: 30, perspective: ZERO_CORNERS, zIndex: 0, opacity: 1,
  }

  it('keeps real dimensions in floor space under rotation', () => {
    const [tl, tr, br] = floorCorners(rug)
    close(Math.hypot(tr.x - tl.x, tr.y - tl.y), 160)
    close(Math.hypot(br.x - tr.x, br.y - tr.y), 230)
  })

  it('projects corners through H and applies corner-pin offsets', () => {
    const base = imageCorners(rug, H)
    const pinned = imageCorners({ ...rug, perspective: { ...ZERO_CORNERS, topLeft: { x: 5, y: -3 } } }, H)
    close(pinned.topLeft.x - base.topLeft.x, 5)
    close(pinned.topLeft.y - base.topLeft.y, -3)
    close(pinned.bottomRight.x, base.bottomRight.x)
  })

  it('texture homography maps the unit square to the image quad', () => {
    const corners = imageCorners(rug, H)
    const T = textureToImage(corners)
    const c = applyH(T, { x: 1, y: 1 })
    close(c.x, corners.bottomRight.x, 1e-6)
    close(c.y, corners.bottomRight.y, 1e-6)
  })

  it('perspective: the far edge of a rug is drawn shorter than the near edge', () => {
    const flat = { ...rug, rotation: 0 }
    const q = imageCorners(flat, H)
    expect(q.topRight.x - q.topLeft.x).toBeLessThan(q.bottomRight.x - q.bottomLeft.x)
  })

  it('detects rugs behind the camera', () => {
    expect(isProjectable(rug, H)).toBe(true)
    expect(isProjectable({ ...rug, y: 5000 }, H)).toBe(false)
  })

  it('orients the inverse texture homography so w > 0 over the rug (regression)', () => {
    // A realistic quad below the horizon: the image origin (0,0) is above the horizon,
    // so a naively normalised inverse has w < 0 over the whole rug and the shader
    // discarded every pixel. imageToTexture must flip the sign.
    const quad = {
      topLeft: { x: 540, y: 600 },
      topRight: { x: 940, y: 600 },
      bottomRight: { x: 1100, y: 700 },
      bottomLeft: { x: 430, y: 700 },
    }
    const naive = invert(textureToImage(quad))
    expect(projectiveW(naive, { x: 760, y: 650 })).toBeLessThan(0) // the bug condition
    const inv = imageToTexture(quad)
    for (const p of [{ x: 760, y: 650 }, quad.topLeft, quad.bottomRight]) expect(projectiveW(inv, p)).toBeGreaterThan(0)
    const uv = applyH(inv, quad.bottomRight)
    close(uv.x, 1, 1e-6)
    close(uv.y, 1, 1e-6)
  })
})
