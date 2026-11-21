"""Floor shading + scene illuminant, so a rug picks up the light of the floor it lies on.

A rug is lit by the same light as the floor under it: darker in furniture shadows
and corners, brighter near windows. We estimate that from the floor pixels only
(walls and furniture are excluded), in linear light:

    log_shading = blur(log(lum)·w, σ) / blur(w, σ)        (normalised convolution)
    shading     = exp(k·(log_shading − median(log lum on floor))), clamped

Floor luminance mixes light with the floor's own colour (dark boards, tile
patterns). A wide σ averages the pattern away, and k < 1 transfers only part of
what remains, so a naturally darker board does not turn the rug black.

The weight `w` is the occlusion alpha (true floor, occluders excluded), so the area
under a stool or sofa is *filled in* from the surrounding floor instead of taking
the furniture's own colour. Shading is clamped from above because rugs are matte:
specular highlights on a glossy floor must not transfer to the rug.

The illuminant (white balance) is the mean linear colour of the brightest
near-neutral wall/ceiling pixels, normalised to mean 1, so a rug in a warm-lit room turns
slightly warm.
"""

import cv2
import numpy as np

MAP_LONG_EDGE = 320         # shading is low-frequency: compute (and ship) it small
SIGMA_FRAC = 0.03           # blur σ as a fraction of the image width
COARSE_SIGMA_FRAC = 0.10    # fallback σ where little floor is nearby
MIN_WEIGHT = 0.05           # normalised-convolution support below which we fall back
STRENGTH = 0.75             # k: fraction of the log-luminance variation transferred
SHADING_RANGE = (0.4, 1.05)
ENCODE_MAX = 1.25           # shadingPng stores shading / ENCODE_MAX · 255
BRIGHT_PERCENTILE = 85
ILLUMINANT_RANGE = (0.85, 1.15)  # keep colour casts subtle
MAX_NEUTRAL_CHROMA = 0.35   # (max-min)/max in linear RGB: "near-neutral" bright pixels
MIN_NEUTRAL_FRACTION = 0.05 # need this share of bright pixels to be neutral, else use all
MIN_SURFACE_FRACTION = 0.03 # walls/ceiling must cover this share of the image to be used
LOG_EPS = 1e-4


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def luminance(linear_rgb: np.ndarray) -> np.ndarray:
    return (0.2126 * linear_rgb[..., 0] + 0.7152 * linear_rgb[..., 1] + 0.0722 * linear_rgb[..., 2]).astype(np.float32)


def _masked_blur(values: np.ndarray, weight: np.ndarray, sigma: float) -> tuple[np.ndarray, np.ndarray]:
    num = cv2.GaussianBlur(values * weight, (0, 0), sigma)
    den = cv2.GaussianBlur(weight, (0, 0), sigma)
    return num / np.maximum(den, 1e-6), den


def _downscale(img: np.ndarray, long_edge: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = long_edge / max(h, w)
    if s >= 1.0:
        return img
    return cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)


def floor_shading(rgb: np.ndarray, floor_weight: np.ndarray) -> np.ndarray:
    """Float32 shading factor (1 = typical floor light) from floor pixels only.

    `floor_weight` is HxW in [0,1] (or uint8 0..255): 1 where the pixel is visible floor.
    The result has the image's aspect ratio, at most MAP_LONG_EDGE on its long side
    (consumers sample it in normalised coordinates). All-ones if there is no floor.
    """
    w = floor_weight.astype(np.float32)
    if w.max() > 1.0:
        w /= 255.0
    rgb = _downscale(rgb, MAP_LONG_EDGE)
    w = _downscale(w, MAP_LONG_EDGE)
    w = (w > 0.5).astype(np.float32)
    if w.sum() < 16:
        return np.ones(w.shape, np.float32)

    log_lum = np.log(luminance(srgb_to_linear(rgb)) + LOG_EPS)
    ref = float(np.median(log_lum[w > 0]))
    width = rgb.shape[1]

    fine, den = _masked_blur(log_lum, w, max(1.0, SIGMA_FRAC * width))
    coarse, den_c = _masked_blur(log_lum, w, max(2.0, COARSE_SIGMA_FRAC * width))
    # Far from any floor (walls, ceiling) neither estimate is meaningful: use the reference.
    coarse = np.where(den_c >= MIN_WEIGHT * 0.2, coarse, ref)
    # Blend smoothly from fine (plenty of floor nearby) to coarse (little floor nearby).
    t = np.clip(den / MIN_WEIGHT, 0.0, 1.0)
    log_shading = t * fine + (1.0 - t) * coarse

    return np.clip(np.exp(STRENGTH * (log_shading - ref)), *SHADING_RANGE).astype(np.float32)


def scene_illuminant(rgb: np.ndarray, surfaces: np.ndarray | None = None) -> list[float]:
    """Linear RGB of the scene light (mean of the brightest pixels), normalised to mean 1.

    `surfaces` (HxW bool, optional) limits the estimate to walls/ceiling, so the view
    through a window (sky, foliage) or brightly coloured furniture can't bias it. It is
    ignored if it covers too little of the image.
    """
    lin = srgb_to_linear(_downscale(rgb, MAP_LONG_EDGE))
    lum = luminance(lin)
    region = np.ones(lum.shape, bool)
    if surfaces is not None:
        sm = _downscale(surfaces.astype(np.float32), MAP_LONG_EDGE) > 0.5
        if sm.mean() >= MIN_SURFACE_FRACTION:
            region = sm
    bright = region & (lum >= np.percentile(lum[region], BRIGHT_PERCENTILE))
    # Only near-neutral surfaces (walls, ceiling) show the light's colour; strongly
    # coloured bright pixels (foliage through a window, a red sofa) would bias it.
    mx, mn = lin.max(axis=2), lin.min(axis=2)
    neutral = bright & ((mx - mn) / np.maximum(mx, 1e-6) < MAX_NEUTRAL_CHROMA)
    if neutral.sum() >= MIN_NEUTRAL_FRACTION * bright.sum():
        bright = neutral
    if not bright.any():
        return [1.0, 1.0, 1.0]
    illum = lin[bright].mean(axis=0)
    mean = float(illum.mean())
    if mean <= 1e-6:
        return [1.0, 1.0, 1.0]
    illum = np.clip(illum / mean, *ILLUMINANT_RANGE)
    illum /= illum.mean()
    return [round(float(v), 4) for v in illum]


def encode_shading(shading: np.ndarray) -> np.ndarray:
    """8-bit encoding for the API: value = shading / ENCODE_MAX · 255."""
    return np.round(np.clip(shading / ENCODE_MAX, 0.0, 1.0) * 255).astype(np.uint8)
