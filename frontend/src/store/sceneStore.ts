/**
 * Scene state: placed rugs, selection and undo/redo history.
 *
 * History holds immutable snapshots of the `rugs` array (immer gives structural
 * sharing, so snapshots are cheap). Discrete actions (add, delete, reorder,
 * reset...) record a snapshot immediately. Continuous gestures (drag, resize,
 * rotate) call beginGesture() on pointer-down and endGesture() on pointer-up, so
 * one drag is one undo step, not hundreds.
 */
import { produce } from 'immer'
import { create } from 'zustand'
import type { Rug } from '../types'
import { ZERO_CORNERS } from '../lib/geometry/rugGeometry'

const HISTORY_LIMIT = 100

export type LayerMove = 'forward' | 'backward' | 'front' | 'back'

export interface NewRug {
  productId: string
  name: string
  sizeId: string
  width: number
  height: number
  x: number
  y: number
  rotation?: number
}

interface SceneState {
  rugs: Rug[]
  selectedId: string | null
  past: Rug[][]
  future: Rug[][]
  gestureStart: Rug[] | null
  seq: number

  addRug: (spec: NewRug) => string
  updateRug: (id: string, patch: Partial<Omit<Rug, 'id'>>, opts?: { record?: boolean }) => void
  deleteRug: (id: string) => void
  duplicateRug: (id: string) => void
  reorder: (id: string, move: LayerMove) => void
  select: (id: string | null) => void
  resetScene: () => void
  clearAll: () => void
  beginGesture: () => void
  endGesture: () => void
  undo: () => void
  redo: () => void
}

/** Re-number zIndex 0..n-1 following the current order, so values stay compact. */
function normalizeZ(rugs: Rug[]): void {
  ;[...rugs].sort((a, b) => a.zIndex - b.zIndex).forEach((r, i) => (r.zIndex = i))
}

export const useSceneStore = create<SceneState>()((set, get) => {
  /** Push the current rugs onto the undo stack before a discrete change. */
  const record = () => {
    const { rugs, past } = get()
    set({ past: [...past, rugs].slice(-HISTORY_LIMIT), future: [] })
  }

  return {
    rugs: [],
    selectedId: null,
    past: [],
    future: [],
    gestureStart: null,
    seq: 1,

    addRug: (spec) => {
      record()
      const { seq, rugs } = get()
      const id = `rug_${String(seq).padStart(3, '0')}`
      const rug: Rug = {
        id,
        productId: spec.productId,
        name: spec.name,
        sizeId: spec.sizeId,
        x: spec.x,
        y: spec.y,
        width: spec.width,
        height: spec.height,
        rotation: spec.rotation ?? 0,
        perspective: ZERO_CORNERS,
        zIndex: rugs.length ? Math.max(...rugs.map((r) => r.zIndex)) + 1 : 0,
        opacity: 1,
      }
      set({ rugs: [...rugs, rug], selectedId: id, seq: seq + 1 })
      return id
    },

    updateRug: (id, patch, opts) => {
      if (opts?.record) record()
      set((s) => ({
        rugs: produce(s.rugs, (draft) => {
          const rug = draft.find((r) => r.id === id)
          if (rug) Object.assign(rug, patch)
        }),
      }))
    },

    deleteRug: (id) => {
      if (!get().rugs.some((r) => r.id === id)) return
      record()
      set((s) => ({
        rugs: produce(
          s.rugs.filter((r) => r.id !== id),
          normalizeZ,
        ),
        selectedId: s.selectedId === id ? null : s.selectedId,
      }))
    },

    duplicateRug: (id) => {
      const src = get().rugs.find((r) => r.id === id)
      if (!src) return
      const newId = get().addRug({ ...src, x: src.x + 20, y: src.y + 20 })
      get().updateRug(newId, { perspective: src.perspective, opacity: src.opacity })
    },

    reorder: (id, move) => {
      const sorted = [...get().rugs].sort((a, b) => a.zIndex - b.zIndex)
      const from = sorted.findIndex((r) => r.id === id)
      if (from < 0) return
      const to = { forward: from + 1, backward: from - 1, front: sorted.length - 1, back: 0 }[move]
      if (to < 0 || to >= sorted.length || to === from) return
      record()
      const [item] = sorted.splice(from, 1)
      sorted.splice(to, 0, item)
      const order = new Map(sorted.map((r, i) => [r.id, i]))
      set((s) => ({
        rugs: produce(s.rugs, (draft) => {
          draft.forEach((r) => (r.zIndex = order.get(r.id)!))
        }),
      }))
    },

    select: (id) => set({ selectedId: id }),

    // "Reset room": remove all rugs but keep the photo. Undoable.
    resetScene: () => {
      if (!get().rugs.length) return
      record()
      set({ rugs: [], selectedId: null })
    },

    // New photo: wipe everything including history.
    clearAll: () => set({ rugs: [], selectedId: null, past: [], future: [], gestureStart: null }),

    beginGesture: () => set({ gestureStart: get().rugs }),

    endGesture: () => {
      const { gestureStart, rugs, past } = get()
      if (gestureStart && gestureStart !== rugs) {
        set({ past: [...past, gestureStart].slice(-HISTORY_LIMIT), future: [] })
      }
      set({ gestureStart: null })
    },

    undo: () => {
      const { past, future, rugs, selectedId } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      set({
        rugs: prev,
        past: past.slice(0, -1),
        future: [rugs, ...future],
        selectedId: prev.some((r) => r.id === selectedId) ? selectedId : null,
      })
    },

    redo: () => {
      const { past, future, rugs, selectedId } = get()
      if (!future.length) return
      const next = future[0]
      set({
        rugs: next,
        past: [...past, rugs],
        future: future.slice(1),
        selectedId: next.some((r) => r.id === selectedId) ? selectedId : null,
      })
    },
  }
})

/** Rugs in draw order (bottom first). */
export const selectSortedRugs = (s: SceneState) => [...s.rugs].sort((a, b) => a.zIndex - b.zIndex)
export const selectSelectedRug = (s: SceneState) => s.rugs.find((r) => r.id === s.selectedId) ?? null
