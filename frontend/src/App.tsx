import { useRoomStore } from './store/roomStore'
import { useUIStore } from './store/uiStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { Toolbar } from './components/Toolbar'
import { RoomStage } from './components/stage/RoomStage'
import { UploadScreen } from './components/upload/UploadScreen'
import { AnalysisError, AnalysisProgress, NoFloorBanner } from './components/upload/AnalysisStatus'
import { RugLibrary } from './components/panels/RugLibrary'
import { Inspector } from './components/panels/Inspector'
import { LayersPanel } from './components/panels/LayersPanel'
import { RoomPanel } from './components/panels/RoomPanel'
import { CartDrawer } from './components/CartDrawer'
import { ZoomControls } from './components/stage/ZoomControls'
import { Toasts } from './components/ui/Toasts'
import { ErrorBoundary } from './components/ui/ErrorBoundary'

export default function App() {
  useKeyboardShortcuts()
  const status = useRoomStore((s) => s.status)
  const hasImage = useRoomStore((s) => !!s.image)
  const mobileTab = useUIStore((s) => s.mobileTab)
  const setMobileTab = useUIStore((s) => s.setMobileTab)
  const mode = useUIStore((s) => s.mode)

  return (
    <div className="app">
      <Toolbar />
      <main className={`layout tab-${mobileTab}`}>
        <aside className="sidebar left" data-tab="library">
          <RugLibrary />
        </aside>

        <section className="workspace">
          <div className="stage-wrap">
            {status === 'empty' || (status === 'error' && !hasImage) ? (
              <>
                <UploadScreen />
                <AnalysisError />
              </>
            ) : (
              <>
                <ErrorBoundary label="room preview">
                  <RoomStage />
                </ErrorBoundary>
                <AnalysisProgress />
                <AnalysisError />
                <ZoomControls />
              </>
            )}
          </div>
          <NoFloorBanner />
          {status === 'ready' && (
            <p className="hint">
              {mode === 'calibrate'
                ? 'Calibration: drag the 4 points onto the corners of a square on the floor, then Apply.'
                : mode === 'cornerPin'
                  ? 'Perspective: drag the square handles to fine-tune the rug corners.'
                  : 'Click a rug to select · drag to move · corners to resize · top knob to rotate · two fingers to pinch/twist'}
            </p>
          )}
        </section>

        <aside className="sidebar right">
          <div data-tab="edit">
            <Inspector />
            <RoomPanel />
          </div>
          <div data-tab="layers">
            <LayersPanel />
          </div>
        </aside>
      </main>

      <nav className="mobile-tabs" aria-label="Panels">
        {(['library', 'edit', 'layers'] as const).map((t) => (
          <button key={t} className={mobileTab === t ? 'on' : ''} onClick={() => setMobileTab(t)}>
            {t === 'library' ? 'Rugs' : t === 'edit' ? 'Edit' : 'Layers'}
          </button>
        ))}
      </nav>

      <CartDrawer />
      <Toasts />
    </div>
  )
}
