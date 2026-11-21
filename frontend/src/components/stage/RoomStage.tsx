/**
 * The room canvas: a WebGL2 compositor (pixels) under an SVG overlay (interaction,
 * debug), both in the same image-pixel coordinate space via a shared `view` rect.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Pt } from '../../types'
import { Compositor } from '../../lib/render/compositor'
import { buildRenderRugs } from '../../lib/render/buildScene'
import { loadRugImage, TextureLoadError } from '../../lib/render/textures'
import { addProductToRoom } from '../../lib/actions'
import { inverseOf, selectFloorH, selectFloorPolygon, useRoomStore } from '../../store/roomStore'
import { selectSortedRugs, useSceneStore } from '../../store/sceneStore'
import { useProductStore } from '../../store/productStore'
import { useUIStore } from '../../store/uiStore'
import { computeView } from './viewport'
import { useRugGestures } from './useRugGestures'
import { RugOverlay } from './RugOverlay'
import { DebugOverlay } from './DebugOverlay'
import { CalibrationOverlay } from './CalibrationOverlay'
import { useShallow } from 'zustand/react/shallow'

export const PRODUCT_DRAG_TYPE = 'application/x-spacestyler-product'

export function RoomStage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const compositorRef = useRef<Compositor | null>(null)
  const loadingTextures = useRef(new Set<string>())
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [texVersion, setTexVersion] = useState(0)
  const [glError, setGlError] = useState<string | null>(null)

  const { image, analysis, occlusion, lighting } = useRoomStore(
    useShallow((s) => ({ image: s.image, analysis: s.analysis, occlusion: s.occlusion, lighting: s.lighting })),
  )
  const H = useRoomStore(selectFloorH)
  const floorPolygon = useMemo(() => selectFloorPolygon({ analysis, image }), [analysis, image])
  const rugs = useSceneStore(useShallow(selectSortedRugs))
  const selectedId = useSceneStore((s) => s.selectedId)
  const products = useProductStore((s) => s.products)
  const { zoom, center, render, debug, debugLayers, mode } = useUIStore(
    useShallow((s) => ({ zoom: s.zoom, center: s.center, render: s.render, debug: s.debug, debugLayers: s.debugLayers, mode: s.mode })),
  )

  const imgW = image?.width ?? 1
  const imgH = image?.height ?? 1
  const view = useMemo(() => computeView(size.w, size.h, imgW, imgH, zoom, center), [size, imgW, imgH, zoom, center])
  const pxToImg = size.w ? view.w / size.w : 1

  const toImage = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const rect = svgRef.current!.getBoundingClientRect()
      return {
        x: view.x + ((e.clientX - rect.left) / rect.width) * view.w,
        y: view.y + ((e.clientY - rect.top) / rect.height) * view.h,
      }
    },
    [view],
  )

  const Hinv = useMemo(() => (H ? inverseOf(H) : null), [H])
  const gestures = useRugGestures({ H: H ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], Hinv: Hinv ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], floorPolygon, toImage })

  // ---------------------------------------------------------------- setup

  useEffect(() => {
    const el = containerRef.current!
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    try {
      compositorRef.current = new Compositor(canvasRef.current!)
    } catch (err) {
      setGlError((err as Error).message)
    }
    return () => {
      compositorRef.current?.dispose()
      compositorRef.current = null
    }
  }, [])

  useEffect(() => {
    if (image && compositorRef.current) compositorRef.current.setRoom(image.work, image.width, image.height)
  }, [image])

  useEffect(() => {
    compositorRef.current?.setMask(analysis?.floor.detected ? occlusion : null)
    compositorRef.current?.setLighting(lighting)
  }, [occlusion, lighting, analysis])

  // Load rug textures on demand; unsupported/broken images fall back to a placeholder.
  useEffect(() => {
    const comp = compositorRef.current
    if (!comp) return
    for (const productId of new Set(rugs.map((r) => r.productId))) {
      if (comp.hasRugTexture(productId) || loadingTextures.current.has(productId)) continue
      const product = products.find((p) => p.id === productId)
      if (!product) continue
      loadingTextures.current.add(productId)
      loadRugImage(product.image)
        .then((src) => comp.setRugTexture(productId, src))
        .catch((err) => {
          if (err instanceof TextureLoadError) comp.setRugTexture(productId, err.fallback)
          useUIStore.getState().toast(`Couldn't load the image for "${product.name}". Showing a placeholder.`, 'error')
        })
        .finally(() => {
          loadingTextures.current.delete(productId)
          setTexVersion((v) => v + 1)
        })
    }
  }, [rugs, products])

  // ---------------------------------------------------------------- render

  useEffect(() => {
    const comp = compositorRef.current
    const canvas = canvasRef.current
    if (!comp || !canvas || !size.w) return
    const frame = requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(size.w * dpr)
      const h = Math.round(size.h * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      comp.render(H ? buildRenderRugs(rugs, products, H) : [], view, render)
    })
    return () => cancelAnimationFrame(frame)
  }, [rugs, products, H, view, render, size, texVersion, image, occlusion, lighting, analysis])

  // ---------------------------------------------------------------- zoom / pan

  useEffect(() => {
    const svg = svgRef.current!
    const onWheel = (e: WheelEvent) => {
      if (!image) return
      e.preventDefault()
      const { zoom: z, setView } = useUIStore.getState()
      const next = Math.min(8, Math.max(1, z * Math.exp(-e.deltaY * 0.0015)))
      const p = toImage(e)
      const c = { x: view.x + view.w / 2, y: view.y + view.h / 2 }
      // Keep the image point under the cursor fixed while zooming.
      setView(next, { x: p.x - (p.x - c.x) * (z / next), y: p.y - (p.y - c.y) * (z / next) })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [toImage, view, image])

  const pan = useRef<{ start: Pt; center: Pt } | null>(null)

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    useSceneStore.getState().select(null)
    if (zoom > 1) {
      svgRef.current!.setPointerCapture(e.pointerId)
      pan.current = { start: { x: e.clientX, y: e.clientY }, center: { x: view.x + view.w / 2, y: view.y + view.h / 2 } }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (gestures.onPointerMove(e)) return
    if (pan.current) {
      const k = view.w / size.w
      useUIStore.getState().setView(zoom, {
        x: pan.current.center.x - (e.clientX - pan.current.start.x) * k,
        y: pan.current.center.y - (e.clientY - pan.current.start.y) * k,
      })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    gestures.onPointerUp(e)
    pan.current = null
  }

  // ---------------------------------------------------------------- drag & drop from library

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(PRODUCT_DRAG_TYPE)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(PRODUCT_DRAG_TYPE)
    if (!id) return
    e.preventDefault()
    addProductToRoom(id, { dropAt: toImage(e) })
  }

  return (
    <div ref={containerRef} className="stage" onDragOver={onDragOver} onDrop={onDrop}>
      <canvas ref={canvasRef} className="stage-canvas" aria-label="Room preview" />
      <svg
        ref={svgRef}
        className={`stage-overlay ${zoom > 1 ? 'can-pan' : ''}`}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="transparent" onPointerDown={onBackgroundPointerDown} />
        {debug && analysis && <DebugOverlay analysis={analysis} H={H} width={imgW} height={imgH} layers={debugLayers} k={pxToImg} />}
        {H && mode !== 'calibrate' && (
          <RugOverlay rugs={rugs} selectedId={selectedId} H={H} pxToImg={pxToImg} cornerPin={mode === 'cornerPin'} gestures={gestures} />
        )}
        {mode === 'calibrate' && <CalibrationOverlay k={pxToImg} toImage={toImage} />}
      </svg>
      {glError && (
        <div className="stage-message">
          <strong>Your browser can't render the preview.</strong>
          <span>{glError}. Please try a recent version of Chrome, Edge, Firefox or Safari.</span>
        </div>
      )}
    </div>
  )
}
