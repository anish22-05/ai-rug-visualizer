import { create } from 'zustand'
import type { Pt } from '../types'

export type EditMode = 'select' | 'cornerPin' | 'calibrate'

export interface DebugLayers {
  mask: boolean
  polygon: boolean
  grid: boolean
  lines: boolean
  segments: boolean
  horizon: boolean
}

export interface RenderOptions {
  shadows: boolean
  lighting: boolean
  occlusion: boolean
}

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

interface UIState {
  mode: EditMode
  debug: boolean
  debugLayers: DebugLayers
  render: RenderOptions
  /** Zoom factor (1 = fit) and view centre in image px (null = image centre). */
  zoom: number
  center: Pt | null
  cartOpen: boolean
  cart: { productId: string; sizeId: string; width: number; height: number; price: number }[]
  toasts: Toast[]
  mobileTab: 'library' | 'edit' | 'layers'
  /** Floor calibration draft: 4 image points of a square of `calibSize` cm on the floor. */
  calibDraft: Pt[] | null
  calibSize: number

  setMode: (m: EditMode) => void
  toggleDebug: () => void
  setDebugLayer: (k: keyof DebugLayers, v: boolean) => void
  setRender: (k: keyof RenderOptions, v: boolean) => void
  setView: (zoom: number, center: Pt | null) => void
  resetView: () => void
  setCartOpen: (v: boolean) => void
  addToCart: (items: UIState['cart']) => void
  removeFromCart: (index: number) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
  setMobileTab: (t: UIState['mobileTab']) => void
  setCalibDraft: (pts: Pt[] | null) => void
  setCalibSize: (cm: number) => void
}

let toastSeq = 1

export const useUIStore = create<UIState>()((set, get) => ({
  mode: 'select',
  debug: false,
  debugLayers: { mask: true, polygon: true, grid: true, lines: false, segments: false, horizon: true },
  render: { shadows: true, lighting: true, occlusion: true },
  zoom: 1,
  center: null,
  cartOpen: false,
  cart: [],
  toasts: [],
  mobileTab: 'library',
  calibDraft: null,
  calibSize: 200,

  setMode: (mode) => set({ mode }),
  toggleDebug: () => set({ debug: !get().debug }),
  setDebugLayer: (k, v) => set({ debugLayers: { ...get().debugLayers, [k]: v } }),
  setRender: (k, v) => set({ render: { ...get().render, [k]: v } }),
  setView: (zoom, center) => set({ zoom: Math.min(8, Math.max(1, zoom)), center }),
  resetView: () => set({ zoom: 1, center: null }),
  setCartOpen: (cartOpen) => set({ cartOpen }),
  addToCart: (items) => set({ cart: [...get().cart, ...items], cartOpen: true }),
  removeFromCart: (index) => set({ cart: get().cart.filter((_, i) => i !== index) }),
  toast: (text, kind = 'info') => {
    const id = toastSeq++
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => get().dismissToast(id), 3500)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setCalibDraft: (calibDraft) => set({ calibDraft }),
  setCalibSize: (calibSize) => set({ calibSize: Math.min(1000, Math.max(20, calibSize)) }),
}))
