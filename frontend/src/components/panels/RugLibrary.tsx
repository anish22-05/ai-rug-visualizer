import { useEffect } from 'react'
import { formatINR, useProductStore } from '../../store/productStore'
import { useRoomStore } from '../../store/roomStore'
import { addProductToRoom } from '../../lib/actions'
import { PRODUCT_DRAG_TYPE } from '../stage/RoomStage'

export function RugLibrary() {
  const { products, status, load, refresh } = useProductStore()
  const ready = useRoomStore((s) => s.status === 'ready' && (!!s.analysis?.geometry || !!s.calibration))

  useEffect(() => {
    void load()
  }, [load])

  // Pick up rugs the store owner added (e.g. in another tab) when the page regains focus.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh])

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Rug library</h2>
        <span className="muted small">{ready ? 'Click or drag onto the floor' : 'Upload a room first'}</span>
      </header>
      {status === 'loading' && <p className="muted">Loading products…</p>}
      {status === 'error' && (
        <div className="inline-error">
          Couldn't load the catalogue.{' '}
          <button className="link" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      <ul className="product-grid">
        {products.map((p) => {
          const from = Math.min(...p.sizes.map((s) => p.price + s.priceDelta))
          return (
            <li key={p.id}>
              <button
                className="product"
                disabled={!ready}
                draggable={ready}
                onDragStart={(e) => {
                  e.dataTransfer.setData(PRODUCT_DRAG_TYPE, p.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => addProductToRoom(p.id)}
                title={`${p.name}: ${p.description}`}
              >
                <span className="thumb">
                  <img src={p.thumbnail} alt="" loading="lazy" draggable={false} />
                </span>
                <span className="product-name">{p.name}</span>
                <span className="product-meta">
                  <span className="price">{formatINR(p.price)}</span>
                  <span className="muted small">from {formatINR(from)}</span>
                </span>
                <span className="muted tiny">
                  {p.id} · {p.sizes.length} sizes
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="owner-link muted tiny">
        Store owner? <a href="/admin">Manage the rug catalogue</a>
      </p>
    </section>
  )
}
