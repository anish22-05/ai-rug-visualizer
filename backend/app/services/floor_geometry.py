"""Floor-plane geometry: camera intrinsics, plane fitting and the floor homography.

Coordinate conventions
----------------------
Camera frame: x right, y down, z forward (OpenCV convention).
Floor frame (what the frontend stores rugs in): centimetres on the floor plane,
+u to the right and +v *towards the camera*. Looking at a top-down map this is
the same orientation as image pixels, so a rug's rotation feels natural on screen.

The floor homography H maps floor (u, v, 1) -> image (x, y, w):

    X(u, v) = O + (u/100)·e1 + (v/100)·e2        (3-D point on the plane, metres)
    p       = K · X = K · [e1/100 | e2/100 | O] · (u, v, 1)ᵀ

so H = K · [e1/100  e2/100  O]. e1 and e2 are orthonormal axes lying in the plane
and O is the 3-D point under the floor-centroid pixel.
"""

from dataclasses import dataclass

import numpy as np

DEFAULT_FOCAL_35MM = 28.0       # typical phone main camera (~65° horizontal FOV)
ASSUMED_CAMERA_HEIGHT_M = 1.4
MIN_HEIGHT_M, MAX_HEIGHT_M = 0.4, 2.6


@dataclass
class Intrinsics:
    f: float
    cx: float
    cy: float

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.f, 0, self.cx], [0, self.f, self.cy], [0, 0, 1.0]])

    def to_dict(self, scale: float = 1.0) -> dict:
        return {"f": self.f * scale, "cx": self.cx * scale, "cy": self.cy * scale}


@dataclass
class PlaneFit:
    normal: np.ndarray   # unit normal pointing up (towards the camera)
    height: float        # camera distance to the plane, metres
    inlier_ratio: float
    rescaled: bool       # True if metric scale looked implausible and was reset


@dataclass
class FloorGeometry:
    H: np.ndarray                 # floor cm -> work-image px
    normal: np.ndarray
    camera_height: float
    pitch_deg: float              # positive = camera looking down
    roll_deg: float
    horizon_y: float | None       # image row of the horizon at the centre column
    method: str
    inlier_ratio: float | None = None


def intrinsics_for(width: int, height: int, focal_35mm: float | None) -> Intrinsics:
    f35 = focal_35mm or DEFAULT_FOCAL_35MM
    # A 35 mm frame is 36 mm wide; map that onto the long image edge.
    f_px = f35 / 36.0 * max(width, height)
    return Intrinsics(f=f_px, cx=width / 2.0, cy=height / 2.0)


def backproject(us: np.ndarray, vs: np.ndarray, z: np.ndarray, K: Intrinsics) -> np.ndarray:
    x = (us - K.cx) / K.f * z
    y = (vs - K.cy) / K.f * z
    return np.stack([x, y, z], axis=1)


def fit_plane_ransac(points: np.ndarray, iterations: int = 300, seed: int = 0) -> tuple[np.ndarray, float, np.ndarray]:
    """Robust plane fit. Returns (unit normal n, offset c, inlier mask) with n·X + c = 0."""
    rng = np.random.default_rng(seed)
    n_pts = len(points)
    # Inlier threshold relative to scene scale (≈2% of median depth, at least 2 cm).
    thresh = max(0.02, 0.02 * float(np.median(points[:, 2])))
    best_inliers = None
    best_count = 0
    for _ in range(iterations):
        a, b, c = points[rng.choice(n_pts, 3, replace=False)]
        normal = np.cross(b - a, c - a)
        norm = np.linalg.norm(normal)
        if norm < 1e-9:
            continue
        normal /= norm
        dist = np.abs(points @ normal - normal @ a)
        inliers = dist < thresh
        count = int(inliers.sum())
        if count > best_count:
            best_count, best_inliers = count, inliers
    if best_inliers is None:
        raise ValueError("Plane fit failed")

    # Least-squares refinement on the inliers (SVD of centred points).
    inlier_pts = points[best_inliers]
    centroid = inlier_pts.mean(axis=0)
    _, _, vt = np.linalg.svd(inlier_pts - centroid, full_matrices=False)
    normal = vt[-1]
    offset = -float(normal @ centroid)
    return normal, offset, best_inliers


def fit_floor_plane(depth: np.ndarray, floor_mask: np.ndarray, K: Intrinsics, max_samples: int = 6000) -> PlaneFit | None:
    import cv2

    # Erode so we don't sample depth at object boundaries, where it is least reliable.
    k = max(3, int(0.01 * max(floor_mask.shape)))
    eroded = cv2.erode(floor_mask, np.ones((k, k), np.uint8))
    vs, us = np.nonzero(eroded if eroded.any() else floor_mask)
    if len(us) < 200:
        return None
    rng = np.random.default_rng(0)
    if len(us) > max_samples:
        pick = rng.choice(len(us), max_samples, replace=False)
        us, vs = us[pick], vs[pick]
    z = depth[vs, us].astype(np.float64)
    valid = np.isfinite(z) & (z > 0.05)
    if valid.sum() < 200:
        return None
    pts = backproject(us[valid].astype(np.float64), vs[valid].astype(np.float64), z[valid], K)

    normal, offset, inliers = fit_plane_ransac(pts)
    # Orient the normal towards the camera: camera (origin) must be on the positive side.
    if offset < 0:
        normal, offset = -normal, -offset
    height = offset
    rescaled = False
    if not (MIN_HEIGHT_M <= height <= MAX_HEIGHT_M):
        height, rescaled = ASSUMED_CAMERA_HEIGHT_M, True
    return PlaneFit(normal=normal, height=height, inlier_ratio=float(inliers.mean()), rescaled=rescaled)


def is_plausible_floor(fit: PlaneFit) -> bool:
    # "Up" in camera coordinates is roughly -y. A floor seen from a normal standing
    # or sitting position has a normal within ~70° of that.
    up_alignment = -fit.normal[1]
    return fit.inlier_ratio >= 0.45 and up_alignment >= 0.35


def normal_from_pitch(pitch_rad: float, roll_rad: float = 0.0) -> np.ndarray:
    """World 'up' expressed in camera coordinates for a camera pitched down by `pitch`."""
    n = np.array([0.0, -np.cos(pitch_rad), -np.sin(pitch_rad)])
    if roll_rad:
        c, s = np.cos(roll_rad), np.sin(roll_rad)
        n = np.array([c * n[0] - s * n[1], s * n[0] + c * n[1], n[2]])
    return n / np.linalg.norm(n)


def build_homography(normal: np.ndarray, height: float, K: Intrinsics, anchor_px: tuple[float, float], method: str,
                     inlier_ratio: float | None = None) -> FloorGeometry:
    n = normal / np.linalg.norm(normal)
    Kmat = K.K

    # O: where the ray through the anchor pixel hits the plane n·X + h = 0.
    ray = np.linalg.inv(Kmat) @ np.array([anchor_px[0], anchor_px[1], 1.0])
    denom = float(n @ ray)
    if denom >= -1e-6:
        # Anchor is at/above the horizon; fall back to a point straight ahead and below.
        ray = np.linalg.inv(Kmat) @ np.array([K.cx, K.cy * 2 - 1, 1.0])
        denom = float(n @ ray)
    t = -height / denom
    origin = t * ray

    # In-plane axes: e1 = camera x projected onto the plane, e2 = e1 × n (towards camera).
    x_axis = np.array([1.0, 0.0, 0.0])
    e1 = x_axis - (x_axis @ n) * n
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(e1, n)

    H = Kmat @ np.column_stack([e1 / 100.0, e2 / 100.0, origin])
    H /= H[2, 2]

    pitch = float(np.degrees(np.arcsin(np.clip(-n[2], -1, 1))))
    roll = float(np.degrees(np.arctan2(n[0], -n[1])))
    # Horizon = image of the plane's line at infinity: l = K^-T n.
    line = np.linalg.inv(Kmat).T @ n
    horizon_y = float(-(line[0] * K.cx + line[2]) / line[1]) if abs(line[1]) > 1e-9 else None
    return FloorGeometry(H, n, height, pitch, roll, horizon_y, method, inlier_ratio)


def suggest_placement(H: np.ndarray, floor_mask: np.ndarray, polygon_floor: np.ndarray, res_cm: float = 2.0) -> dict | None:
    """Find the most open spot on the floor (largest inscribed circle in floor space).

    The floor mask is warped into a top-down raster (res_cm per pixel) and a distance
    transform gives, for every floor cell, the distance to the nearest non-floor cell.
    """
    import cv2

    if polygon_floor.size == 0:
        return None
    # Bound the raster to a sane region around the anchor (far points near the horizon explode).
    u0 = max(float(polygon_floor[:, 0].min()), -600.0)
    u1 = min(float(polygon_floor[:, 0].max()), 600.0)
    v0 = max(float(polygon_floor[:, 1].min()), -900.0)
    v1 = min(float(polygon_floor[:, 1].max()), 500.0)
    if u1 - u0 < 40 or v1 - v0 < 40:
        return None
    cols, rows = int((u1 - u0) / res_cm), int((v1 - v0) / res_cm)
    raster_to_floor = np.array([[res_cm, 0, u0], [0, res_cm, v0], [0, 0, 1.0]])
    M = H @ raster_to_floor  # raster px -> image px
    top_down = cv2.warpPerspective(floor_mask, M, (cols, rows), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP)
    top_down = (top_down > 0).astype(np.uint8)
    if top_down.sum() < 50:
        return None
    # Pad with a zero border: the edge of the raster (= edge of the photo) is not floor.
    top_down = cv2.copyMakeBorder(top_down, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    dist = cv2.distanceTransform(top_down, cv2.DIST_L2, 5)
    _, max_val, _, max_loc = cv2.minMaxLoc(dist)
    return {
        "x": round(u0 + (max_loc[0] - 1) * res_cm, 1),
        "y": round(v0 + (max_loc[1] - 1) * res_cm, 1),
        "radiusCm": round(max_val * res_cm, 1),
    }


def apply_h(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    homog = np.hstack([pts, np.ones((len(pts), 1))]) @ H.T
    return homog[:, :2] / homog[:, 2:3]
