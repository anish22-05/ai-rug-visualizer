import { useEffect, useState } from 'react'
import type { Product } from '../types'
import { ApiError } from '../lib/api'
import { deleteProduct, verifyOwner } from '../lib/adminApi'
import { formatINR, useProductStore } from '../store/productStore'
import { Icon } from '../components/ui/Icon'
import { ProductForm } from './ProductForm'

const KEY_STORAGE = 'spacestyler.ownerKey'

function readKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

function storeKey(key: string) {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key)
    else sessionStorage.removeItem(KEY_STORAGE)
  } catch {
    // private mode: the key just won't survive a reload
  }
}

/** Store-owner dashboard at /admin: add, edit and remove rugs in the catalogue. */
export default function AdminApp() {
  const [token, setToken] = useState('')
  const [booting, setBooting] = useState(() => !!readKey())

  // Re-use a key from this browser session if it is still valid.
  useEffect(() => {
    const saved = readKey()
    if (!saved) return
    verifyOwner(saved)
      .then(() => setToken(saved))
      .catch(() => storeKey(''))
      .finally(() => setBooting(false))
  }, [])

  const signOut = () => {
    storeKey('')
    setToken('')
  }

  return (
    <div className="admin">
      <header className="toolbar">
        <div className="brand">
          <span className="logo">◩</span>
          <span>
            SpaceStyler <em>Owner dashboard</em>
          </span>
        </div>
        <div className="toolbar-actions">
          <a className="btn ghost" href="/">
            <Icon name="image" size={16} /> <span className="hide-xs">Open customer view</span>
          </a>
          {token && (
            <button className="btn ghost" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      {booting ? null : token ? (
        <Dashboard token={token} />
      ) : (
        <SignIn
          onSignedIn={(key) => {
            storeKey(key)
            setToken(key)
          }}
        />
      )}
    </div>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: (key: string) => void }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await verifyOwner(key.trim())
      onSignedIn(key.trim())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="admin-signin">
      <form className="panel" onSubmit={submit}>
        <h3>Store owner sign-in</h3>
        <p className="muted small">Manage the rugs customers can try in their rooms.</p>
        <label className="field">
          <span>Owner access key</span>
          <span className="input-wrap">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus autoComplete="current-password" name="ownerKey" />
          </span>
        </label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={!key.trim() || busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <p className="muted tiny">The key is the server's ADMIN_TOKEN setting.</p>
      </form>
    </main>
  )
}

type Notice = { kind: 'ok' | 'error'; text: string } | null

function Dashboard({ token }: { token: string }) {
  const { products, status, load, refresh } = useProductStore()
  const [editing, setEditing] = useState<Product | null>(null)
  const [formKey, setFormKey] = useState(0) // remounts the form to clear it
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    void load()
  }, [load])

  const startNew = () => {
    setEditing(null)
    setFormKey((k) => k + 1)
  }

  const onSaved = async (p: Product, created: boolean) => {
    await refresh()
    setNotice({ kind: 'ok', text: created ? `"${p.name}" added. Customers can now place it in their rooms.` : `"${p.name}" updated.` })
    startNew()
  }

  const remove = async (p: Product) => {
    try {
      await deleteProduct(token, p.id)
      await refresh()
      if (editing?.id === p.id) startNew()
      setNotice({ kind: 'ok', text: `"${p.name}" removed from the catalogue.` })
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not delete this rug.' })
    } finally {
      setConfirmId(null)
    }
  }

  return (
    <main className="admin-main">
      <section className="panel admin-list">
        <header className="panel-head">
          <h2>Catalogue · {products.length} rugs</h2>
          <button className="btn small" onClick={startNew}>
            <Icon name="plus" size={14} /> New rug
          </button>
        </header>
        {notice && (
          <p className={`notice ${notice.kind}`} role="status">
            {notice.text}
          </p>
        )}
        {status === 'loading' && <p className="muted">Loading catalogue…</p>}
        {status === 'error' && <p className="inline-error">Couldn't load the catalogue.</p>}
        <ul className="admin-products">
          {products.map((p) => (
            <li key={p.id} className={editing?.id === p.id ? 'on' : ''}>
              <span className="thumb">
                <img src={p.thumbnail} alt="" loading="lazy" />
              </span>
              <div className="admin-product-info">
                <strong>{p.name}</strong>
                <span className="muted small">
                  {formatINR(p.price)} · {p.shape} · {p.sizes.map((s) => s.label).join(', ')}
                </span>
                <span className="muted tiny clamp">{p.material ? `${p.material}. ` : ''}{p.description}</span>
              </div>
              <div className="admin-product-actions">
                {confirmId === p.id ? (
                  <>
                    <button className="btn small danger" onClick={() => void remove(p)}>
                      Confirm delete
                    </button>
                    <button className="btn small ghost" onClick={() => setConfirmId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn small" onClick={() => {
                        setEditing(p)
                        setFormKey((k) => k + 1)
                      }}
                    >
                      Edit
                    </button>
                    <button className="icon-btn" title={`Delete ${p.name}`} aria-label={`Delete ${p.name}`} onClick={() => setConfirmId(p.id)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <ProductForm
        key={formKey}
        token={token}
        product={editing}
        onSaved={(p, created) => void onSaved(p, created)}
        onCancel={startNew}
        onError={(text) => setNotice({ kind: 'error', text })}
      />
    </main>
  )
}
