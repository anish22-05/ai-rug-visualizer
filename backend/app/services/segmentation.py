"""Semantic segmentation of the room on ADE20K (150 indoor/outdoor classes).

ADE20K has explicit `floor` and `rug` classes, which is exactly the signal we need.
The same forward pass also gives walls, ceiling, doors, windows and furniture, so
detecting those (a bonus feature) costs nothing extra.

Two model families are supported, selected by `SEG_MODEL`:

* **EoMT** (default, `tue-mps/ade20k_semantic_eomt_large_512`): a mask-classification
  ViT. The processor tiles the image into overlapping 512 px squares; we merge the
  per-class scores ourselves at a modest resolution (see `_eomt_scores`) so memory
  stays bounded.
* **SegFormer** (fallback): per-pixel logits. The input keeps the photo's aspect
  ratio (the processor would otherwise squash it to 512x512).

Both produce a per-class score map at `SCORE_LONG_EDGE`, from which we take the
argmax labels and a *soft* floor probability.
"""

from dataclasses import dataclass

import cv2
import numpy as np
import torch

from app.services.models import LoadedModel, is_eomt

# Groups of ADE20K label names. Resolved to class ids from the model config at
# runtime, so we never hard-code ids that could differ between checkpoints.
FLOOR_LABELS = {"floor", "rug"}
GROUP_LABELS: dict[str, set[str]] = {
    "wall": {"wall"},
    "ceiling": {"ceiling"},
    "door": {"door", "screen door"},
    "window": {"windowpane", "window"},
    "furniture": {
        "bed", "cabinet", "table", "chair", "sofa", "shelf", "armchair", "seat", "desk",
        "wardrobe", "lamp", "bathtub", "cushion", "chest of drawers", "counter", "sink",
        "refrigerator", "bookcase", "coffee table", "toilet", "swivel chair", "stool",
        "ottoman", "television receiver", "buffet", "kitchen island", "pool table",
        "bench", "plant", "flowerpot", "fireplace", "stove", "piano", "crt screen",
    },
}
# Long edge of the per-class score map (memory: 150 x 512 x 341 floats ≈ 100 MB).
# Both models predict at a coarser grid than this, so nothing is lost.
SCORE_LONG_EDGE = 512
# SegFormer input long edge (rounded to multiples of 32, aspect ratio kept).
SEGFORMER_LONG_EDGE = 1024


@dataclass
class Segmentation:
    labels: np.ndarray       # HxW int32 class ids at work resolution
    floor_prob: np.ndarray   # HxW float32 soft probability of floor/rug (unprocessed)
    floor_ids: list[int]
    group_ids: dict[str, list[int]]


def _resolve(id2label: dict, names: set[str]) -> list[int]:
    ids = []
    for idx, label in id2label.items():
        primary = str(label).split(",")[0].strip().lower()
        if primary in names:
            ids.append(int(idx))
    return ids


def _score_size(h: int, w: int) -> tuple[int, int]:
    s = SCORE_LONG_EDGE / max(h, w)
    return max(1, round(h * s)), max(1, round(w * s))


def _segformer_scores(rgb: np.ndarray, seg: LoadedModel, device: torch.device) -> torch.Tensor:
    """Class probabilities (C, sh, sw), summing to 1 per pixel."""
    h, w = rgb.shape[:2]
    s = SEGFORMER_LONG_EDGE / max(h, w)
    size = {"height": max(32, round(h * s / 32) * 32), "width": max(32, round(w * s / 32) * 32)}
    inputs = seg.processor(images=rgb, return_tensors="pt", size=size).to(device)
    logits = seg.model(**inputs).logits  # (1, C, H/4, W/4)
    logits = torch.nn.functional.interpolate(logits, size=_score_size(h, w), mode="bilinear", align_corners=False)
    return logits.softmax(dim=1)[0]


def _eomt_scores(rgb: np.ndarray, seg: LoadedModel, device: torch.device) -> torch.Tensor:
    """Per-class scores (C, sh, sw) = Σ_q softmax(class_q) · sigmoid(mask_q), tiles averaged.

    Mirrors `post_process_semantic_segmentation`, but resamples each tile straight to
    its footprint in a small score canvas instead of materialising 150 full-size maps.
    """
    h, w = rgb.shape[:2]
    inputs = seg.processor(images=rgb, return_tensors="pt")
    offsets = [[int(v) for v in o] for o in inputs.pop("patch_offsets", None) or []]
    out = seg.model(pixel_values=inputs["pixel_values"].to(device))

    classes = out.class_queries_logits.softmax(dim=-1)[..., :-1]   # (P, Q, C); drop "no object"
    masks = out.masks_queries_logits.sigmoid()                      # (P, Q, mh, mw)
    tiles = torch.einsum("pqc,pqhw->pchw", classes, masks)          # (P, C, mh, mw)

    sh, sw = _score_size(h, w)
    n_cls = tiles.shape[1]
    if not offsets:  # single, unsplit (padded) input: crop the padding off
        ph, pw = inputs["pixel_values"].shape[-2:]
        scale = min(ph / h, pw / w)
        th, tw = tiles.shape[-2:]
        crop = tiles[:, :, : max(1, round(h * scale * th / ph)), : max(1, round(w * scale * tw / pw))]
        return torch.nn.functional.interpolate(crop, size=(sh, sw), mode="bilinear", align_corners=False)[0]

    vertical = h > w  # tiles run along the long side
    long_px = max(end for _, _, end in offsets)        # resized long side, processor px
    long_s = sh if vertical else sw
    acc = torch.zeros((n_cls, sh, sw), device=tiles.device)
    cnt = torch.zeros((1, sh, sw), device=tiles.device)
    for tile, (_, start, end) in zip(tiles, offsets):
        a, b = round(start * long_s / long_px), round(end * long_s / long_px)
        b = min(max(b, a + 1), long_s)
        size = (b - a, sw) if vertical else (sh, b - a)
        r = torch.nn.functional.interpolate(tile[None], size=size, mode="bilinear", align_corners=False)[0]
        if vertical:
            acc[:, a:b] += r
            cnt[:, a:b] += 1
        else:
            acc[:, :, a:b] += r
            cnt[:, :, a:b] += 1
    return acc / cnt.clamp(min=1)


@torch.inference_mode()
def segment(rgb: np.ndarray, seg: LoadedModel, device: torch.device) -> Segmentation:
    h, w = rgb.shape[:2]
    id2label = seg.model.config.id2label
    floor_ids = _resolve(id2label, FLOOR_LABELS)
    if not floor_ids:
        raise RuntimeError("Segmentation model has no floor class")
    group_ids = {group: _resolve(id2label, names) for group, names in GROUP_LABELS.items()}

    scores = _eomt_scores(rgb, seg, device) if is_eomt(seg.name) else _segformer_scores(rgb, seg, device)

    labels_small = scores.argmax(dim=0).to(torch.int32).cpu().numpy()
    total = scores.sum(dim=0).clamp(min=1e-6)  # EoMT scores are not normalised per pixel
    floor_prob_small = (scores[floor_ids].sum(dim=0) / total).clamp(0, 1).float().cpu().numpy()

    # Upsample to work resolution: nearest for labels, linear for probabilities.
    labels = cv2.resize(labels_small, (w, h), interpolation=cv2.INTER_NEAREST)
    floor_prob = cv2.resize(floor_prob_small, (w, h), interpolation=cv2.INTER_LINEAR)
    return Segmentation(labels, floor_prob, floor_ids, group_ids)
