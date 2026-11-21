/** Shared domain types. */

export interface Pt {
  x: number
  y: number
}

/** 3x3 matrix, row-major, length 9. */
export type Mat3 = readonly number[]

export interface Corners<T = Pt> {
  topLeft: T
  topRight: T
  bottomRight: T
  bottomLeft: T
}

export const CORNER_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const
export type CornerKey = (typeof CORNER_KEYS)[number]

// ---------------------------------------------------------------- products

export interface SizeVariant {
  id: string
  label: string
  width: number // cm
  height: number // cm
  priceDelta: number
}

export type RugShape = 'rectangle' | 'round' | 'runner'

export interface Product {
  id: string
  name: string
  price: number
  shape: RugShape
  material: string
  description: string
  image: string // absolute URL
  thumbnail: string // absolute URL
  sizes: SizeVariant[]
}

// ---------------------------------------------------------------- scene

/**
 * A rug placed in the room.
 *
 * Position, size and rotation live on the *floor plane*, in centimetres, not in
 * pixels. The image-space quad is derived by projecting the four floor corners
 * through the floor homography, so perspective is always correct whatever the
 * rug's position, size or rotation.
 */
export interface Rug {
  id: string
  productId: string
  name: string
  sizeId: string
  x: number // floor-plane centre, cm (+x right)
  y: number // floor-plane centre, cm (+y towards the camera)
  width: number // cm
  height: number // cm
  rotation: number // degrees, clockwise on screen
  /** Manual corner-pin offsets in image pixels, added after projection (default all zero). */
  perspective: Corners
  zIndex: number
  opacity: number
}

// ---------------------------------------------------------------- analysis (API)

export interface FloorGeometry {
  homography: number[] // floor cm -> image px, row-major
  inverse: number[]
  intrinsics: { f: number; cx: number; cy: number }
  normal: number[]
  pitchDeg: number
  rollDeg: number
  cameraHeightM: number
  horizonY: number | null
  method: string
  focalSource: 'exif' | 'assumed'
}

export interface RoomAnalysis {
  analysisId: string
  imageSize: { width: number; height: number }
  workSize: { width: number; height: number }
  floor: {
    detected: boolean
    /** Cleaned floor mask (work px): polygon/placement/lighting/debug. Small occluders are filled. */
    maskPng: string
    /** Soft occlusion alpha (work px, 255 = floor): keeps stools, legs and skirts in front of rugs. */
    occlusionPng: string
    polygon: number[][]
    confidence: number
    areaRatio: number
    message?: string
  }
  segments: Record<string, number[][][]>
  /** Light on the floor; null when no floor was detected. */
  lighting: {
    /** 8-bit floor shading map (low-res, image aspect): value / 255 · shadingScale = shading factor. */
    shadingPng: string
    shadingScale: number
    /** Scene light colour, linear RGB, mean 1. */
    illuminant: [number, number, number]
  } | null
  geometry: FloorGeometry | null
  placement: { x: number; y: number; radiusCm: number } | null
  debug: { inlierRatio?: number | null; vanishingPoint?: number[] | null; lines?: number[][] }
  timingsMs: Record<string, number>
}
