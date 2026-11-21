import { create } from 'zustand'
import type { Product, Rug } from '../types'
import { fetchProducts } from '../lib/api'

interface ProductState {
  products: Product[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  load: () => Promise<void>
  /** Re-fetch quietly (no loading state), e.g. after the owner edits the catalogue. */
  refresh: () => Promise<void>
}

export const useProductStore = create<ProductState>()((set, get) => ({
  products: [],
  status: 'idle',
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return
    set({ status: 'loading' })
    try {
      set({ products: await fetchProducts(), status: 'ready' })
    } catch {
      set({ status: 'error' })
    }
  },
  refresh: async () => {
    if (get().status === 'loading') return
    try {
      set({ products: await fetchProducts(), status: 'ready' })
    } catch {
      // keep showing the catalogue we already have
    }
  },
}))

export const findProduct = (products: Product[], id: string) => products.find((p) => p.id === id)

/**
 * Price for a rug as configured. A preset size uses its catalogue price; a custom
 * (freely resized) rug is estimated by area relative to the default size.
 */
export function priceFor(product: Product | undefined, rug: Pick<Rug, 'sizeId' | 'width' | 'height'>): number {
  if (!product) return 0
  const preset = product.sizes.find((s) => s.id === rug.sizeId)
  if (preset) return product.price + preset.priceDelta
  const base = product.sizes.find((s) => s.priceDelta === 0) ?? product.sizes[0]
  const estimate = (product.price * (rug.width * rug.height)) / (base.width * base.height)
  return Math.max(499, Math.round(estimate / 100) * 100 - 1)
}

export const formatINR = (n: number) => `₹${n.toLocaleString('en-IN')}`
