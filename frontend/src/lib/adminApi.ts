import type { Product, RugShape } from '../types'
import { API_BASE, ApiError, absolute, parseError } from './api'

/** What the owner edits. Size ids and labels are assigned by the backend. */
export interface ProductInput {
  name: string
  description: string
  material: string
  price: number
  shape: RugShape
  sizes: { width: number; height: number; priceDelta: number }[]
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function call(path: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/v1/admin${path}`, init)
  } catch {
    throw new ApiError('network', 'Could not reach the server. Please check your connection and try again.', 0)
  }
  if (!res.ok) throw await parseError(res)
  return res
}

const withUrls = (p: Product): Product => ({ ...p, image: absolute(p.image), thumbnail: absolute(p.thumbnail) })

/** Resolves if the access key is accepted; throws ApiError (401/503) otherwise. */
export async function verifyOwner(token: string): Promise<void> {
  await call('/session', { headers: auth(token) })
}

/** Create (no id) or update a product. `image` is required when creating. */
export async function saveProduct(token: string, input: ProductInput, image: File | null, id?: string): Promise<Product> {
  const form = new FormData()
  form.append('product', JSON.stringify(input))
  if (image) form.append('image', image, image.name)
  const res = await call(id ? `/products/${encodeURIComponent(id)}` : '/products', {
    method: id ? 'PUT' : 'POST',
    headers: auth(token),
    body: form,
  })
  return withUrls(await res.json())
}

export async function deleteProduct(token: string, id: string): Promise<void> {
  await call(`/products/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(token) })
}
