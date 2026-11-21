/**
 * Room state: the uploaded photo, its analysis result and the effective floor homography.
 */
import { create } from 'zustand'
import type { Mat3, Pt, RoomAnalysis } from '../types'
import { analyzeRoom, ApiError } from '../lib/api'
import { invert } from '../lib/geometry/homography'
import { ImageValidationError, prepareImage, type PreparedImage, validateFile } from '../lib/imagePrep'
import type { Lighting } from '../lib/render/compositor'
import { useSceneStore } from './sceneStore'

export type RoomStatus = 'empty' | 'preparing' | 'analyzing' | 'ready' | 'error'

export interface RoomError {
  title: string
  message: string
  retryable: boolean
}

interface RoomState {
  status: RoomStatus
  image: PreparedImage | null
  analysis: RoomAnalysis | null
  /** Decoded cleaned floor mask (debug overlay). */
  mask: HTMLImageElement | null
  /** Decoded soft occlusion alpha (rugs are hidden where it is dark). */
  occlusion: HTMLImageElement | null
  /** Decoded floor shading + illuminant from the backend (null = neutral). */
  lighting: Lighting | null
  /** User-calibrated homography; overrides the detected one when set. */
  calibration: Mat3 | null
  error: RoomError | null
  analyzeStartedAt: number

  loadFile: (file: File) => Promise<void>
  loadSample: (url: string, name: string) => Promise<void>
  retry: () => Promise<void>
  changeRoom: () => void
  setCalibration: (H: Mat3 | null) => void
}

let controller: AbortController | null = null

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('mask decode failed'))
    img.src = src
  })
}

export const useRoomStore = create<RoomState>()((set, get) => {
  const fail = (title: string, message: string, retryable: boolean) =>
    set({ status: 'error', error: { title, message, retryable } })

  async function runAnalysis(image: PreparedImage) {
    controller?.abort()
    controller = new AbortController()
    set({ status: 'analyzing', analyzeStartedAt: performance.now(), error: null })
    try {
      const analysis = await analyzeRoom(image.uploadBlob, controller.signal)
      const light = analysis.lighting
      const [mask, occlusion, shading] = await Promise.all([
        loadImage(`data:image/png;base64,${analysis.floor.maskPng}`),
        loadImage(`data:image/png;base64,${analysis.floor.occlusionPng}`),
        light ? loadImage(`data:image/png;base64,${light.shadingPng}`) : Promise.resolve(null),
      ])
      const lighting: Lighting | null =
        light && shading ? { shading, scale: light.shadingScale, illuminant: light.illuminant } : null
      set({ status: 'ready', analysis, mask, occlusion, lighting, calibration: null })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (err instanceof ApiError && err.code === 'invalid_image') fail('Invalid image', err.message, false)
      else if (err instanceof ApiError && err.code === 'image_too_large') fail('Image too large', err.message, false)
      else
        fail(
          'Analysis failed',
          err instanceof ApiError ? err.message : "We couldn't analyze this room. Please try another image.",
          true,
        )
    }
  }

  async function prepareAndAnalyze(file: Blob, name: string) {
    useSceneStore.getState().clearAll()
    set({ status: 'preparing', image: null, analysis: null, mask: null, occlusion: null, lighting: null, calibration: null, error: null })
    try {
      const image = await prepareImage(file, name)
      set({ image })
      await runAnalysis(image)
    } catch (err) {
      if (err instanceof ImageValidationError) fail('Invalid image', err.message, false)
      else fail('Something went wrong', 'Please try another image.', false)
    }
  }

  return {
    status: 'empty',
    image: null,
    analysis: null,
    mask: null,
    occlusion: null,
    lighting: null,
    calibration: null,
    error: null,
    analyzeStartedAt: 0,

    loadFile: async (file) => {
      try {
        validateFile(file)
      } catch (err) {
        fail('Invalid image', (err as Error).message, false)
        return
      }
      await prepareAndAnalyze(file, file.name)
    },

    loadSample: async (url, name) => {
      try {
        const blob = await (await fetch(url)).blob()
        await prepareAndAnalyze(blob, name)
      } catch {
        fail('Could not load sample', 'Please try again.', false)
      }
    },

    retry: async () => {
      const { image } = get()
      if (image) await runAnalysis(image)
    },

    changeRoom: () => {
      controller?.abort()
      useSceneStore.getState().clearAll()
      set({ status: 'empty', image: null, analysis: null, mask: null, occlusion: null, lighting: null, calibration: null, error: null })
    },

    setCalibration: (H) => set({ calibration: H }),
  }
})

// ---------------------------------------------------------------- selectors

/** Effective floor homography (floor cm -> image px): calibration wins over detection. */
export function selectFloorH(s: Pick<RoomState, 'calibration' | 'analysis'>): Mat3 | null {
  return s.calibration ?? s.analysis?.geometry?.homography ?? null
}

const invCache = new WeakMap<object, Mat3>()
export function inverseOf(H: Mat3): Mat3 {
  let inv = invCache.get(H)
  if (!inv) {
    inv = invert(H)
    invCache.set(H, inv)
  }
  return inv
}

/** Region where rugs may be placed (image px). Whole image if no floor was detected. */
export function selectFloorPolygon(s: Pick<RoomState, 'analysis' | 'image'>): Pt[] {
  const poly = s.analysis?.floor.detected ? s.analysis.floor.polygon : null
  if (poly && poly.length >= 3) return poly.map(([x, y]) => ({ x, y }))
  const w = s.image?.width ?? 1
  const h = s.image?.height ?? 1
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}
