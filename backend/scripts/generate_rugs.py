"""Generate the demo rug textures + thumbnails procedurally (no licensing concerns).

    python scripts/generate_rugs.py

Writes RGBA PNGs to backend/static/rugs/. Alpha is used for fringe and round rugs.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "static" / "rugs"
RNG = np.random.default_rng(7)


def hexrgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def grid(w: int, h: int):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    return x / w, y / h  # normalised 0..1


def fill(w, h, color):
    return np.ones((h, w, 3), np.float32) * hexrgb(color)


def paint(img, mask, color, alpha=1.0):
    m = mask[..., None].astype(np.float32) * alpha
    img[:] = img * (1 - m) + hexrgb(color) * m


def fibre_noise(img, strength=10.0, scale=1):
    """Woven texture: fine per-pixel noise plus a faint warp/weft pattern."""
    h, w = img.shape[:2]
    noise = RNG.normal(0, strength, (h // scale + 1, w // scale + 1)).astype(np.float32)
    noise = np.kron(noise, np.ones((scale, scale), np.float32))[:h, :w]
    y, x = np.mgrid[0:h, 0:w]
    weave = (np.sin(x * 1.3) * np.sin(y * 1.3)) * strength * 0.35
    img += (noise + weave)[..., None]
    return img


def border(img, inset, width, color):
    h, w = img.shape[:2]
    x, y = np.mgrid[0:h, 0:w][1], np.mgrid[0:h, 0:w][0]
    d = np.minimum.reduce([x, y, w - 1 - x, h - 1 - y])
    paint(img, (d >= inset) & (d < inset + width), color)


def edge_distance(w, h):
    y, x = np.mgrid[0:h, 0:w]
    return np.minimum.reduce([x, y, w - 1 - x, h - 1 - y])


def fringe_alpha(w, h, length=26):
    """Opaque body with tassel fringe on the two short (top/bottom) edges."""
    alpha = np.ones((h, w), np.float32)
    y, x = np.mgrid[0:h, 0:w]
    tassel = (np.sin(x * 0.9) > -0.2).astype(np.float32)
    for band in (y < length, y >= h - length):
        alpha[band] = tassel[band] * 0.95
    return alpha


def finish(img, alpha=None):
    img = np.clip(img, 0, 255).astype(np.uint8)
    h, w = img.shape[:2]
    a = np.ones((h, w), np.float32) if alpha is None else alpha
    rgba = np.dstack([img, (np.clip(a, 0, 1) * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


# --- designs ---------------------------------------------------------------

def modern_beige(w, h):
    img = fill(w, h, "#d9c7a7")
    x, y = grid(w, h)
    img += (np.sin(x * 40 + np.sin(y * 9) * 2) * 4)[..., None]
    border(img, 40, 6, "#b9a07a")
    border(img, 56, 2, "#efe3cc")
    fibre_noise(img, 9)
    body = img.copy()
    pad = np.zeros((h + 52, w, 3), np.float32) + hexrgb("#e6dac4")
    pad[26:26 + h] = body
    return finish(pad, fringe_alpha(w, h + 52))


def geometric_grey(w, h):
    img = fill(w, h, "#c9cacc")
    x, y = np.mgrid[0:h, 0:w][1].astype(np.float32), np.mgrid[0:h, 0:w][0].astype(np.float32)
    cell = w / 6
    u, v = (x % cell) / cell - 0.5, (y % cell) / cell - 0.5
    diamond = np.abs(u) + np.abs(v)
    paint(img, (diamond > 0.44) & (diamond < 0.5), "#3d4045")
    paint(img, diamond < 0.12, "#7d8187")
    paint(img, (np.abs(u) < 0.015) | (np.abs(v) < 0.015), "#a7a9ad", 0.6)
    border(img, 0, 30, "#3d4045")
    border(img, 30, 6, "#e5e6e8")
    fibre_noise(img, 8)
    return finish(img)


def classic_pattern(w, h):
    img = fill(w, h, "#8e1f24")
    x, y = grid(w, h)
    cx, cy = x - 0.5, (y - 0.5) * h / w
    r = np.hypot(cx, cy)
    theta = np.arctan2(cy, cx)
    # field ornament
    orn = (np.sin(x * 70) * np.sin(y * 70 * h / w)) > 0.75
    paint(img, orn, "#c9a46a", 0.55)
    # central medallion
    petal = r < 0.22 + 0.04 * np.cos(theta * 8)
    paint(img, petal, "#1f2b4d")
    paint(img, r < 0.15 + 0.025 * np.cos(theta * 12), "#d8b778")
    paint(img, r < 0.08, "#8e1f24")
    paint(img, r < 0.035, "#1f2b4d")
    ring = np.abs(r - (0.22 + 0.04 * np.cos(theta * 8))) < 0.006
    paint(img, ring, "#efe0bf")
    # corner spandrels
    for sx in (0, 1):
        for sy in (0, 1):
            d = np.hypot(x - sx, (y - sy) * h / w)
            paint(img, d < 0.28, "#1f2b4d")
            paint(img, np.abs(d - 0.24) < 0.008, "#d8b778")
    # borders
    border(img, 0, 70, "#1f2b4d")
    edge = edge_distance(w, h)
    paint(img, (edge >= 18) & (edge < 52) & ((np.sin(np.mgrid[0:h, 0:w][1] * 0.35) + np.sin(np.mgrid[0:h, 0:w][0] * 0.35)) > 0.6), "#c9a46a")
    border(img, 70, 8, "#d8b778")
    border(img, 78, 14, "#5e1418")
    fibre_noise(img, 11)
    pad = np.zeros((h + 52, w, 3), np.float32) + hexrgb("#f1e6cf")
    pad[26:26 + h] = img
    return finish(pad, fringe_alpha(w, h + 52))


def kilim_stripe(w, h):
    img = fill(w, h, "#efe4cf")
    _, y = grid(w, h)
    x = np.mgrid[0:h, 0:w][1].astype(np.float32)
    palette = ["#c4572e", "#2c5f6b", "#e0a43b", "#7a2e3a", "#efe4cf", "#2f2f2f"]
    bands = 22
    idx = (y * bands).astype(int)
    for i in range(bands):
        if i % 2 == 0:
            paint(img, idx == i, palette[(i // 2) % len(palette)])
    # zigzag bands
    for i in range(1, bands, 4):
        zig = np.abs(((x / 30) % 2) - 1)
        local = (y * bands - i)
        paint(img, (local > 0) & (local < 1) & (np.abs(local - zig) < 0.25), "#2f2f2f")
    fibre_noise(img, 10)
    pad = np.zeros((h + 52, w, 3), np.float32) + hexrgb("#efe4cf")
    pad[26:26 + h] = img
    return finish(pad, fringe_alpha(w, h + 52))


def ivory_ring(w, h):
    img = fill(w, h, "#f0e9dc")
    x = np.mgrid[0:h, 0:w][1].astype(np.float32)
    y = np.mgrid[0:h, 0:w][0].astype(np.float32)
    cell = w / 5
    u, v = (x % cell) / cell * 2 * np.pi, (y % cell) / cell * 2 * np.pi
    field = np.cos(u) + np.cos(v) + 0.5 * np.cos(u) * np.cos(v)
    paint(img, np.abs(field) < 0.18, "#5b4636")
    border(img, 0, 24, "#5b4636")
    fibre_noise(img, 12, scale=2)
    # shaggy: slight blur
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    return finish(np.asarray(im).astype(np.float32))


def navy_abstract(w, h):
    img = fill(w, h, "#1d2a44")
    x, y = grid(w, h)
    for i in range(14):
        cx, cy = RNG.uniform(0, 1), RNG.uniform(0, 1)
        freq, amp = RNG.uniform(3, 9), RNG.uniform(0.02, 0.08)
        curve = cy + amp * np.sin((x - cx) * freq * np.pi)
        thick = RNG.uniform(0.004, 0.018)
        color = ["#c9a659", "#e9e4d8", "#5d7aa6", "#3b4f73"][i % 4]
        paint(img, np.abs(y - curve) < thick, color, 0.85)
    blob = np.hypot(x - 0.7, (y - 0.3) * h / w) < 0.12
    paint(img, blob, "#3b4f73", 0.6)
    border(img, 0, 16, "#c9a659")
    fibre_noise(img, 9)
    return finish(img)


def round_jute(w, h):
    img = fill(w, h, "#b88d58")
    x, y = grid(w, h)
    cx, cy = x - 0.5, y - 0.5
    r = np.hypot(cx, cy)
    theta = np.arctan2(cy, cx)
    spiral = np.sin(r * 260 - theta * 2)
    img += (spiral * 14)[..., None]
    braid = np.sin(theta * 140 + r * 40) * 6
    img += braid[..., None]
    paint(img, np.abs(r - 0.43) < 0.012, "#7a5530", 0.7)
    paint(img, np.abs(r - 0.18) < 0.01, "#7a5530", 0.5)
    fibre_noise(img, 12)
    alpha = np.clip((0.5 - r) * w / 2.0, 0, 1)
    return finish(img, alpha)


def terracotta_runner(w, h):
    img = fill(w, h, "#b4553a")
    x, y = grid(w, h)
    xx = np.mgrid[0:h, 0:w][1].astype(np.float32)
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32)
    cell = w * 0.8
    u, v = (xx - w / 2) / cell, ((yy % cell) - cell / 2) / cell
    diamond = np.abs(u) * 1.6 + np.abs(v)
    paint(img, (diamond > 0.3) & (diamond < 0.36), "#f0dcc2")
    paint(img, diamond < 0.12, "#5c2a1e")
    border(img, 0, 22, "#5c2a1e")
    border(img, 22, 5, "#f0dcc2")
    fibre_noise(img, 10)
    pad = np.zeros((h + 40, w, 3), np.float32) + hexrgb("#efe0c8")
    pad[20:20 + h] = img
    return finish(pad, fringe_alpha(w, h + 40, length=20))


DESIGNS = {
    "modern-beige": (modern_beige, 800, 1200),
    "geometric-grey": (geometric_grey, 800, 1200),
    "classic-pattern": (classic_pattern, 800, 1200),
    "kilim-stripe": (kilim_stripe, 800, 1200),
    "ivory-ring": (ivory_ring, 800, 1200),
    "navy-abstract": (navy_abstract, 800, 1200),
    "round-jute": (round_jute, 1024, 1024),
    "terracotta-runner": (terracotta_runner, 400, 1200),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (fn, w, h) in DESIGNS.items():
        img = fn(w, h)
        img.save(OUT / f"{name}.png", optimize=True)
        thumb = img.copy()
        thumb.thumbnail((256, 256), Image.Resampling.LANCZOS)
        thumb.save(OUT / f"{name}-thumb.png", optimize=True)
        print("wrote", name, img.size)


if __name__ == "__main__":
    main()
