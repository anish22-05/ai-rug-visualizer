import type { Pt } from '../../types'
import type { View } from '../../lib/render/compositor'

/**
 * Visible image rectangle for a stage of (stageW x stageH) CSS px.
 * zoom = 1 fits the whole image (letterboxed); `center` is in image px.
 * The rect has the stage's aspect ratio, so canvas and SVG map 1:1.
 */
export function computeView(stageW: number, stageH: number, imgW: number, imgH: number, zoom: number, center: Pt | null): View {
  if (stageW <= 0 || stageH <= 0) return { x: 0, y: 0, w: imgW, h: imgH }
  const scale = Math.min(stageW / imgW, stageH / imgH) * zoom // CSS px per image px
  const w = stageW / scale
  const h = stageH / scale
  let c = center ?? { x: imgW / 2, y: imgH / 2 }
  // Keep the image from being panned completely out of view.
  c = {
    x: w >= imgW ? imgW / 2 : Math.min(imgW - w / 2, Math.max(w / 2, c.x)),
    y: h >= imgH ? imgH / 2 : Math.min(imgH - h / 2, Math.max(h / 2, c.y)),
  }
  return { x: c.x - w / 2, y: c.y - h / 2, w, h }
}
