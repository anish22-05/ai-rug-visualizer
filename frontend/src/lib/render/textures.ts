/** Rug image loading with caching and a safe placeholder for broken/unsupported images. */

const cache = new Map<string, Promise<TexImageSource>>()

function placeholder(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#c9c4bc' : '#e4e0d9'
      ctx.fillRect(x * 32, y * 32, 32, 32)
    }
  ctx.fillStyle = '#6b6158'
  ctx.font = 'bold 120px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('?', 128, 136)
  return c
}

export class TextureLoadError extends Error {
  readonly fallback: TexImageSource
  constructor(fallback: TexImageSource) {
    super('Rug image could not be loaded')
    this.fallback = fallback
  }
}

/** Resolve to the decoded image, or reject with a TextureLoadError carrying a placeholder. */
export function loadRugImage(url: string): Promise<TexImageSource> {
  let p = cache.get(url)
  if (!p) {
    p = new Promise<TexImageSource>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.decoding = 'async'
      img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new TextureLoadError(placeholder())))
      img.onerror = () => reject(new TextureLoadError(placeholder()))
      img.src = url
    })
    // Don't cache failures forever: allow a later retry.
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}
