import { useRef, useState } from 'react'
import { useRoomStore } from '../../store/roomStore'
import { MAX_FILE_MB } from '../../lib/imagePrep'
import { Icon } from '../ui/Icon'

const SAMPLES = [
  { name: 'Living room', file: 'living-room.jpg' },
  { name: 'Tiled room', file: 'tiled-room.jpg' },
  { name: 'Dining area', file: 'dining.jpg' },
  { name: 'Portrait shot', file: 'portrait.jpg' },
]

export function UploadScreen() {
  const loadFile = useRoomStore((s) => s.loadFile)
  const loadSample = useRoomStore((s) => s.loadSample)
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const pick = (files: FileList | null) => {
    if (files?.[0]) void loadFile(files[0])
  }

  return (
    <div className="upload">
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          pick(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <div className="dropzone-icon">
          <Icon name="upload" size={30} />
        </div>
        <h2>Upload a photo of your room</h2>
        <p>Drop a JPG or PNG here, or click to browse. Max {MAX_FILE_MB} MB.</p>
        <p className="muted small">Tip: shoot from standing height with plenty of floor visible.</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          hidden
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      <div className="samples">
        <span className="muted small">No photo handy? Try a sample room:</span>
        <div className="sample-grid">
          {SAMPLES.map((s) => (
            <button key={s.file} className="sample" onClick={() => loadSample(`/samples/${s.file}`, s.file)}>
              <img src={`/samples/${s.file}`} alt={s.name} loading="lazy" />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
