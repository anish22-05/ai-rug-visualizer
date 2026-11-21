import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Two entry points share one build: the customer visualizer at "/" and the store
// owner's catalogue dashboard at "/admin" (loaded on demand).
const AdminApp = lazy(() => import('./admin/AdminApp'))
const isAdmin = /^\/admin\/?$/.test(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
