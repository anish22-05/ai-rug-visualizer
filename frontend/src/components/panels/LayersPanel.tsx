import { selectSortedRugs, useSceneStore } from '../../store/sceneStore'
import { findProduct, formatINR, priceFor, useProductStore } from '../../store/productStore'
import { addSceneToCart } from '../../lib/actions'
import { useShallow } from 'zustand/react/shallow'
import { Icon } from '../ui/Icon'

export function LayersPanel() {
  const rugs = useSceneStore(useShallow(selectSortedRugs))
  const selectedId = useSceneStore((s) => s.selectedId)
  const { select, reorder, deleteRug } = useSceneStore.getState()
  const products = useProductStore((s) => s.products)
  const top = [...rugs].reverse() // top-most first, like design tools
  const total = rugs.reduce((sum, r) => sum + priceFor(findProduct(products, r.productId), r), 0)

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Layers</h2>
        <span className="muted small">{rugs.length} rug{rugs.length === 1 ? '' : 's'}</span>
      </header>
      {!rugs.length && <p className="muted small">Rugs you add appear here. Top of the list = on top.</p>}
      <ul className="layers">
        {top.map((r, i) => (
          <li key={r.id} className={r.id === selectedId ? 'on' : ''}>
            <button className="layer-name" onClick={() => select(r.id)}>
              <img src={findProduct(products, r.productId)?.thumbnail} alt="" />
              <span>
                {r.name}
                <em className="muted tiny">
                  {Math.round(r.width)}×{Math.round(r.height)} cm · z{r.zIndex}
                </em>
              </span>
            </button>
            <span className="layer-actions">
              <button className="icon-btn" disabled={i === 0} onClick={() => reorder(r.id, 'forward')} aria-label="Bring forward" title="Bring forward (])">
                <Icon name="front" size={14} />
              </button>
              <button className="icon-btn" disabled={i === top.length - 1} onClick={() => reorder(r.id, 'backward')} aria-label="Send backward" title="Send backward ([)">
                <Icon name="back" size={14} />
              </button>
              <button className="icon-btn" onClick={() => deleteRug(r.id)} aria-label="Delete" title="Delete">
                <Icon name="trash" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {rugs.length > 0 && (
        <div className="row between total">
          <span>
            Total <strong>{formatINR(total)}</strong>
          </span>
          <button className="btn small primary" onClick={addSceneToCart}>
            <Icon name="cart" size={15} /> Add all to cart
          </button>
        </div>
      )}
    </section>
  )
}
