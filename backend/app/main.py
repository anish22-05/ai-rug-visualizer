"""FastAPI entrypoint for the SpaceStyler room-analysis service."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded

from app.api.admin import router as admin_router
from app.api.routes import media_router, router
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.limiter import limiter
from app.services.catalog import Catalog
from app.services.models import ModelRegistry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
BACKEND_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BACKEND_DIR / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.models = ModelRegistry(settings)
    if not settings.lazy_models:
        app.state.models.warmup()  # load once at boot, not on the first user request
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="SpaceStyler Room Analysis API", version="1.0.0", lifespan=lifespan)
    app.state.limiter = limiter

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message})

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(_: Request, __: RateLimitExceeded):
        return JSONResponse(status_code=429, content={"code": "rate_limited",
                                                      "message": "Too many requests. Please wait a moment and try again."})

    # Live catalogue (owner edits) and uploaded rug images; see services/catalog.py.
    upload_dir = Path(settings.upload_dir) if settings.upload_dir else BACKEND_DIR / "var" / "uploads"
    catalog_path = Path(settings.catalog_path) if settings.catalog_path else BACKEND_DIR / "var" / "catalog.json"
    app.state.catalog = Catalog(catalog_path, upload_dir)

    app.include_router(router)
    app.include_router(admin_router)
    app.include_router(media_router)  # /static/uploads/*, registered before the /static mount
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


app = create_app()
