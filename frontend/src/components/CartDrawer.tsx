import { useUIStore } from '../store/uiStore'
import { findProduct, formatINR, useProductStore } from '../store/productStore'
import { Icon } from './ui/Icon'

/** Demo cart (bonus product feature): no checkout, just shows the selection and total. */
export function CartDrawer() {
  const open = useUIStore((s) => s.cartOpen)
  const cart = useUIStore((s) => s.cart)
  const setOpen = useUIStore((s) => s.setCartOpen)
  const remove = useUIStore((s) => s.removeFromCart)
  const products = useProductStore((s) => s.products)
  if (!open) return null
  const total = cart.reduce((s, i) => s + i.price, 0)
  return (
    <div className="drawer-backdrop" onClick={() => setOpen(false)}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Cart">
        <header className="row between">
          <h2>Your cart</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        {!cart.length && <p className="muted">Your cart is empty. Place rugs in your room, then "Add all to cart".</p>}
        <ul className="cart-list">
          {cart.map((item, i) => {
            const p = findProduct(products, item.productId)
            return (
              <li key={i}>
                <img src={p?.thumbnail} alt="" />
                <div>
                  <strong>{p?.name}</strong>
                  <span className="muted small">
                    {item.width} × {item.height} cm{item.sizeId === 'custom' ? ' (custom)' : ''}
                  </span>
                </div>
                <span className="price">{formatINR(item.price)}</span>
                <button className="icon-btn" onClick={() => remove(i)} aria-label="Remove">
                  <Icon name="trash" size={15} />
                </button>
              </li>
            )
          })}
        </ul>
        {cart.length > 0 && (
          <footer>
            <div className="row between">
              <span>Total</span>
              <strong>{formatINR(total)}</strong>
            </div>
            <button className="btn primary block" onClick={() => alert('Demo only: checkout is not implemented.')}>
              Checkout (demo)
            </button>
          </footer>
        )}
      </aside>
    </div>
  )
}
