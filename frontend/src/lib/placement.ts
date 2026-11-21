/**
 * Where (and how big) a newly added rug goes.
 *
 * Uses the backend's auto-placement suggestion (centre of the largest open floor
 * area, found with a distance transform in floor space) and picks the biggest
 * catalogue size that fits there. Rugs added later are staggered so they don't
 * land exactly on top of each other.
 */
import type { Mat3, Product, Pt, Rug, SizeVariant } from '../types'
import { applyH, pointInPolygon, polygonCentroid } from './geometry/homography'
import { isProjectable } from './geometry/rugGeometry'

export interface PlacementInput {
  product: Product
  sizeId?: string
  H: Mat3
  Hinv: Mat3
  floorPolygon: Pt[]
  suggestion: { x: number; y: number; radiusCm: number } | null
  existing: Rug[]
  /** Explicit drop position in image px (drag & drop). */
  dropAt?: Pt
}

export interface Placement {
  size: SizeVariant
  x: number
  y: number
  rotation: number
}

function pickSize(product: Product, radiusCm: number | null, sizeId?: string): SizeVariant {
  if (sizeId) {
    const s = product.sizes.find((v) => v.id === sizeId)
    if (s) return s
  }
  const byArea = [...product.sizes].sort((a, b) => a.width * a.height - b.width * b.height)
  const fallback = product.sizes.find((s) => s.priceDelta === 0) ?? byArea[0]
  if (!radiusCm) return fallback
  // Largest size whose half-diagonal roughly fits in the open circle.
  const fits = byArea.filter((s) => Math.hypot(s.width, s.height) / 2 <= radiusCm * 1.25)
  return fits.length ? fits[fits.length - 1] : byArea[0]
}

export function computePlacement(input: PlacementInput): Placement {
  const { product, H, Hinv, floorPolygon, suggestion, existing, dropAt } = input
  const size = pickSize(product, dropAt ? null : (suggestion?.radiusCm ?? null), input.sizeId)
  // Long side parallel to the camera's image plane looks natural in most rooms.
  const rotation = product.shape === 'round' || size.width >= size.height ? 0 : 90

  let center: Pt
  if (dropAt && pointInPolygon(dropAt, floorPolygon)) {
    center = applyH(Hinv, dropAt)
  } else if (suggestion) {
    center = { x: suggestion.x, y: suggestion.y }
  } else {
    center = applyH(Hinv, polygonCentroid(floorPolygon))
  }

  if (!dropAt && existing.length) {
    // Stagger: walk around the start point until we're away from existing rugs.
    const step = 45
    for (let i = 1; i <= 12; i++) {
      const crowded = existing.some((r) => Math.hypot(r.x - center.x, r.y - center.y) < 30)
      if (!crowded) break
      const angle = (i * 137.5 * Math.PI) / 180
      const candidate = { x: center.x + Math.cos(angle) * step * Math.sqrt(i), y: center.y + Math.sin(angle) * step * Math.sqrt(i) }
      if (pointInPolygon(applyH(H, candidate), floorPolygon)) center = candidate
    }
  }

  const pose = { x: center.x, y: center.y, width: size.width, height: size.height, rotation }
  if (!isProjectable(pose, H)) {
    const c = applyH(Hinv, polygonCentroid(floorPolygon))
    return { size, x: c.x, y: c.y, rotation }
  }
  return { size, ...center, rotation }
}
