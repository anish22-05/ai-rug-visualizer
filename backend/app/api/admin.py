"""Store-owner endpoints: add, edit and remove rugs in the catalogue.

Every request needs `Authorization: Bearer <ADMIN_TOKEN>`. When ADMIN_TOKEN is not
set, the owner tools are disabled (503) rather than open.

Create/update take multipart form data: a `product` field holding the product
JSON, plus an `image` file (required on create, optional on update).
"""

import hmac
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.core.config import get_settings
from app.core.errors import ImageTooLargeError, InvalidImageError, InvalidProductError, OwnerToolsDisabledError, UnauthorizedError
from app.core.limiter import limiter

MIN_CM, MAX_CM = 30, 1200  # matches the frontend's MIN_RUG_CM / MAX_RUG_CM


class SizeIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    width: float = Field(ge=MIN_CM, le=MAX_CM)
    height: float = Field(ge=MIN_CM, le=MAX_CM)
    priceDelta: int = Field(default=0, ge=-10_000_000, le=10_000_000)


class ProductIn(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=60)
    description: str = Field(default="", max_length=400)
    material: str = Field(default="", max_length=80)
    price: int = Field(ge=1, le=10_000_000)
    shape: Literal["rectangle", "round", "runner"] = "rectangle"
    sizes: list[SizeIn] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def _check(self) -> "ProductIn":
        if self.shape == "round":
            for s in self.sizes:
                s.height = s.width
        if any(self.price + s.priceDelta < 1 for s in self.sizes):
            raise ValueError("Every size must end up with a price above zero.")
        return self

    def to_catalog(self) -> dict:
        """The stored product shape (minus id/image), with size ids and labels filled in."""
        sizes = []
        for i, s in enumerate(self.sizes, start=1):
            w, h = _cm(s.width), _cm(s.height)
            label = f"Ø {w} cm" if self.shape == "round" else f"{w} × {h} cm"
            sizes.append({"id": f"s{i}", "label": label, "width": s.width, "height": s.height, "priceDelta": s.priceDelta})
        return {
            "name": self.name,
            "price": self.price,
            "shape": self.shape,
            "material": self.material,
            "description": self.description,
            "sizes": sizes,
        }


def _cm(v: float) -> str:
    return f"{v:g}"


def require_owner(request: Request) -> None:
    token = get_settings().admin_token
    if not token:
        raise OwnerToolsDisabledError()
    header = request.headers.get("authorization", "")
    supplied = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(supplied.encode(), token.encode()):
        raise UnauthorizedError()


router = APIRouter(prefix="/api/v1/admin", dependencies=[Depends(require_owner)])


def _parse(product: str) -> dict:
    try:
        return ProductIn.model_validate_json(product).to_catalog()
    except ValidationError as exc:
        err = exc.errors()[0]
        where = ".".join(str(p) for p in err.get("loc", ()) if p != "__root__")
        msg = err.get("msg", "").removeprefix("Value error, ")
        raise InvalidProductError(f"{where}: {msg}" if where else msg) from exc


async def _read_image(image: UploadFile | None) -> bytes | None:
    if image is None:
        return None
    limit = get_settings().max_upload_bytes
    data = await image.read(limit + 1)
    if len(data) > limit:
        raise ImageTooLargeError(f"This image is larger than {get_settings().max_upload_mb:g} MB. Please upload a smaller photo.")
    return data


@router.get("/session")
@limiter.limit("20/minute")
def session(request: Request) -> dict:
    """Lets the dashboard check an access key before showing the catalogue."""
    return {"ok": True}


@router.post("/products", status_code=201)
async def create_product(request: Request, product: str = Form(...), image: UploadFile | None = File(None)) -> dict:
    fields = _parse(product)
    data = await _read_image(image)
    if not data:
        raise InvalidImageError("Please add a photo of the rug (JPG or PNG).")
    return await run_in_threadpool(request.app.state.catalog.create, fields, data, get_settings().max_pixels)


@router.put("/products/{product_id}")
async def update_product(request: Request, product_id: str, product: str = Form(...),
                         image: UploadFile | None = File(None)) -> dict:
    fields = _parse(product)
    data = await _read_image(image) or None
    return await run_in_threadpool(request.app.state.catalog.update, product_id, fields, data, get_settings().max_pixels)


@router.delete("/products/{product_id}", status_code=204)
async def delete_product(request: Request, product_id: str) -> None:
    await run_in_threadpool(request.app.state.catalog.delete, product_id)
