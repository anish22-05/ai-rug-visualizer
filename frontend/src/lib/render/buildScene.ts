/** Turn scene state (rugs in floor cm) into draw calls (quads in image px). */
import type { Mat3, Product, Rug } from '../../types'
import { applyH, add } from '../geometry/homography'
import { expandedPose, floorCorners, imageCorners, isProjectable } from '../geometry/rugGeometry'
import { arrayToCorners } from '../geometry/homography'
import { CORNER_KEYS } from '../../types'
import type { RenderRug } from './compositor'

export function buildRenderRugs(sortedRugs: Rug[], products: Product[], H: Mat3): RenderRug[] {
  const out: RenderRug[] = []
  for (const rug of sortedRugs) {
    if (!isProjectable(rug, H)) continue
    const product = products.find((p) => p.id === rug.productId)
    const margin = Math.max(4, 0.035 * Math.max(rug.width, rug.height))
    // Light usually comes from windows behind/above: nudge the shadow slightly toward the camera.
    const shadowPose = expandedPose(rug, margin, { x: 0, y: margin * 0.35 })
    const shadowImg = floorCorners(shadowPose).map((p) => applyH(H, p))
    const shadowCorners = arrayToCorners(shadowImg.map((p, i) => add(p, rug.perspective[CORNER_KEYS[i]])))
    out.push({
      textureKey: rug.productId,
      corners: imageCorners(rug, H),
      shadowCorners,
      shadowSoft: [(2 * margin) / shadowPose.width, (2 * margin) / shadowPose.height],
      round: product?.shape === 'round',
      opacity: rug.opacity,
    })
  }
  return out
}
