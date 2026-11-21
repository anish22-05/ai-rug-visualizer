"""Turn raw per-pixel predictions into a clean floor mask and polygon, plus a soft occlusion alpha (OpenCV)."""

from dataclasses import dataclass

import cv2
import numpy as np

MIN_FLOOR_AREA_RATIO = 0.02   # below this we report "no floor"
MIN_CONFIDENCE = 0.6
MIN_COMPONENT_FRACTION = 0.15  # keep components >= 15% of the largest one

# Occlusion alpha: guided-filter radius / regulariser (work px, guide in 0..1) and the
# smoothstep that tightens the soft edge so no rug colour ghosts through occluders.
GUIDED_RADIUS = 4
GUIDED_EPS = 2e-3
OCCLUSION_EDGE = (0.35, 0.65)


@dataclass
class FloorRegion:
    # Cleaned floor, HxW uint8 {0,255}: polygon, placement, confidence, geometry.
    # Small holes (stools, legs) are filled here, so it must NOT be used for occlusion.
    mask: np.ndarray
    polygon: list[list[float]]    # outer boundary, simplified, work-resolution pixels
    confidence: float
    area_ratio: float
    centroid: tuple[float, float]
    detected: bool
    # Soft occlusion alpha, HxW uint8 0..255 (255 = floor, rug visible). Built from the
    # raw floor probability (no morphology, no hole filling), snapped to image edges.
    occlusion: np.ndarray


def _kernel(size: int) -> np.ndarray:
    size = max(3, size | 1)
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))


def guided_filter(guide: np.ndarray, src: np.ndarray, r: int = GUIDED_RADIUS, eps: float = GUIDED_EPS) -> np.ndarray:
    """Edge-preserving filter of He et al. (grayscale guide), using box filters only.

    The output is locally a linear function of `guide`, so a blurry probability map
    takes on the guide's (photo's) sharp edges.
    """
    I = guide.astype(np.float32)
    p = src.astype(np.float32)
    ksize = (2 * r + 1, 2 * r + 1)

    def box(x: np.ndarray) -> np.ndarray:
        return cv2.boxFilter(x, -1, ksize, borderType=cv2.BORDER_REFLECT)

    mean_i, mean_p = box(I), box(p)
    cov_ip = box(I * p) - mean_i * mean_p
    var_i = box(I * I) - mean_i * mean_i
    a = cov_ip / (var_i + eps)
    b = mean_p - a * mean_i
    return box(a) * I + box(b)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def occlusion_alpha(floor_prob: np.ndarray, rgb: np.ndarray | None = None) -> np.ndarray:
    """Soft floor alpha in [0,1] for occlusion: raw probability -> guided filter -> tight edge."""
    p = np.clip(floor_prob.astype(np.float32), 0.0, 1.0)
    if rgb is not None:
        guide = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        p = guided_filter(guide, p)
    return smoothstep(*OCCLUSION_EDGE, p).astype(np.float32)


def clean_mask(raw: np.ndarray) -> np.ndarray:
    """Morphological cleanup plus removal of tiny islands and pin-holes."""
    h, w = raw.shape
    k = max(3, int(0.008 * max(h, w)))
    mask = cv2.morphologyEx(raw, cv2.MORPH_OPEN, _kernel(k))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, _kernel(k * 2))

    # Keep significant connected components only.
    n, cc, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return np.zeros_like(mask)
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = 1 + np.flatnonzero(areas >= areas.max() * MIN_COMPONENT_FRACTION)
    mask = np.isin(cc, keep).astype(np.uint8) * 255

    # Fill small holes (reflections, noise) but keep big ones (furniture on the floor),
    # which become occluders when rugs are rendered.
    inverse = cv2.bitwise_not(mask)
    n, cc, stats, _ = cv2.connectedComponentsWithStats(inverse, connectivity=4)
    small_hole = 0.002 * h * w
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        touches_border = x == 0 or y == 0 or x + bw >= w or y + bh >= h
        if not touches_border and area < small_hole:
            mask[cc == i] = 255
    return mask


def extract_floor(seg_labels: np.ndarray, floor_prob: np.ndarray, floor_ids: list[int],
                  rgb: np.ndarray | None = None) -> FloorRegion:
    """Cleaned floor mask + polygon, and the separate soft occlusion alpha.

    `rgb` (work image) is the guided filter's guide; without it the occlusion alpha
    is just the tightened raw probability.
    """
    h, w = seg_labels.shape
    raw = np.isin(seg_labels, floor_ids).astype(np.uint8) * 255
    mask = clean_mask(raw)

    area_ratio = float(mask.mean() / 255.0)
    inside = mask > 0
    confidence = float(floor_prob[inside].mean()) if inside.any() else 0.0
    detected = area_ratio >= MIN_FLOOR_AREA_RATIO and confidence >= MIN_CONFIDENCE

    polygon: list[list[float]] = []
    centroid = (w / 2, h * 0.8)
    if inside.any():
        filled = mask.copy()
        contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        largest = max(contours, key=cv2.contourArea)
        eps = 0.004 * cv2.arcLength(largest, True)
        approx = cv2.approxPolyDP(largest, eps, True).reshape(-1, 2)
        polygon = approx.astype(float).tolist()
        ys, xs = np.nonzero(inside)
        centroid = (float(xs.mean()), float(ys.mean()))

    occlusion = np.round(occlusion_alpha(floor_prob, rgb) * 255).astype(np.uint8)
    return FloorRegion(mask, polygon, round(confidence, 3), round(area_ratio, 4), centroid, detected, occlusion)


def group_polygons(labels: np.ndarray, ids: list[int], max_regions: int = 6) -> list[list[list[float]]]:
    """Simplified outlines for a class group (wall, door, furniture, ...), for the debug overlay."""
    if not ids:
        return []
    h, w = labels.shape
    mask = np.isin(labels, ids).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, _kernel(int(0.006 * max(h, w))))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = 0.004 * h * w
    contours = sorted((c for c in contours if cv2.contourArea(c) >= min_area), key=cv2.contourArea, reverse=True)
    out = []
    for c in contours[:max_regions]:
        approx = cv2.approxPolyDP(c, 0.006 * cv2.arcLength(c, True), True).reshape(-1, 2)
        if len(approx) >= 3:
            out.append(approx.astype(float).tolist())
    return out
