import { useEffect } from 'react'
import { isProjectable } from '../lib/geometry/rugGeometry'
import { selectFloorH, useRoomStore } from '../store/roomStore'
import { useSceneStore } from '../store/sceneStore'
import { useUIStore } from '../store/uiStore'
import { cancelCalibration } from '../lib/actions'

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const scene = useSceneStore.getState()
      const ui = useUIStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key

      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) scene.redo()
        else scene.undo()
        return
      }
      if (mod && key.toLowerCase() === 'y') {
        e.preventDefault()
        scene.redo()
        return
      }
      if (key === 'Escape') {
        if (ui.mode === 'calibrate') cancelCalibration()
        else if (ui.mode !== 'select') ui.setMode('select')
        else scene.select(null)
        return
      }
      if (key.toLowerCase() === 'd' && !mod && useRoomStore.getState().status === 'ready') {
        ui.toggleDebug()
        return
      }
      if (key === 'Tab' && scene.rugs.length) {
        e.preventDefault()
        const sorted = [...scene.rugs].sort((a, b) => b.zIndex - a.zIndex)
        const i = sorted.findIndex((r) => r.id === scene.selectedId)
        scene.select(sorted[(i + (e.shiftKey ? sorted.length - 1 : 1)) % sorted.length].id)
        return
      }

      const rug = scene.rugs.find((r) => r.id === scene.selectedId)
      if (!rug) return
      const H = selectFloorH(useRoomStore.getState())

      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault()
        scene.deleteRug(rug.id)
      } else if (mod && key.toLowerCase() === 'd') {
        e.preventDefault()
        scene.duplicateRug(rug.id)
      } else if (key === ']') {
        scene.reorder(rug.id, e.shiftKey ? 'front' : 'forward')
      } else if (key === '[') {
        scene.reorder(rug.id, e.shiftKey ? 'back' : 'backward')
      } else if (key === '}') {
        scene.reorder(rug.id, 'front')
      } else if (key === '{') {
        scene.reorder(rug.id, 'back')
      } else if (key.toLowerCase() === 'r' && !mod) {
        const rotation = (((rug.rotation + (e.shiftKey ? -15 : 15)) % 360) + 360) % 360
        if (!H || isProjectable({ ...rug, rotation }, H)) scene.updateRug(rug.id, { rotation }, { record: true })
      } else if (key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 25 : 5
        const d = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[key]
        if (!d) return
        // Nudge on the floor plane: Up = away from the camera, Down = towards it.
        const next = { x: rug.x + d.x, y: rug.y + d.y }
        if (!H || isProjectable({ ...rug, ...next }, H)) scene.updateRug(rug.id, next, { record: !e.repeat })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
