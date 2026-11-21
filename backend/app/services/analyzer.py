"""Room analysis pipeline: image -> segmentation -> floor region -> floor plane -> homography.

All geometry returned to the client is expressed in the *uploaded* image's pixel
coordinates, even though the networks run on a downscaled copy.
"""

import base64
import logging
import time
import uuid

import cv2
import numpy as np

from app.services import floor_geometry as fg
from app.services import postprocess, shading, vanishing
from app.services.depth import estimate_depth
from app.services.image_io import LoadedImage, resize_long_edge
from app.services.models import ModelRegistry
from app.services.segmentation import segment

log = logging.getLogger(__name__)


def _png_b64(mask: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", mask)
    if not ok:
        raise RuntimeError("PNG encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _scale_pts(pts, s: float) -> list[list[float]]:
    return [[round(x * s, 1), round(y * s, 1)] for x, y in pts]


def estimate_geometry(rgb: np.ndarray, floor: postprocess.FloorRegion, K: fg.Intrinsics,
                      depth: np.ndarray | None) -> tuple[fg.FloorGeometry, vanishing.VanishingResult | None]:
    """Try the depth-plane method first, then vanishing point, then a heuristic."""
    # Line/VP detection is cheap; always run it so the debug overlay can show it
    # (and so the two independent pitch estimates can be compared).
    pitch, vp = vanishing.estimate_pitch(rgb, floor.mask, K)

    if depth is not None:
        fit = fg.fit_floor_plane(depth, floor.mask, K)
        if fit is not None and fg.is_plausible_floor(fit):
            method = "depth-plane" + ("-rescaled" if fit.rescaled else "")
            return fg.build_homography(fit.normal, fit.height, K, floor.centroid, method, fit.inlier_ratio), vp
        log.info("Depth plane rejected: %s", fit)

    if pitch is not None:
        normal = fg.normal_from_pitch(pitch)
        return fg.build_homography(normal, fg.ASSUMED_CAMERA_HEIGHT_M, K, floor.centroid, "vanishing-point"), vp

    normal = fg.normal_from_pitch(vanishing.heuristic_pitch(floor.mask, K))
    return fg.build_homography(normal, fg.ASSUMED_CAMERA_HEIGHT_M, K, floor.centroid, "heuristic"), vp


def analyze(image: LoadedImage, models: ModelRegistry, work_long_edge: int) -> dict:
    timings: dict[str, float] = {}
    t0 = time.perf_counter()

    def mark(name: str, since: float) -> float:
        now = time.perf_counter()
        timings[name] = round((now - since) * 1000)
        return now

    up_w, up_h = image.size
    work, scale = resize_long_edge(image.rgb, work_long_edge)
    to_upload = 1.0 / scale  # work px -> uploaded px
    wh, ww = work.shape[:2]
    t = mark("resize", t0)

    seg = segment(work, models.segmentation, models.device)
    t = mark("segmentation", t)

    floor = postprocess.extract_floor(seg.labels, seg.floor_prob, seg.floor_ids, work)
    segments = {g: [_scale_pts(p, to_upload) for p in postprocess.group_polygons(seg.labels, ids)]
                for g, ids in seg.group_ids.items()}
    t = mark("postprocess", t)

    result: dict = {
        "analysisId": uuid.uuid4().hex,
        "imageSize": {"width": up_w, "height": up_h},
        "workSize": {"width": ww, "height": wh},
        "floor": {
            "detected": floor.detected,
            "maskPng": _png_b64(floor.mask),
            "occlusionPng": _png_b64(floor.occlusion),
            "polygon": _scale_pts(floor.polygon, to_upload),
            "confidence": floor.confidence,
            "areaRatio": floor.area_ratio,
        },
        "segments": segments,
        "lighting": None,
        "geometry": None,
        "placement": None,
        "debug": {},
        "timingsMs": timings,
    }
    if not floor.detected:
        result["floor"]["message"] = "Unable to confidently detect the floor. Please try another room image."
        timings["total"] = round((time.perf_counter() - t0) * 1000)
        return result

    # Light reaching the floor (occluders filled in from the surrounding floor) + scene white balance.
    floor_light = shading.floor_shading(work, floor.occlusion)
    result["lighting"] = {
        "shadingPng": _png_b64(shading.encode_shading(floor_light)),
        "shadingScale": shading.ENCODE_MAX,
        "illuminant": shading.scene_illuminant(
            work, np.isin(seg.labels, seg.group_ids["wall"] + seg.group_ids["ceiling"])),
    }
    t = mark("shading", t)

    K = fg.intrinsics_for(ww, wh, image.focal_35mm)
    depth = estimate_depth(work, models.depth, models.device)
    t = mark("depth", t)

    geo, vp = estimate_geometry(work, floor, K, depth)
    t = mark("geometry", t)

    # Rescale H from work pixels to uploaded pixels: H_up = S · H_work.
    S = np.diag([to_upload, to_upload, 1.0])
    H_up = S @ geo.H
    H_up /= H_up[2, 2]
    H_inv = np.linalg.inv(H_up)
    H_inv /= H_inv[2, 2]

    poly_work = np.asarray(floor.polygon, dtype=float)
    poly_floor = fg.apply_h(np.linalg.inv(geo.H), poly_work) if len(poly_work) else np.zeros((0, 2))
    placement = fg.suggest_placement(geo.H, floor.mask, poly_floor)
    mark("placement", t)

    result["geometry"] = {
        "homography": H_up.flatten().round(9).tolist(),
        "inverse": H_inv.flatten().round(12).tolist(),
        "intrinsics": K.to_dict(to_upload),
        "normal": geo.normal.round(5).tolist(),
        "pitchDeg": round(geo.pitch_deg, 2),
        "rollDeg": round(geo.roll_deg, 2),
        "cameraHeightM": round(geo.camera_height, 3),
        "horizonY": round(geo.horizon_y * to_upload, 1) if geo.horizon_y is not None else None,
        "method": geo.method,
        "focalSource": "exif" if image.focal_35mm else "assumed",
    }
    result["placement"] = placement
    result["debug"] = {
        "inlierRatio": round(geo.inlier_ratio, 3) if geo.inlier_ratio is not None else None,
        "vanishingPoint": [round(c * to_upload, 1) for c in vp.point] if vp and vp.point else None,
        "lines": [[round(v * to_upload, 1) for v in ln] for ln in vp.lines[:120]] if vp else [],
    }
    timings["total"] = round((time.perf_counter() - t0) * 1000)
    return result
