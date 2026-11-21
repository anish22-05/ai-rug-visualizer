/**
 * Export the final visualisation at full resolution.
 *
 * We spin up a second, off-screen Compositor sized to the export resolution and
 * render the exact same scene description (geometry is in image px, so only the
 * canvas size changes). Selection handles live in the SVG overlay and are
 * therefore never part of the export.
 */
import type { Mat3, Product, Rug } from '../types'
import { Compositor, type Lighting, type RenderOptions } from './render/compositor'
import { buildRenderRugs } from './render/buildScene'
import { loadRugImage, TextureLoadError } from './render/textures'
import type { PreparedImage } from './imagePrep'

export interface ExportInput {
  image: PreparedImage
  /** Soft occlusion alpha (null = no occlusion). */
  occlusion: HTMLImageElement | null
  lighting: Lighting | null
  rugs: Rug[]
  products: Product[]
  H: Mat3
  options: RenderOptions
  format: 'image/png' | 'image/jpeg'
}

export async function renderExport(input: ExportInput): Promise<Blob> {
  const { image, occlusion, lighting, rugs, products, H, options, format } = input
  const canvas = document.createElement('canvas')
  canvas.width = image.exportWidth
  canvas.height = image.exportHeight
  const compositor = new Compositor(canvas, { preserveDrawingBuffer: true })
  try {
    compositor.setRoom(image.exportSource as TexImageSource, image.width, image.height)
    compositor.setMask(occlusion)
    compositor.setLighting(lighting)
    for (const productId of new Set(rugs.map((r) => r.productId))) {
      const product = products.find((p) => p.id === productId)
      if (!product) continue
      try {
        compositor.setRugTexture(productId, await loadRugImage(product.image))
      } catch (err) {
        if (err instanceof TextureLoadError) compositor.setRugTexture(productId, err.fallback)
      }
    }
    const sorted = [...rugs].sort((a, b) => a.zIndex - b.zIndex)
    compositor.render(buildRenderRugs(sorted, products, H), { x: 0, y: 0, w: image.width, h: image.height }, options)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), format, 0.92),
    )
  } finally {
    compositor.dispose()
    compositor.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
