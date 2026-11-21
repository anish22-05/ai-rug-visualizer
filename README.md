# SpaceStyler: Room Visualizer

A store owner publishes rugs. A customer uploads a photo of their own room, and the app detects the floor and lets them place those rugs so they **lie on the floor at true size, in correct perspective**. Rugs can be moved, resized, rotated, layered, removed, undone and exported.

![Demo: the owner adds a rug, then a customer places it in their room](docs/demo/spacestyler-demo.gif)

▶ **[Full demo video (MP4, 87 s, with captions)](docs/demo/spacestyler-demo.mp4)**. Part 1: the store owner signs in, adds a new rug with a description, sizes and prices, and uploads its photo. Part 2: a customer finds that rug in the library, uploads a room photo, inspects the AI floor detection, places the rug under a dining table (the table and chair legs stay in front of it), moves, resizes and rotates it, switches size (the price updates), adds a second rug, uses undo, and downloads the result.

## How it fits together

![System overview: owner dashboard and customer visualizer in the browser; owner API, catalogue store and room-analysis pipeline on the server](docs/diagrams/system-overview.svg)

The analysis is **one request per photo**. Everything after that (every drag, resize, undo and the export) runs in the browser without another round trip. More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Features

**Customer (`/`)**
- Upload a JPG/PNG room photo (or pick a sample room). It's validated, EXIF-rotated and downscaled in the browser.
- AI floor detection: segmentation (EoMT-L) plus metric depth (Depth Anything V2) gives the floor area *and* its orientation. A debug view shows the mask, the outline, a 50 cm floor grid and the horizon.
- Place rugs by click or drag-and-drop. They appear at real size (for example 160 × 230 cm), in perspective.
- Move, resize (aspect-locked; Shift for free), rotate on the floor, corner-pin fine-tuning, pinch/twist on touch.
- Realism: furniture standing on the floor stays in front of the rug; the rug picks up the room's floor shading and light colour; soft contact shadow.
- Multiple rugs with layering, duplicate, delete, undo/redo per gesture, keyboard shortcuts.
- Size presets with per-size prices, a running total and a demo cart.
- Full-resolution PNG/JPEG export.
- Manual floor calibration (4 points on a known square) when no floor is detected.

**Store owner (`/admin`)**
- Sign in with an owner access key (the server's `ADMIN_TOKEN`).
- Add, edit and delete rugs: name, description, material, base price, shape, any number of sizes (cm) with a price change per size, and a photo.
- Live "customers will see" preview card. The photo becomes a texture (≤ 2048 px) and a thumbnail (256 px). PNG transparency is kept for fringes and round rugs.
- Changes appear in the customer library straight away (the library refreshes when its tab regains focus).

## Screenshots

| Owner: add a rug | Owner: rug added |
|---|---|
| ![Add rug form](docs/screenshots/owner-03-add-rug-form.jpg) | ![Rug added](docs/screenshots/owner-04-rug-added.jpg) |
| **Customer: floor detection (debug view)** | **Customer: new rug placed at true size** |
| ![Floor detection](docs/screenshots/customer-04-floor-detection.jpg) | ![Rug placed](docs/screenshots/customer-05-rug-placed.jpg) |
| **Moved under the table, resized, rotated** | **Two rugs layered, with total** |
| ![Moved, resized, rotated](docs/screenshots/customer-06-moved-resized-rotated.jpg) | ![Multiple rugs](docs/screenshots/customer-08-multiple-rugs.jpg) |

More: [exported image](docs/screenshots/customer-09-exported.jpg), [size switch and price update](docs/screenshots/customer-07-inspector-sizes.jpg), [owner sign-in](docs/screenshots/owner-01-sign-in.jpg), [invalid upload](docs/screenshots/07-invalid-upload.jpg), [no floor detected](docs/screenshots/08-no-floor.jpg), [manual calibration](docs/screenshots/09-manual-calibration.jpg), [mobile](docs/screenshots/10-mobile.jpg). Per-room detection overlays for all sample photos: [docs/debug/](docs/debug/).

---

## Core idea

**Rugs live on the floor plane, not in pixels.** The backend estimates the camera's view of the floor and returns a homography **H** that maps floor coordinates (centimetres) to image pixels. Each rug is stored as a real-world rectangle on the floor:

```json
{
  "id": "rug_001",
  "productId": "product_03",
  "name": "Classic Pattern Rug",
  "x": 12.5, "y": -40,
  "width": 160, "height": 230,
  "rotation": 15,
  "perspective": { "topLeft": {"x":0,"y":0}, "topRight": {...}, "bottomRight": {...}, "bottomLeft": {...} },
  "zIndex": 2
}
```

`x`, `y` are the centre on the floor in cm; `width`, `height` the real size in cm; `rotation` is in degrees on the floor; `perspective` holds optional manual corner-pin offsets in image pixels.

The rug's on-screen quad is **derived** by projecting its four floor corners through H. So:
- Perspective is exact for any position, size or rotation. A rug shrinks as you drag it away from the camera.
- Rotation happens *on the floor*, so it never breaks perspective.
- Rugs render at true scale: a 160 × 230 cm rug looks 160 × 230 cm next to the sofa.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite, Zustand (+ immer), WebGL2 (custom compositor and GLSL shaders), SVG overlay |
| Backend | Python, FastAPI, PyTorch, Hugging Face `transformers`, OpenCV, NumPy, Pillow, pydantic |
| Models | **EoMT-L (ADE20K)** semantic segmentation (SegFormer-B2 as a faster fallback); **Depth Anything V2 Metric-Indoor-Small** monocular depth. Open weights, run locally. |
| Tests | pytest (geometry, masks, shading, API, owner API), Vitest (geometry, state), Playwright (end-to-end flows and the recorded demo) |

## Installation

Prerequisites: Node 20+ and Python 3.11+. A GPU is optional.

```bash
# Backend
cd backend
python -m venv .venv
.venv/Scripts/activate           # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements-dev.txt

# Frontend
cd ../frontend
npm install
```

The first backend start downloads the models (about 1.4 GB) from Hugging Face into the local cache.

## Environment variables

The analysis API needs no secrets or API keys: every model runs inside the service. The only secret is `ADMIN_TOKEN`, and only if you enable the owner dashboard. See `backend/.env.example` and `frontend/.env.example`.

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `ADMIN_TOKEN` | backend | empty | Owner access key for `/admin`. **Empty = owner API disabled.** Use a long random value. |
| `CATALOG_PATH`, `UPLOAD_DIR` | backend | `backend/var/…` | Where owner edits and uploaded rug photos are stored (must be writable; use a persistent volume in production) |
| `ALLOWED_ORIGINS` | backend | `http://localhost:5173,…` | CORS allow-list (add your deployed frontend URL) |
| `MAX_UPLOAD_MB` | backend | `15` | Upload size limit |
| `MAX_PIXELS` | backend | `40000000` | Decompression-bomb guard |
| `WORK_LONG_EDGE` | backend | `1024` | Resolution the CV pipeline works at |
| `SEG_MODEL`, `DEPTH_MODEL` | backend | see `.env.example` | Hugging Face model ids |
| `DEVICE` | backend | `auto` | `auto` / `cpu` / `cuda` |
| `RATE_LIMIT` | backend | `30/minute` | Per-client limit on `/analyze` |
| `VITE_API_BASE_URL` | frontend (build) | empty | API origin in production (empty = same origin / dev proxy) |
| `VITE_DEV_BACKEND` | frontend (dev) | `http://127.0.0.1:8000` | Where the Vite dev proxy forwards `/api` and `/static` |

## How to run

```bash
# Terminal 1: API on :8000 (ADMIN_TOKEN enables the owner dashboard)
cd backend && ADMIN_TOKEN=choose-a-long-random-key .venv/Scripts/python -m uvicorn app.main:app --port 8000

# Terminal 2: app on :5173 (proxies /api and /static to :8000)
cd frontend && npm run dev
```

- Customer view: http://localhost:5173. Upload a photo or click a sample room.
- Owner dashboard: http://localhost:5173/admin. Sign in with the `ADMIN_TOKEN` value.

**Docker (full stack):** `ADMIN_TOKEN=… docker compose up --build`, then open http://localhost:8080 (owner: `/admin`). Owner edits live in a named volume, so they survive rebuilds.

**Tests:**
```bash
cd backend  && .venv/Scripts/python -m pytest -q      # 43 tests
cd frontend && npx vitest run                          # 18 tests
cd e2e && npm i && npx playwright install chromium
npm run demo        # customer demo flow (app must be running)
npm run edge        # edge cases
npm run showcase    # records the captioned owner + customer demo video and README screenshots
```

**Deployment.** The frontend is a static build for Vercel or Netlify (`vercel.json` / `public/_redirects` route `/admin` to the app); set `VITE_API_BASE_URL`. The backend ships as `backend/Dockerfile`, a CPU image with the model weights baked in, which runs on a Hugging Face Space (Docker SDK, port 7860), Render, Fly or Cloud Run. Set `ALLOWED_ORIGINS` to the frontend URL, and mount persistent storage at `/app/var` if the owner dashboard is used.

## Floor detection approach

A hybrid of segmentation, depth and geometry. The full write-up is in [docs/TECHNICAL.md](docs/TECHNICAL.md).

1. **Semantic segmentation.** EoMT-L trained on **ADE20K** labels every pixel. ADE20K has explicit `floor` and `rug` classes among 150 categories. The same pass yields walls, ceiling, doors, windows and furniture, which feed the debug view and occlusion.
2. **Two masks (OpenCV).** A *cleaned* mask (morphological open/close, significant components, small holes filled) drives the floor polygon, the confidence check and the geometry. A separate *soft occlusion alpha* (raw floor probability, edge-snapped with a guided filter) keeps stools and table legs, so furniture correctly covers the rug. The confidence check drives the *"Unable to confidently detect the floor"* state.
3. **Floor orientation.** Depth Anything V2 (metric, indoor) gives per-pixel depth. Floor pixels are back-projected to 3-D with the camera intrinsics (EXIF focal length when present), and a **RANSAC plane fit** gives the floor normal and the camera height.
4. **Homography.** Built from the plane: `H = K · [e1/100 | e2/100 | O]`, which maps floor cm to pixels.
5. **Fallbacks.** If the plane fails its plausibility checks, the pitch is estimated from the **vanishing point** of floor lines (LSD + RANSAC). Failing that, a heuristic is used. The method used is always reported.
6. **Manual calibration.** Users can drag 4 points onto a known square on the floor, and the app solves H with a 4-point DLT. This is also the path when no floor is detected.

**Why this approach.** Segmentation alone gives *where* the floor is, but not *how it is oriented*, and perspective needs the orientation. Line and vanishing-point methods fail on plain floors and carpet. Monocular metric depth works on almost any floor texture, and a plane fit over thousands of points is robust and easy to explain. Every model is open and runs on CPU, so there are no API keys and no per-request cost, and photos never leave our own service.

## Perspective and rendering

A rug's four floor corners `(x ± w/2, y ± h/2)`, rotated by `rotation`, are projected through **H**, then any manual corner-pin offsets are added. The renderer computes the homography from the rug texture's unit square to that image quad. In the **fragment shader**, each pixel is mapped back with the inverse homography (`uv = H⁻¹·p`), which is exact projective texture mapping, with no seams from splitting the quad into triangles.

Interaction also happens on the floor: pointer positions are converted to floor cm with H⁻¹, so dragging, resizing and rotating all happen in real-world units. Realism comes from:
- **Occlusion:** the soft floor alpha from the backend, so furniture standing on the floor covers the rug.
- **Floor shading:** a low-resolution shading map computed from the floor's own brightness (filled in under furniture), plus the room's light colour, applied in linear light.
- **Contact shadow:** a soft shadow under the rug's edges.

## Owner dashboard design

- **Auth:** a single owner key (`ADMIN_TOKEN`), sent as a Bearer token and compared in constant time. The sign-in check is rate-limited. If the variable isn't set, the owner API is disabled (503) rather than open.
- **Validation:** pydantic models with friendly messages (sizes 30–1200 cm, positive prices, 1–6 sizes; round rugs get square sizes). Photos are decoded by Pillow (JPEG/PNG only, size and pixel caps), then re-encoded, so uploaded bytes are never served as-is.
- **Storage:** the shipped catalogue is a read-only seed. The first owner edit copies it to `CATALOG_PATH`, written atomically (temp file + rename) under a lock. Each upload gets a unique file name, so images can be cached forever, and replaced or deleted uploads are cleaned up. Built-in images are never deleted.
- **Frontend:** `/admin` is a separate, lazy-loaded bundle (about 12 kB) that shares the customer app's API client and catalogue store.

## Known limitations

- **Single dominant floor plane.** Split-level floors or stairs are not modelled.
- **Assumed focal length when EXIF is missing** (28 mm equivalent). Very wide or telephoto shots skew the scale slightly, and calibration fixes it.
- **Metric scale comes from the depth model.** If the estimated camera height is implausible, it is reset to 1.4 m, so absolute size can be off by about 10–20%.
- **No rug thickness or cast shadows from furniture yet.** Planned in [docs/HANDOFF.md](docs/HANDOFF.md) (Step 3).
- **CPU latency.** About 7 s per photo on a desktop CPU with EoMT-L (segmentation is most of it). `SEG_MODEL=nvidia/segformer-b2-finetuned-ade-512-512` brings that to about 2–3 s, with less precise occlusion.
- **Owner auth is one shared key.** There are no per-user accounts, roles or audit log. Owner data is stored on local disk, so production needs a persistent volume (or a database / object storage).
- The built-in rug textures are procedurally generated demo products (`backend/scripts/generate_rugs.py`); real products are added through the owner dashboard.

## Documentation

| Doc | Contents |
|---|---|
| [docs/MODULES.md](docs/MODULES.md) | Every backend and frontend module: purpose, key functions, coordinate systems (kept up to date) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, state management, API |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | Pipeline and maths: detection → segmentation → placement → transformation → rendering → export |
| [docs/TESTING.md](docs/TESTING.md) | Test suites, floor-detection matrix, edge cases |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Realism upgrade: what's done and what's next (thickness, calibration) |

## Repository layout

```
backend/   FastAPI service: app/api (analysis + owner API), app/services (CV pipeline, catalogue), app/data (seed catalogue), static/rugs, tests, scripts
frontend/  React app: src/admin (owner dashboard), src/lib/geometry (homography maths), src/lib/render (WebGL), src/store, src/components
e2e/       Playwright scripts: demo flow, edge cases, recorded showcase (fixtures/ holds the demo rug)
docs/      MODULES, ARCHITECTURE, TECHNICAL, TESTING, HANDOFF, diagrams/, demo/ (video), screenshots/, debug/, research/
samples/   Test room photos (Unsplash License)
```

Sample room photos are from [Unsplash](https://unsplash.com) and used under the Unsplash License. The demo rug in `e2e/fixtures/` was generated for this project.
