/**
 * App-level commands, shared by buttons, keyboard shortcuts and drag-and-drop.
 * They read stores via getState() so they can be called from anywhere.
 */
import type { Pt } from '../types'
import { downloadBlob, renderExport } from './export'
import { computePlacement } from './placement'
import { MIN_RUG_CM, isProjectable } from './geometry/rugGeometry'
import { applyH, isConvexQuad, polygonCentroid, solveHomography } from './geometry/homography'
import { inverseOf, selectFloorH, selectFloorPolygon, useRoomStore } from '../store/roomStore'
import { useSceneStore } from '../store/sceneStore'
import { findProduct, priceFor, useProductStore } from '../store/productStore'
import { useUIStore } from '../store/uiStore'

export function addProductToRoom(productId: string, opts: { sizeId?: string; dropAt?: Pt } = {}) {
  const room = useRoomStore.getState()
  const H = selectFloorH(room)
  const product = findProduct(useProductStore.getState().products, productId)
  const ui = useUIStore.getState()
  if (!product) return
  if (!H || room.status !== 'ready') {
    ui.toast('Upload a room photo first, then add rugs.', 'info')
    return
  }
  const p = computePlacement({
    product,
    sizeId: opts.sizeId,
    H,
    Hinv: inverseOf(H),
    floorPolygon: selectFloorPolygon(room),
    suggestion: room.calibration ? null : room.analysis?.placement ?? null,
    existing: useSceneStore.getState().rugs,
    dropAt: opts.dropAt,
  })
  useSceneStore.getState().addRug({
    productId: product.id,
    name: product.name,
    sizeId: p.size.id,
    width: p.size.width,
    height: p.size.height,
    x: p.x,
    y: p.y,
    rotation: p.rotation,
  })
  if (ui.mode !== 'select') ui.setMode('select')
  ui.setMobileTab('edit')
}

export function setRugSize(rugId: string, sizeId: string) {
  const scene = useSceneStore.getState()
  const rug = scene.rugs.find((r) => r.id === rugId)
  const product = findProduct(useProductStore.getState().products, rug?.productId ?? '')
  const size = product?.sizes.find((s) => s.id === sizeId)
  const H = selectFloorH(useRoomStore.getState())
  if (!rug || !size || !H) return
  if (!isProjectable({ ...rug, width: size.width, height: size.height }, H)) {
    useUIStore.getState().toast('That size does not fit here. Move the rug closer first.', 'error')
    return
  }
  scene.updateRug(rugId, { sizeId, width: size.width, height: size.height }, { record: true })
}

export function setRugDimensions(rugId: string, width: number, height: number) {
  const scene = useSceneStore.getState()
  const rug = scene.rugs.find((r) => r.id === rugId)
  const H = selectFloorH(useRoomStore.getState())
  if (!rug || !H) return
  const w = Math.max(MIN_RUG_CM, width)
  const h = Math.max(MIN_RUG_CM, height)
  if (!isProjectable({ ...rug, width: w, height: h }, H)) return
  const product = findProduct(useProductStore.getState().products, rug.productId)
  const preset = product?.sizes.find((s) => s.width === w && s.height === h)
  scene.updateRug(rugId, { width: w, height: h, sizeId: preset?.id ?? 'custom' }, { record: true })
}

export async function exportRoom(format: 'image/png' | 'image/jpeg' = 'image/png') {
  const room = useRoomStore.getState()
  const H = selectFloorH(room)
  const ui = useUIStore.getState()
  if (!room.image || !H) return
  try {
    const blob = await renderExport({
      image: room.image,
      occlusion: room.analysis?.floor.detected ? room.occlusion : null,
      lighting: room.lighting,
      rugs: useSceneStore.getState().rugs,
      products: useProductStore.getState().products,
      H,
      options: ui.render,
      format,
    })
    const base = room.image.fileName.replace(/\.[^.]+$/, '') || 'room'
    downloadBlob(blob, `${base}-spacestyler.${format === 'image/png' ? 'png' : 'jpg'}`)
    ui.toast('Preview downloaded', 'success')
  } catch (err) {
    console.error(err)
    ui.toast('Export failed. Please try again.', 'error')
  }
}

// ----------------------------------------------------------- floor calibration

/** Floor-space square (cm) used as the calibration target, TL = far-left. */
export function calibrationSquare(sizeCm: number): Pt[] {
  const s = sizeCm / 2
  return [
    { x: -s, y: -s },
    { x: s, y: -s },
    { x: s, y: s },
    { x: -s, y: s },
  ]
}

/**
 * Manual floor calibration. The user drags 4 points onto the corners of a known
 * square on the floor (e.g. tiles), and we solve the homography from those
 * 4 correspondences. This also covers the "no floor detected" case.
 */
export function startCalibration() {
  const room = useRoomStore.getState()
  const ui = useUIStore.getState()
  if (!room.image) return
  const H = selectFloorH(room)
  const { width: w, height: h } = room.image
  let draft: Pt[]
  if (H) {
    const poly = selectFloorPolygon(room)
    const c = applyH(inverseOf(H), polygonCentroid(poly))
    draft = calibrationSquare(ui.calibSize).map((p) => applyH(H, { x: p.x + c.x, y: p.y + c.y }))
    if (!draft.every((p) => Number.isFinite(p.x) && Math.abs(p.x) < 4 * w && Math.abs(p.y) < 4 * h)) draft = defaultTrapezoid(w, h)
  } else {
    draft = defaultTrapezoid(w, h)
  }
  ui.setCalibDraft(draft)
  ui.setMode('calibrate')
  useSceneStore.getState().select(null)
}

function defaultTrapezoid(w: number, h: number): Pt[] {
  return [
    { x: w * 0.38, y: h * 0.62 },
    { x: w * 0.62, y: h * 0.62 },
    { x: w * 0.72, y: h * 0.86 },
    { x: w * 0.28, y: h * 0.86 },
  ]
}

export function applyCalibration() {
  const ui = useUIStore.getState()
  const draft = ui.calibDraft
  if (!draft) return
  if (!isConvexQuad(draft)) {
    ui.toast('The four points must form a convex shape (no crossing edges).', 'error')
    return
  }
  try {
    const H = solveHomography(calibrationSquare(ui.calibSize), draft)
    useRoomStore.getState().setCalibration(H)
    ui.setCalibDraft(null)
    ui.setMode('select')
    ui.toast('Floor calibrated', 'success')
  } catch {
    ui.toast('Those points are degenerate. Spread them out and try again.', 'error')
  }
}

export function cancelCalibration() {
  const ui = useUIStore.getState()
  ui.setCalibDraft(null)
  ui.setMode('select')
}

export function addSceneToCart() {
  const products = useProductStore.getState().products
  const rugs = useSceneStore.getState().rugs
  if (!rugs.length) return
  useUIStore.getState().addToCart(
    rugs.map((r) => ({
      productId: r.productId,
      sizeId: r.sizeId,
      width: Math.round(r.width),
      height: Math.round(r.height),
      price: priceFor(findProduct(products, r.productId), r),
    })),
  )
}
