"""Fallback floor orientation from perspective lines (no depth needed).

Parallel lines on the floor (planks, tiles, skirting, the floor-wall junction)
converge to a vanishing point on the horizon. If we assume zero camera roll, the
horizon row gives the camera pitch:  pitch = atan((cy - horizon_y) / f).
"""

from dataclasses import dataclass

import cv2
import numpy as np

from app.services.floor_geometry import Intrinsics


@dataclass
class VanishingResult:
    point: tuple[float, float] | None
    support: int
    lines: list[list[float]]   # [x1, y1, x2, y2] in work pixels (for the debug overlay)


def detect_floor_lines(rgb: np.ndarray, floor_mask: np.ndarray, max_lines: int = 200) -> np.ndarray:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    lines = lsd.detect(gray)[0]
    if lines is None:
        return np.zeros((0, 4))
    lines = lines.reshape(-1, 4)
    length = np.hypot(lines[:, 2] - lines[:, 0], lines[:, 3] - lines[:, 1])
    lines = lines[length > 0.04 * max(h, w)]

    # Keep lines lying on (a slightly dilated) floor region, so the floor-wall junction counts too.
    region = cv2.dilate(floor_mask, np.ones((15, 15), np.uint8)) > 0
    mid_x = np.clip(((lines[:, 0] + lines[:, 2]) / 2).astype(int), 0, w - 1)
    mid_y = np.clip(((lines[:, 1] + lines[:, 3]) / 2).astype(int), 0, h - 1)
    lines = lines[region[mid_y, mid_x]]

    # Receding floor lines are never near-horizontal in the image.
    angle = np.degrees(np.arctan2(np.abs(lines[:, 3] - lines[:, 1]), np.abs(lines[:, 2] - lines[:, 0])))
    lines = lines[angle > 12]
    if len(lines) > max_lines:
        order = np.argsort(-np.hypot(lines[:, 2] - lines[:, 0], lines[:, 3] - lines[:, 1]))
        lines = lines[order[:max_lines]]
    return lines


def _homog_line(seg: np.ndarray) -> np.ndarray:
    return np.cross([seg[0], seg[1], 1.0], [seg[2], seg[3], 1.0])


def find_vanishing_point(lines: np.ndarray, floor_top_y: float, iterations: int = 500,
                         angle_tol_deg: float = 2.0, seed: int = 0) -> tuple[tuple[float, float] | None, int]:
    """RANSAC: intersect random line pairs, count lines pointing at the candidate VP."""
    if len(lines) < 4:
        return None, 0
    rng = np.random.default_rng(seed)
    mids = (lines[:, :2] + lines[:, 2:]) / 2
    dirs = lines[:, 2:] - lines[:, :2]
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    cos_tol = np.cos(np.radians(angle_tol_deg))
    best, best_support = None, 0
    for _ in range(iterations):
        i, j = rng.choice(len(lines), 2, replace=False)
        p = np.cross(_homog_line(lines[i]), _homog_line(lines[j]))
        if abs(p[2]) < 1e-9:
            continue
        vp = p[:2] / p[2]
        if vp[1] > floor_top_y:   # the floor's vanishing point must be above the floor
            continue
        to_vp = vp - mids
        to_vp /= np.linalg.norm(to_vp, axis=1, keepdims=True) + 1e-12
        support = int((np.abs((to_vp * dirs).sum(axis=1)) > cos_tol).sum())
        if support > best_support:
            best, best_support = (float(vp[0]), float(vp[1])), support
    return best, best_support


def estimate_pitch(rgb: np.ndarray, floor_mask: np.ndarray, K: Intrinsics) -> tuple[float | None, VanishingResult]:
    lines = detect_floor_lines(rgb, floor_mask)
    ys = np.nonzero(floor_mask)[0]
    floor_top = float(ys.min()) if len(ys) else rgb.shape[0] / 2
    vp, support = find_vanishing_point(lines, floor_top)
    result = VanishingResult(vp, support, lines.round(1).tolist())
    if vp is None or support < max(4, int(0.15 * len(lines))):
        return None, result
    pitch = float(np.arctan2(K.cy - vp[1], K.f))
    if not np.radians(2) <= pitch <= np.radians(75):
        return None, result
    return pitch, result


def heuristic_pitch(floor_mask: np.ndarray, K: Intrinsics) -> float:
    """Last resort: put the horizon a little above the farthest visible floor."""
    ys = np.nonzero(floor_mask)[0]
    h = floor_mask.shape[0]
    top = float(ys.min()) if len(ys) else h * 0.5
    horizon_y = min(top - 0.08 * h, K.cy)
    pitch = float(np.arctan2(K.cy - horizon_y, K.f))
    return float(np.clip(pitch, np.radians(8), np.radians(60)))
