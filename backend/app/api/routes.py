import logging
import re

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.core.errors import AnalysisFailedError, AppError, ImageTooLargeError
from app.core.limiter import limiter
from app.services.analyzer import analyze
from app.services.image_io import load_image

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")
media_router = APIRouter()
UPLOAD_NAME = re.compile(r"[a-z0-9-]+\.(jpg|png)")


@router.get("/health")
def health(request: Request) -> dict:
    return {"status": "ok", "models": request.app.state.models.status()}


@router.get("/products")
def products(request: Request) -> dict:
    return request.app.state.catalog.read()


@router.post("/analyze")
@limiter.limit(lambda: get_settings().rate_limit)
async def analyze_room(request: Request, image: UploadFile = File(...)) -> dict:
    settings = get_settings()
    # Read at most limit+1 bytes so an oversized upload can't exhaust memory.
    data = await image.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise ImageTooLargeError(f"This image is larger than {settings.max_upload_mb:g} MB. Please upload a smaller photo.")

    loaded = load_image(data, settings.max_upload_bytes, settings.max_pixels)
    try:
        return await run_in_threadpool(analyze, loaded, request.app.state.models, settings.work_long_edge)
    except AppError:
        raise
    except Exception as exc:  # model/geometry failure -> friendly error, details in logs
        log.exception("Analysis failed")
        raise AnalysisFailedError() from exc


@media_router.get("/static/uploads/{name}")
def uploaded_image(request: Request, name: str) -> FileResponse:
    """Rug images uploaded by the store owner. Names are unique per upload, so they cache forever."""
    path = request.app.state.catalog.upload_dir / name
    if not UPLOAD_NAME.fullmatch(name) or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
