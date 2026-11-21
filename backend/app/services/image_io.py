"""Safe image decoding and resizing.

We never trust the filename or Content-Type: Pillow must decode the bytes as a
real JPEG/PNG. EXIF orientation is applied so pixels match what the user sees.
"""

from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.errors import ImageTooLargeError, InvalidImageError

ALLOWED_FORMATS = {"JPEG", "PNG"}
EXIF_FOCAL_35MM = 0xA405  # FocalLengthIn35mmFilm
EXIF_IFD = 0x8769


@dataclass
class LoadedImage:
    rgb: np.ndarray            # HxWx3 uint8, at uploaded resolution
    focal_35mm: float | None   # from EXIF if present

    @property
    def size(self) -> tuple[int, int]:
        h, w = self.rgb.shape[:2]
        return w, h


def load_image(data: bytes, max_bytes: int, max_pixels: int) -> LoadedImage:
    if len(data) == 0:
        raise InvalidImageError()
    if len(data) > max_bytes:
        raise ImageTooLargeError()

    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        img = Image.open(BytesIO(data))
        if img.format not in ALLOWED_FORMATS:
            raise InvalidImageError()
        if img.width * img.height > max_pixels:
            raise ImageTooLargeError()
        focal = _focal_35mm(img)
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        if isinstance(exc, Image.DecompressionBombError):
            raise ImageTooLargeError() from exc
        raise InvalidImageError() from exc

    if img.width < 64 or img.height < 64:
        raise InvalidImageError("This image is too small to analyze. Please upload a larger photo.")
    return LoadedImage(rgb=np.asarray(img), focal_35mm=focal)


def _focal_35mm(img: Image.Image) -> float | None:
    try:
        exif = img.getexif()
        value = exif.get_ifd(EXIF_IFD).get(EXIF_FOCAL_35MM) or exif.get(EXIF_FOCAL_35MM)
        value = float(value) if value else None
        return value if value and 8 <= value <= 300 else None
    except Exception:  # EXIF is best-effort only
        return None


def resize_long_edge(rgb: np.ndarray, long_edge: int) -> tuple[np.ndarray, float]:
    """Downscale so the long edge is at most `long_edge`. Returns (image, scale)."""
    h, w = rgb.shape[:2]
    scale = min(1.0, long_edge / max(h, w))
    if scale >= 1.0:
        return rgb, 1.0
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    resized = Image.fromarray(rgb).resize(size, Image.Resampling.LANCZOS)
    return np.asarray(resized), scale
