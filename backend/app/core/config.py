"""Runtime configuration, read from environment variables (or a local .env file)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Comma-separated list of origins allowed to call the API from a browser.
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_upload_mb: float = 15.0
    # Hard cap on decoded pixel count (decompression-bomb guard): 40 MP.
    max_pixels: int = 40_000_000
    # Long edge the CV pipeline works at. Results are rescaled to the uploaded size.
    work_long_edge: int = 1024

    # EoMT-L (MIT) is sharper on thin occluders; SegFormer-B2 is ~2x faster
    # ("nvidia/segformer-b2-finetuned-ade-512-512").
    seg_model: str = "tue-mps/ade20k_semantic_eomt_large_512"
    depth_model: str = "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf"
    device: str = "auto"  # "auto" | "cpu" | "cuda"
    # Skip loading models at startup (used by unit tests).
    lazy_models: bool = False

    rate_limit: str = "30/minute"

    # Store-owner tools (/api/v1/admin/*). Empty = owner tools disabled.
    admin_token: str = ""
    # Live catalogue file and uploaded rug images. Both must be writable; point them
    # at a persistent volume in production. Empty = backend/var/...
    catalog_path: str = ""
    upload_dir: str = ""

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)


@lru_cache
def get_settings() -> Settings:
    return Settings()
