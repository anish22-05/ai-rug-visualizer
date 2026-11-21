"""API contract tests. Models are not loaded; the analyzer is stubbed where needed."""

import io
import os

os.environ["LAZY_MODELS"] = "true"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.api import routes  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def jpeg_bytes(w=320, h=240) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 180, 150)).save(buf, "JPEG")
    return buf.getvalue()


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_products_catalog(client):
    data = client.get("/api/v1/products").json()
    assert 5 <= len(data["products"]) <= 8
    for p in data["products"]:
        assert {"id", "name", "price", "image", "thumbnail", "sizes"} <= p.keys()
        assert all(s["width"] > 0 and s["height"] > 0 for s in p["sizes"])


def test_rejects_non_image(client):
    r = client.post("/api/v1/analyze", files={"image": ("room.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400
    assert r.json() == {"code": "invalid_image", "message": "Please upload a valid JPG or PNG image."}


def test_rejects_unsupported_format_even_with_jpg_name(client):
    buf = io.BytesIO()
    Image.new("RGB", (200, 200)).save(buf, "GIF")
    r = client.post("/api/v1/analyze", files={"image": ("room.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 400 and r.json()["code"] == "invalid_image"


def test_rejects_oversized_upload(client, monkeypatch):
    monkeypatch.setattr(routes.get_settings(), "max_upload_mb", 0.001)
    r = client.post("/api/v1/analyze", files={"image": ("room.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 413 and r.json()["code"] == "image_too_large"


def test_processing_failure_is_friendly(client, monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(routes, "analyze", boom)
    r = client.post("/api/v1/analyze", files={"image": ("room.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 500
    assert r.json()["message"] == "We couldn't analyze this room. Please try another image."


def test_analyze_success_passes_through(client, monkeypatch):
    monkeypatch.setattr(routes, "analyze", lambda img, models, edge: {"imageSize": {"width": img.size[0]}})
    r = client.post("/api/v1/analyze", files={"image": ("room.png", jpeg_bytes(400, 300), "image/jpeg")})
    assert r.status_code == 200 and r.json()["imageSize"]["width"] == 400
