/**
 * Client-side image validation and preparation.
 *
 * - Validates type and size before anything is uploaded.
 * - Decodes with EXIF orientation applied (phone photos are often rotated).
 * - Produces a "working" image (long edge ≤ 2048 px) that is displayed, uploaded
 *   and used as the coordinate space for all geometry, plus an export-resolution
 *   copy (long edge ≤ 4096 px) so the downloaded result stays sharp.
 */

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png']
export const MAX_FILE_MB = 25
export const WORK_LONG_EDGE = 2048
export const EXPORT_LONG_EDGE = 4096

export class ImageValidationError extends Error {}

export interface PreparedImage {
  /** Working-resolution canvas: displayed, uploaded, defines image coordinates. */
  work: HTMLCanvasElement
  width: number
  height: number
  /** Higher-resolution copy used only when exporting. */
  exportSource: ImageBitmap | HTMLCanvasElement
  exportWidth: number
  exportHeight: number
  uploadBlob: Blob
  fileName: string
}

export function validateFile(file: File): void {
  const extOk = /\.(jpe?g|png)$/i.test(file.name)
  if (!ACCEPTED_TYPES.includes(file.type) && !extOk) {
    throw new ImageValidationError('Please upload a valid JPG or PNG image.')
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new ImageValidationError(
      `This image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please upload a photo under ${MAX_FILE_MB} MB.`,
    )
  }
  if (file.size === 0) throw new ImageValidationError('Please upload a valid JPG or PNG image.')
}

function fit(w: number, h: number, longEdge: number) {
  const s = Math.min(1, longEdge / Math.max(w, h))
  return { width: Math.round(w * s), height: Math.round(h * s) }
}

function drawScaled(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return canvas
}

export async function prepareImage(file: Blob, fileName = 'room.jpg'): Promise<PreparedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageValidationError('Please upload a valid JPG or PNG image.')
  }
  if (bitmap.width < 64 || bitmap.height < 64) {
    throw new ImageValidationError('This image is too small to analyze. Please upload a larger photo.')
  }

  const workSize = fit(bitmap.width, bitmap.height, WORK_LONG_EDGE)
  const work = drawScaled(bitmap, workSize.width, workSize.height)

  const exportSize = fit(bitmap.width, bitmap.height, EXPORT_LONG_EDGE)
  const exportSource =
    exportSize.width === bitmap.width ? bitmap : drawScaled(bitmap, exportSize.width, exportSize.height)

  const uploadBlob = await new Promise<Blob>((resolve, reject) =>
    work.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), 'image/jpeg', 0.92),
  )
  return {
    work,
    width: workSize.width,
    height: workSize.height,
    exportSource,
    exportWidth: exportSize.width,
    exportHeight: exportSize.height,
    uploadBlob,
    fileName,
  }
}
