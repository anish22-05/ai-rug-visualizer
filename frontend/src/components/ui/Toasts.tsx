import { useUIStore } from '../../store/uiStore'

export function Toasts() {
  const toasts = useUIStore((s) => s.toasts)
  const dismiss = useUIStore((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
