/** Properties of the selected rug: size variant, exact size, rotation, opacity, perspective, layer, delete. */
import { useState } from 'react'
import { selectSelectedRug, useSceneStore } from '../../store/sceneStore'
import { findProduct, formatINR, priceFor, useProductStore } from '../../store/productStore'
import { useUIStore } from '../../store/uiStore'
import { setRugDimensions, setRugSize } from '../../lib/actions'
import { ZERO_CORNERS } from '../../lib/geometry/rugGeometry'
import { Icon } from '../ui/Icon'

function NumberField({ label, value, onCommit, suffix }: { label: string; value: number; onCommit: (v: number) => void; suffix: string }) {
  // Parent passes key={value}, so the draft resets whenever the real value changes.
  const [draft, setDraft] = useState(String(Math.round(value)))
  const commit = () => {
    const v = Number(draft)
    if (Number.isFinite(v) && v > 0) onCommit(v)
    else setDraft(String(Math.round(value)))
  }
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-wrap">
        <input
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
        <em>{suffix}</em>
      </span>
    </label>
  )
}

export function Inspector() {
  const rug = useSceneStore(selectSelectedRug)
  const { updateRug, deleteRug, duplicateRug, reorder, beginGesture, endGesture } = useSceneStore.getState()
  const products = useProductStore((s) => s.products)
  const mode = useUIStore((s) => s.mode)
  const setMode = useUIStore((s) => s.setMode)

  if (!rug) {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2>Selected rug</h2>
        </header>
        <p className="muted small">Select a rug in the room to move, resize, rotate or remove it.</p>
      </section>
    )
  }
  const product = findProduct(products, rug.productId)
  const pinned = Object.values(rug.perspective).some((p) => p.x !== 0 || p.y !== 0)

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{rug.name}</h2>
        <span className="price">{formatINR(priceFor(product, rug))}</span>
      </header>
      <p className="muted tiny">
        {rug.id} · {rug.productId}
        {product?.material ? ` · ${product.material}` : ''}
      </p>
      {product?.description && <p className="small rug-description">{product.description}</p>}

      {product && (
        <div className="chips" role="radiogroup" aria-label="Size">
          {product.sizes.map((s) => (
            <button key={s.id} className={`chip ${rug.sizeId === s.id ? 'on' : ''}`} onClick={() => setRugSize(rug.id, s.id)} role="radio" aria-checked={rug.sizeId === s.id}>
              {s.label}
            </button>
          ))}
          {rug.sizeId === 'custom' && <span className="chip on">Custom</span>}
        </div>
      )}

      <div className="field-row">
        <NumberField key={`w${rug.id}${Math.round(rug.width)}`} label="Width" value={rug.width} suffix="cm" onCommit={(v) => setRugDimensions(rug.id, v, product?.shape === 'round' ? v : rug.height)} />
        <NumberField key={`h${rug.id}${Math.round(rug.height)}`} label="Length" value={rug.height} suffix="cm" onCommit={(v) => setRugDimensions(rug.id, product?.shape === 'round' ? v : rug.width, v)} />
      </div>

      <label className="field">
        <span>
          Rotation <em className="muted">{Math.round(rug.rotation)}°</em>
        </span>
        <input
          type="range"
          min={0}
          max={359}
          value={Math.round(rug.rotation)}
          onPointerDown={beginGesture}
          onPointerUp={endGesture}
          onKeyDown={beginGesture}
          onKeyUp={endGesture}
          onChange={(e) => updateRug(rug.id, { rotation: Number(e.target.value) })}
        />
      </label>
      <div className="row gap wrap">
        {[0, 45, 90, 180].map((a) => (
          <button key={a} className="btn small" onClick={() => updateRug(rug.id, { rotation: a }, { record: true })}>
            {a}°
          </button>
        ))}
      </div>

      <label className="field">
        <span>
          Opacity <em className="muted">{Math.round(rug.opacity * 100)}%</em>
        </span>
        <input
          type="range"
          min={20}
          max={100}
          value={Math.round(rug.opacity * 100)}
          onPointerDown={beginGesture}
          onPointerUp={endGesture}
          onChange={(e) => updateRug(rug.id, { opacity: Number(e.target.value) / 100 })}
        />
      </label>

      <div className="field">
        <span>Perspective</span>
        <div className="row gap wrap">
          <button className={`btn small ${mode === 'cornerPin' ? 'primary' : ''}`} onClick={() => setMode(mode === 'cornerPin' ? 'select' : 'cornerPin')}>
            <Icon name="perspective" size={15} /> {mode === 'cornerPin' ? 'Done adjusting' : 'Adjust corners'}
          </button>
          {pinned && (
            <button className="btn small" onClick={() => updateRug(rug.id, { perspective: ZERO_CORNERS }, { record: true })}>
              Reset to auto
            </button>
          )}
        </div>
        <span className="muted tiny">Perspective follows the detected floor automatically. Fine-tune corners if needed.</span>
      </div>

      <div className="row gap wrap">
        <button className="btn small" onClick={() => reorder(rug.id, 'front')} title="Bring to front (Shift+])">
          <Icon name="front" size={15} /> Front
        </button>
        <button className="btn small" onClick={() => reorder(rug.id, 'back')} title="Send to back (Shift+[)">
          <Icon name="back" size={15} /> Back
        </button>
        <button className="btn small" onClick={() => duplicateRug(rug.id)} title="Duplicate (Ctrl+D)">
          <Icon name="copy" size={15} /> Duplicate
        </button>
        <button className="btn small danger" onClick={() => deleteRug(rug.id)} title="Delete (Del)">
          <Icon name="trash" size={15} /> Delete
        </button>
      </div>
    </section>
  )
}
