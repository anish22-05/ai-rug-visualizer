"""Owner (admin) catalogue API: auth, validation, create / update / delete, image handling."""

import io
import json
import os

os.environ["LAZY_MODELS"] = "true"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services.catalog import Catalog  # noqa: E402

TOKEN = "test-owner-key"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", TOKEN)
    # Starlette's State doesn't round-trip through monkeypatch, so swap it by hand.
    original = app.state.catalog
    app.state.catalog = Catalog(tmp_path / "catalog.json", tmp_path / "uploads")
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.state.catalog = original


def png(w=300, h=450, alpha=False) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA" if alpha else "RGB", (w, h), (180, 90, 60, 255) if alpha else (180, 90, 60)).save(buf, "PNG")
    return buf.getvalue()


def product(**over) -> str:
    base = {
        "name": "Indigo Kilim",
        "description": "Hand-woven indigo kilim with a stepped border.",
        "material": "Wool",
        "price": 7999,
        "shape": "rectangle",
        "sizes": [{"width": 160, "height": 230, "priceDelta": 0}, {"width": 200, "height": 300, "priceDelta": 3000}],
    }
    return json.dumps({**base, **over})


def create(client, **over):
    return client.post("/api/v1/admin/products", headers=AUTH,
                       data={"product": product(**over)}, files={"image": ("rug.png", png(), "image/png")})


def test_requires_token(client):
    assert client.get("/api/v1/admin/session").status_code == 401
    r = client.get("/api/v1/admin/session", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401 and r.json()["code"] == "unauthorized"
    assert client.get("/api/v1/admin/session", headers=AUTH).json() == {"ok": True}


def test_disabled_without_admin_token(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "admin_token", "")
    r = client.get("/api/v1/admin/session", headers=AUTH)
    assert r.status_code == 503 and r.json()["code"] == "owner_tools_disabled"


def test_create_adds_product_to_public_catalogue(client):
    before = len(client.get("/api/v1/products").json()["products"])
    r = create(client)
    assert r.status_code == 201
    p = r.json()
    assert p["id"].startswith("indigo-kilim-")
    assert [s["label"] for s in p["sizes"]] == ["160 × 230 cm", "200 × 300 cm"]
    assert p["image"].startswith("/static/uploads/") and p["image"].endswith(".jpg")

    products = client.get("/api/v1/products").json()["products"]
    assert len(products) == before + 1 and products[-1]["id"] == p["id"]
    # The uploaded texture and thumbnail are served.
    assert client.get(p["image"]).status_code == 200
    thumb = Image.open(io.BytesIO(client.get(p["thumbnail"]).content))
    assert max(thumb.size) == 256


def test_png_transparency_is_kept(client):
    r = client.post("/api/v1/admin/products", headers=AUTH, data={"product": product()},
                    files={"image": ("rug.png", png(alpha=True), "image/png")})
    assert r.json()["image"].endswith(".png")


def test_round_rugs_get_square_sizes(client):
    p = create(client, shape="round", sizes=[{"width": 180, "height": 120}]).json()
    assert p["sizes"][0]["height"] == 180 and p["sizes"][0]["label"] == "Ø 180 cm"


@pytest.mark.parametrize("over, fragment", [
    ({"name": ""}, "name"),
    ({"price": 0}, "price"),
    ({"sizes": []}, "sizes"),
    ({"sizes": [{"width": 10, "height": 230}]}, "width"),
    ({"price": 1000, "sizes": [{"width": 160, "height": 230, "priceDelta": -2000}]}, "price above zero"),
])
def test_validation_errors_are_friendly(client, over, fragment):
    r = create(client, **over)
    assert r.status_code == 422 and r.json()["code"] == "invalid_product"
    assert fragment in r.json()["message"]


def test_create_requires_a_real_image(client):
    r = client.post("/api/v1/admin/products", headers=AUTH, data={"product": product()})
    assert r.status_code == 400 and "photo" in r.json()["message"]
    r = client.post("/api/v1/admin/products", headers=AUTH, data={"product": product()},
                    files={"image": ("rug.png", b"not an image", "image/png")})
    assert r.status_code == 400 and r.json()["code"] == "invalid_image"


def test_update_keeps_image_unless_replaced(client, tmp_path):
    p = create(client).json()
    r = client.put(f"/api/v1/admin/products/{p['id']}", headers=AUTH,
                   data={"product": product(name="Indigo Kilim II", price=8499)})
    assert r.status_code == 200
    assert r.json()["name"] == "Indigo Kilim II" and r.json()["image"] == p["image"]

    r = client.put(f"/api/v1/admin/products/{p['id']}", headers=AUTH, data={"product": product()},
                   files={"image": ("new.png", png(400, 400), "image/png")})
    assert r.json()["image"] != p["image"]
    # The replaced upload is cleaned up.
    assert not (tmp_path / "uploads" / p["image"].rsplit("/", 1)[1]).exists()


def test_delete_and_missing_product(client, tmp_path):
    p = create(client).json()
    assert client.delete(f"/api/v1/admin/products/{p['id']}", headers=AUTH).status_code == 204
    ids = [x["id"] for x in client.get("/api/v1/products").json()["products"]]
    assert p["id"] not in ids
    assert list((tmp_path / "uploads").iterdir()) == []
    r = client.delete(f"/api/v1/admin/products/{p['id']}", headers=AUTH)
    assert r.status_code == 404 and r.json()["code"] == "product_not_found"


def test_built_in_rug_can_be_edited_without_touching_its_static_image(client):
    seed = client.get("/api/v1/products").json()["products"][0]
    r = client.put(f"/api/v1/admin/products/{seed['id']}", headers=AUTH,
                   data={"product": product(name="Renamed Beige")})
    assert r.json()["image"] == seed["image"]
    client.delete(f"/api/v1/admin/products/{seed['id']}", headers=AUTH)
    assert client.get(seed["image"]).status_code == 200  # seed files are never deleted
