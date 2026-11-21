import { useState } from 'react'
import { useRoomStore } from '../store/roomStore'
import { useSceneStore } from '../store/sceneStore'
import { useUIStore } from '../store/uiStore'
import { exportRoom } from '../lib/actions'
import { Icon } from './ui/Icon'
import { SHORTCUTS } from '../lib/shortcuts'

export function Toolbar() {
  const status = useRoomStore((s) => s.status)
  const changeRoom = useRoomStore((s) => s.changeRoom)
  const canUndo = useSceneStore((s) => s.past.length > 0)
  const canRedo = useSceneStore((s) => s.future.length > 0)
  const hasRugs = useSceneStore((s) => s.rugs.length > 0)
  const { undo, redo, resetScene } = useSceneStore.getState()
  const debug = useUIStore((s) => s.debug)
  const toggleDebug = useUIStore((s) => s.toggleDebug)
  const cartCount = useUIStore((s) => s.cart.length)
  const setCartOpen = useUIStore((s) => s.setCartOpen)
  const [exporting, setExporting] = useState(false)
  const [help, setHelp] = useState(false)
  const ready = status === 'ready'

  const doExport = async (fmt: 'image/png' | 'image/jpeg') => {
    setExporting(true)
    await exportRoom(fmt)
    setExporting(false)
  }

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo">◩</span>
        <span className="hide-xs">
          SpaceStyler <em>Room Visualizer</em>
        </span>
      </div>
      <div className="toolbar-actions">
        <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <Icon name="redo" />
        </button>
        <span className="sep" />
        <button className="btn ghost" onClick={resetScene} disabled={!hasRugs} title="Remove all rugs, keep the photo">
          <Icon name="reset" size={16} /> <span className="hide-sm">Reset room</span>
        </button>
        <button className="btn ghost" onClick={changeRoom} disabled={status === 'empty'} title="Upload a different photo">
          <Icon name="image" size={16} /> <span className="hide-sm">Change photo</span>
        </button>
        <button className={`btn ghost ${debug ? 'active' : ''}`} onClick={toggleDebug} disabled={!ready} title="Show floor detection (D)">
          <Icon name="bug" size={16} /> <span className="hide-sm">Debug</span>
        </button>
        <span className="sep" />
        <div className="split">
          <button className="btn primary" onClick={() => doExport('image/png')} disabled={!ready || exporting} title="Download PNG">
            <Icon name="download" size={16} /> <span className="hide-xs">{exporting ? 'Exporting…' : 'Download'}</span>
          </button>
          <button className="btn primary narrow" onClick={() => doExport('image/jpeg')} disabled={!ready || exporting} title="Download JPEG (smaller)">
            JPG
          </button>
        </div>
        <button className="icon-btn cart-btn" onClick={() => setCartOpen(true)} title="Cart" aria-label="Cart">
          <Icon name="cart" />
          {cartCount > 0 && <span className="badge">{cartCount}</span>}
        </button>
        <span className="help-wrap">
          <button className="icon-btn" onClick={() => setHelp(!help)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
            <Icon name="help" />
          </button>
          {help && (
            <div className="popover" onClick={() => setHelp(false)}>
              <h4>Shortcuts</h4>
              <dl>
                {SHORTCUTS.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </span>
      </div>
    </header>
  )
}
