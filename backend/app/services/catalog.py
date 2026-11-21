"""Product catalogue: the built-in rugs plus the ones the store owner manages.

The seed catalogue (`app/data/products.json`) ships with the code and is never
modified. The first owner edit copies it to `catalog_path`, which is the live
catalogue from then on. Uploaded rug images are stored in `upload_dir` and served
at `/static/uploads/`.

Writes are serialised with a lock and made atomic (temp file + `os.replace`), so
a crash mid-write can't leave a half-written catalogue.
"""

import copy
import json
import os
import re
import threading
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import ImageTooLargeError, InvalidImageError, ProductNotFoundError

SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "products.json"
UPLOAD_URL_PREFIX = "/static/uploads"
TEXTURE_LONG_EDGE = 2048   # rug texture; the renderer mipmaps it
THUMB_LONG_EDGE = 256      # library thumbnail
MIN_IMAGE_EDGE = 64


class Catalog:
    def __init__(self, path: Path, upload_dir: Path, seed: Path = SEED_FILE):
        self.path = path
        self.upload_dir = upload_dir
        self.seed = seed
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ reads
    def read(self) -> dict[str, Any]:
        source = self.path if self.path.exists() else self.seed
        return json.loads(source.read_text(encoding="utf-8"))

    def get(self, product_id: str) -> dict[str, Any]:
        for p in self.read()["products"]:
            if p["id"] == product_id:
                return p
        raise ProductNotFoundError()

    # ----------------------------------------------------------------- writes
    def create(self, fields: dict[str, Any], image: bytes, max_pixels: int) -> dict[str, Any]:
        """Add a product. `fields` is validated input (name, price, sizes, ...)."""
        with self._lock:
            data = self.read()
            product_id = _new_id(fields["name"], {p["id"] for p in data["products"]})
            product = {"id": product_id, **fields}
            product.update(self._save_images(product_id, image, max_pixels))
            data["products"].append(product)
            self._write(data)
            return product

    def update(self, product_id: str, fields: dict[str, Any], image: bytes | None, max_pixels: int) -> dict[str, Any]:
        """Replace a product's details, and its image when a new one is given."""
        with self._lock:
            data = self.read()
            index = _index_of(data, product_id)
            old = data["products"][index]
            product = {"id": product_id, **fields, "image": old["image"], "thumbnail": old["thumbnail"]}
            if image is not None:
                product.update(self._save_images(product_id, image, max_pixels))
            data["products"][index] = product
            self._write(data)
            if image is not None:
                self._remove_uploaded(old)
            return product

    def delete(self, product_id: str) -> None:
        with self._lock:
            data = self.read()
            old = data["products"].pop(_index_of(data, product_id))
            self._write(data)
            self._remove_uploaded(old)

    # ---------------------------------------------------------------- helpers
    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)

    def _save_images(self, product_id: str, data: bytes, max_pixels: int) -> dict[str, str]:
        img = decode_product_image(data, max_pixels)
        # A fresh suffix per upload, so browsers never show a cached old texture.
        stem = f"{product_id}-{uuid.uuid4().hex[:8]}"
        has_alpha = img.mode == "RGBA"
        ext, fmt, opts = (".png", "PNG", {"optimize": True}) if has_alpha else (".jpg", "JPEG", {"quality": 90})
        self.upload_dir.mkdir(parents=True, exist_ok=True)

        texture = _fit(img, TEXTURE_LONG_EDGE)
        texture.save(self.upload_dir / f"{stem}{ext}", fmt, **opts)
        thumb = _fit(img, THUMB_LONG_EDGE)
        thumb.save(self.upload_dir / f"{stem}-thumb{ext}", fmt, **opts)
        return {
            "image": f"{UPLOAD_URL_PREFIX}/{stem}{ext}",
            "thumbnail": f"{UPLOAD_URL_PREFIX}/{stem}-thumb{ext}",
        }

    def _remove_uploaded(self, product: dict[str, Any]) -> None:
        """Delete a product's image files, but only ones the owner uploaded."""
        for key in ("image", "thumbnail"):
            url = product.get(key, "")
            if url.startswith(UPLOAD_URL_PREFIX + "/"):
                name = Path(url).name  # never trust a path from the file
                (self.upload_dir / name).unlink(missing_ok=True)


def decode_product_image(data: bytes, max_pixels: int) -> Image.Image:
    """Decode an uploaded rug photo (JPEG/PNG only). Keeps transparency for PNGs."""
    if not data:
        raise InvalidImageError()
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        img = Image.open(BytesIO(data))
        if img.format not in {"JPEG", "PNG"}:
            raise InvalidImageError()
        if img.width * img.height > max_pixels:
            raise ImageTooLargeError()
        img = ImageOps.exif_transpose(img)
        has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
        img = img.convert("RGBA" if has_alpha else "RGB")
    except Image.DecompressionBombError as exc:
        raise ImageTooLargeError() from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError() from exc
    if min(img.size) < MIN_IMAGE_EDGE:
        raise InvalidImageError("This rug photo is too small. Please upload one at least 64 px on each side.")
    return img


def _fit(img: Image.Image, long_edge: int) -> Image.Image:
    scale = min(1.0, long_edge / max(img.size))
    if scale >= 1.0:
        return copy.copy(img)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(size, Image.Resampling.LANCZOS)


def _index_of(data: dict[str, Any], product_id: str) -> int:
    for i, p in enumerate(data["products"]):
        if p["id"] == product_id:
            return i
    raise ProductNotFoundError()


def _new_id(name: str, taken: set[str]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32] or "rug"
    while True:
        candidate = f"{slug}-{uuid.uuid4().hex[:4]}"
        if candidate not in taken:
            return candidate
