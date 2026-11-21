import { useEffect, useMemo, useState } from 'react'
import type { Product, RugShape } from '../types'
import { ApiError } from '../lib/api'
import { saveProduct, type ProductInput } from '../lib/adminApi'
import { formatINR } from '../store/productStore'
import { MAX_RUG_CM, MIN_RUG_CM } from '../lib/geometry/rugGeometry'
import { Icon } from '../components/ui/Icon'

interface SizeRow {
  width: string
  height: string
  priceDelta: string
}

const SHAPES: { id: RugShape; label: string }[] = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'runner', label: 'Runner' },
  { id: 'round', label: 'Round' },
]

const MAX_IMAGE_MB = 15

interface Props {
  token: string
  product: Product | null // null = new rug
  onSaved: (p: Product, created: boolean) => void
  onCancel: () => void
  onError: (message: string) => void
}

/** Add / edit form. Produces a ProductInput; size ids and labels come from the backend. */
export function ProductForm({ token, product, onSaved, onCancel, onError }: Props) {
  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [material, setMaterial] = useState(product?.material ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [shape, setShape] = useState<RugShape>(product?.shape ?? 'rectangle')
  const [sizes, setSizes] = useState<SizeRow[]>(
    product?.sizes.map((s) => ({ width: String(s.width), height: String(s.height), priceDelta: String(s.priceDelta) })) ?? [
      { width: '160', height: '230', priceDelta: '0' },
    ],
  )
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : (product?.image ?? '')), [file, product])
  useEffect(() => () => void (file && URL.revokeObjectURL(preview)), [file, preview])

  const round = shape === 'round'
  const basePrice = Number(price) || 0

  const setSize = (i: number, patch: Partial<SizeRow>) => setSizes((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  /** Client-side checks; the server validates again and its message wins. */
  const validate = (): string | ProductInput => {
    if (name.trim().length < 2) return 'Give the rug a name (at least 2 characters).'
    if (!(basePrice >= 1)) return 'Enter a base price above zero.'
    const parsed = sizes.map((s) => ({
      width: Number(s.width),
      height: round ? Number(s.width) : Number(s.height),
      priceDelta: Number(s.priceDelta) || 0,
    }))
    const inRange = (v: number) => Number.isFinite(v) && v >= MIN_RUG_CM && v <= MAX_RUG_CM
    if (parsed.some((s) => !inRange(s.width) || !inRange(s.height))) return `Sizes must be between ${MIN_RUG_CM} and ${MAX_RUG_CM} cm.`
    if (parsed.some((s) => basePrice + s.priceDelta < 1)) return 'Every size must end up with a price above zero.'
    if (!product && !file) return 'Add a photo of the rug.'
    return { name: name.trim(), description: description.trim(), material: material.trim(), price: basePrice, shape, sizes: parsed }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const input = validate()
    if (typeof input === 'string') {
      setError(input)
      return
    }
    setError('')
    setBusy(true)
    try {
      const saved = await saveProduct(token, input, file, product?.id)
      onSaved(saved, !product)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save this rug.'
      setError(message)
      if (err instanceof ApiError && err.status === 401) onError('Your owner session has expired. Please sign in again.')
    } finally {
      setBusy(false)
    }
  }

  const pickFile = (f: File | undefined) => {
    if (!f) return
    if (!/^image\/(jpeg|png)$/.test(f.type)) return setError('Please choose a JPG or PNG image.')
    if (f.size > MAX_IMAGE_MB * 1024 * 1024) return setError(`Please choose an image under ${MAX_IMAGE_MB} MB.`)
    setError('')
    setFile(f)
  }

  return (
    <form className="panel admin-form" onSubmit={submit} noValidate>
      <header className="panel-head">
        <h2>{product ? `Edit "${product.name}"` : 'Add a new rug'}</h2>
        {product && (
          <button type="button" className="btn small ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </header>

      <div className="admin-form-grid">
        <div>
          <label className="field">
            <span>Name</span>
            <span className="input-wrap">
              <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Indigo Kilim" />
            </span>
          </label>
          <label className="field">
            <span>
              Description <em className="muted">{description.length}/400</em>
            </span>
            <textarea
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={400}
              rows={3}
              placeholder="Colours, pattern, feel. Shown to customers in the library."
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Material</span>
              <span className="input-wrap">
                <input name="material" value={material} onChange={(e) => setMaterial(e.target.value)} maxLength={80} placeholder="e.g. Hand-knotted wool" />
              </span>
            </label>
            <label className="field">
              <span>Base price</span>
              <span className="input-wrap">
                <em>₹</em>
                <input name="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="7999" />
              </span>
            </label>
          </div>

          <div className="field">
            <span>Shape</span>
            <div className="chips">
              {SHAPES.map((s) => (
                <button type="button" key={s.id} className={`chip ${shape === s.id ? 'on' : ''}`} onClick={() => setShape(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Sizes</span>
            <table className="size-table">
              <thead>
                <tr>
                  <th>{round ? 'Diameter (cm)' : 'Width (cm)'}</th>
                  {!round && <th>Length (cm)</th>}
                  <th>Price change (₹)</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {sizes.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <input aria-label={`Size ${i + 1} width`} inputMode="numeric" value={s.width} onChange={(e) => setSize(i, { width: e.target.value })} />
                    </td>
                    {!round && (
                      <td>
                        <input aria-label={`Size ${i + 1} length`} inputMode="numeric" value={s.height} onChange={(e) => setSize(i, { height: e.target.value })} />
                      </td>
                    )}
                    <td>
                      <input aria-label={`Size ${i + 1} price change`} inputMode="numeric" value={s.priceDelta} onChange={(e) => setSize(i, { priceDelta: e.target.value })} />
                    </td>
                    <td>
                      <button type="button" className="icon-btn" aria-label={`Remove size ${i + 1}`} disabled={sizes.length === 1} onClick={() => setSizes((rows) => rows.filter((_, j) => j !== i))}>
                        <Icon name="close" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sizes.length < 6 && (
              <button type="button" className="btn small" onClick={() => setSizes((rows) => [...rows, { width: '200', height: '300', priceDelta: '0' }])}>
                <Icon name="plus" size={14} /> Add size
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="field">
            <span>Rug photo</span>
            <label className={`image-drop ${preview ? 'has' : ''}`}>
              {preview ? <img src={preview} alt="Rug preview" /> : <Icon name="upload" size={26} />}
              <span className="small">{preview ? 'Replace photo' : 'Choose a JPG or PNG'}</span>
              <input type="file" name="image" accept="image/jpeg,image/png" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
            </label>
            <span className="muted tiny">Top-down photo, cropped to the rug's edges. PNG transparency is kept (fringes, round rugs).</span>
          </div>

          <div className="field">
            <span>Customers will see</span>
            <div className="product preview-card">
              <span className="thumb">{preview ? <img src={preview} alt="" /> : <span className="muted tiny">No photo yet</span>}</span>
              <span className="product-name">{name.trim() || 'Rug name'}</span>
              <span className="product-meta">
                <span className="price">{formatINR(basePrice)}</span>
                <span className="muted small">{sizes.length} sizes</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary block" disabled={busy}>
        {busy ? 'Saving…' : product ? 'Save changes' : 'Add rug to catalogue'}
      </button>
    </form>
  )
}
