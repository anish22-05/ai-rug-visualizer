"""Model registry: loads the segmentation and depth networks once per process."""

import logging
import threading
from dataclasses import dataclass

import torch
from transformers import (
    AutoImageProcessor,
    AutoModelForDepthEstimation,
    AutoModelForSemanticSegmentation,
    EomtForUniversalSegmentation,
)

from app.core.config import Settings

log = logging.getLogger(__name__)


def is_eomt(name: str) -> bool:
    """EoMT checkpoints (mask classification) need a different model class and post-processing."""
    return "eomt" in name.lower()


@dataclass
class LoadedModel:
    name: str
    processor: object
    model: torch.nn.Module


class ModelRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.device = self._pick_device(settings.device)
        self._seg: LoadedModel | None = None
        self._depth: LoadedModel | None = None
        self._lock = threading.Lock()

    @staticmethod
    def _pick_device(pref: str) -> torch.device:
        if pref == "auto":
            return torch.device("cuda" if torch.cuda.is_available() else "cpu")
        return torch.device(pref)

    def _load(self, name: str, model_cls) -> LoadedModel:
        log.info("Loading %s on %s", name, self.device)
        processor = AutoImageProcessor.from_pretrained(name)
        model = model_cls.from_pretrained(name).to(self.device).eval()
        return LoadedModel(name, processor, model)

    @property
    def segmentation(self) -> LoadedModel:
        with self._lock:
            if self._seg is None:
                name = self.settings.seg_model
                cls = EomtForUniversalSegmentation if is_eomt(name) else AutoModelForSemanticSegmentation
                self._seg = self._load(name, cls)
            return self._seg

    @property
    def depth(self) -> LoadedModel:
        with self._lock:
            if self._depth is None:
                self._depth = self._load(self.settings.depth_model, AutoModelForDepthEstimation)
            return self._depth

    def warmup(self) -> None:
        _ = self.segmentation, self.depth

    def status(self) -> dict:
        return {
            "device": str(self.device),
            "segmentation": {"name": self.settings.seg_model, "loaded": self._seg is not None},
            "depth": {"name": self.settings.depth_model, "loaded": self._depth is not None},
        }
