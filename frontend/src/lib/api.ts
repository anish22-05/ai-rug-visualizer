import type { Product, RoomAnalysis } from '../types'

/** Empty in dev (Vite proxies /api and /static to the backend). Set in production. */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

const FALLBACK_MESSAGE = "We couldn't analyze this room. Please try another image."

export async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json()
    return new ApiError(body.code ?? 'error', body.message ?? FALLBACK_MESSAGE, res.status)
  } catch {
    return new ApiError('error', FALLBACK_MESSAGE, res.status)
  }
}

export async function analyzeRoom(image: Blob, signal?: AbortSignal): Promise<RoomAnalysis> {
  const form = new FormData()
  form.append('image', image, 'room.jpg')
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/v1/analyze`, { method: 'POST', body: form, signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('network', 'Could not reach the analysis service. Please check your connection and try again.', 0)
  }
  if (!res.ok) throw await parseError(res)
  return res.json()
}

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch(`${API_BASE}/api/v1/products`)
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { products: Product[] }
  return data.products.map((p) => ({ ...p, image: absolute(p.image), thumbnail: absolute(p.thumbnail) }))
}

export const absolute = (path: string) => (/^https?:/.test(path) ? path : `${API_BASE}${path}`)
