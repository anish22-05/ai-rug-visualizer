"""Composite real rug photographs into room photos, exactly as the WebGL compositor does.

    python scripts/research/eval_rugs.py --rooms ../samples/*.jpg --rugs <dir>/*.jpg --out ../docs/eval/rugs

For every room the backend analysis is run once, then each rug is placed
1. at the backend's suggested spot, and
2. on the foot of the largest object standing inside the floor (stool, table...), so
   the object must appear *in front of* the rug.

Each output is a crop with two panels: left = occlusion with the cleaned floor mask (the
shipped behaviour before the realism work), right = current pipeline (soft occlusion
alpha + floor shading + illuminant). The maths mirrors `frontend/src/lib/render/`:
uv = H_rug⁻¹·p, albedo·shading·illuminant in linear light, × occlusion, premultiplied
"over"; shadow = feathered quad (margin 3.5%, nudged towards the camera, strength 0.38).
"""

import argparse
import base64
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.config import Settings  # noqa: E402
from app.services.analyzer import analyze  # noqa: E402
from app.services.floor_geometry import apply_h  # noqa: E402
from app.services.image_io import load_image  # noqa: E402
from app.services.models import ModelRegistry  # noqa: E402
from app.services.shading import srgb_to_linear  # noqa: E402

RUG_WIDTH_CM = 160.0
SHADOW_STRENGTH = 0.38


def to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def decode_png(b64: str, w: int, h: int) -> np.ndarray:
    m = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), 0)
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255


def load_rug(path: Path) -> np.ndarray:
    """Product photo -> tight RGB crop of the rug (background differs from the border colour)."""
    rgb = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2RGB)
    border = np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3), rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)])
    bg = np.median(border, 0)
    diff = np.abs(rgb.astype(np.float32) - bg).max(2) > 40
    diff = cv2.morphologyEx(diff.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    ys, xs = np.nonzero(diff)
    if len(xs) > 0.2 * diff.size:
        # trim the outermost 1.5% (fringe, background bleed)
        x0, x1, y0, y1 = np.percentile(xs, 0.5), np.percentile(xs, 99.5), np.percentile(ys, 0.5), np.percentile(ys, 99.5)
        dx, dy = 0.015 * (x1 - x0), 0.015 * (y1 - y0)
        rgb = rgb[int(y0 + dy):int(y1 - dy), int(x0 + dx):int(x1 - dx)]
    return rgb


def rug_corners(cx: float, cy: float, w: float, h: float, rot_deg: float) -> np.ndarray:
    """Floor-cm corners TL, TR, BR, BL (TL = far-left, as `floorCorners` in rugGeometry.ts)."""
    r = np.radians(rot_deg)
    c, s = np.cos(r), np.sin(r)
    local = np.array([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]])
    return local @ np.array([[c, s], [-s, c]]) + [cx, cy]


def project(H: np.ndarray, pts: np.ndarray) -> np.ndarray | None:
    hom = np.hstack([pts, np.ones((len(pts), 1))]) @ H.T
    if not (np.sign(hom[:, 2]) == np.sign(hom[0, 2])).all():
        return None
    return hom[:, :2] / hom[:, 2:3]


def unit_to_quad(quad: np.ndarray) -> np.ndarray:
    return cv2.getPerspectiveTransform(np.float32([[0, 0], [1, 0], [1, 1], [0, 1]]), np.float32(quad))


def uv_field(quad: np.ndarray, w: int, h: int):
    """uv = H⁻¹·p over the quad's bounding box (sign-oriented, like imageToTexture)."""
    x0, y0 = np.floor(quad.min(0)).astype(int)
    x1, y1 = np.ceil(quad.max(0)).astype(int)
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
    if x1 <= x0 or y1 <= y0:
        return None
    inv = np.linalg.inv(unit_to_quad(quad))
    if (inv @ np.append(quad.mean(0), 1))[2] < 0:
        inv = -inv
    xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    q = np.stack([xs, ys, np.ones_like(xs)], -1) @ inv.T
    uv = q[..., :2] / q[..., 2:3]
    ok = (q[..., 2] > 0) & (uv >= 0).all(-1) & (uv <= 1).all(-1)
    return (slice(y0, y1), slice(x0, x1)), uv, ok


def composite(room: np.ndarray, H: np.ndarray, rug: np.ndarray, pose, alpha: np.ndarray,
              shading: np.ndarray | None, illum: np.ndarray) -> np.ndarray:
    out = room.astype(np.float32) / 255
    h, w = out.shape[:2]
    cx, cy, rw, rh, rot = pose
    # --- soft shadow (buildScene.ts: margin 3.5%, nudged 0.35·margin towards the camera)
    margin = max(4.0, 0.035 * max(rw, rh))
    sq = project(H, rug_corners(cx, cy + 0.35 * margin, rw + 2 * margin, rh + 2 * margin, rot))
    if sq is not None:
        f = uv_field(sq, w, h)
        if f:
            sl, uv, _ = f
            soft = np.array([2 * margin / (rw + 2 * margin), 2 * margin / (rh + 2 * margin)])
            d = np.minimum(uv, 1 - uv)
            ss = lambda e, x: np.clip(x / e, 0, 1) ** 2 * (3 - 2 * np.clip(x / e, 0, 1))
            a = np.where((d >= 0).all(-1), ss(soft[0], d[..., 0]) * ss(soft[1], d[..., 1]), 0)
            a = a * SHADOW_STRENGTH * alpha[sl]
            out[sl] *= (1 - a[..., None])
    # --- rug
    q = project(H, rug_corners(cx, cy, rw, rh, rot))
    if q is None:
        return (out * 255).astype(np.uint8)
    f = uv_field(q, w, h)
    if not f:
        return (out * 255).astype(np.uint8)
    sl, uv, ok = f
    # Mipmap stand-in: pre-shrink the texture to about its on-screen size, then bilinear.
    edge = max(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[3] - q[0]), 8)
    th, tw = rug.shape[:2]
    s = min(1.0, 1.5 * edge / max(th, tw))
    tex = cv2.resize(rug, (max(2, round(tw * s)), max(2, round(th * s))), interpolation=cv2.INTER_AREA) if s < 1 else rug
    th, tw = tex.shape[:2]
    col = cv2.remap(tex, (uv[..., 0] * (tw - 1)).astype(np.float32), (uv[..., 1] * (th - 1)).astype(np.float32),
                    cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    lin = srgb_to_linear(col)
    if shading is not None:
        lin = lin * shading[sl][..., None] * illum
    rgb = to_srgb(lin)
    a = ok * alpha[sl]
    out[sl] = rgb * a[..., None] + out[sl] * (1 - a[..., None])
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def object_foot(alpha: np.ndarray, mask: np.ndarray) -> tuple[float, float] | None:
    """Bottom-centre of the largest non-floor blob enclosed by the cleaned floor (stool, table)."""
    occl = ((alpha < 0.5) & (mask >= 0.5)).astype(np.uint8)
    n, cc, stats, _ = cv2.connectedComponentsWithStats(occl, connectivity=8)
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.nonzero(cc == i)
    return float(np.median(xs)), float(ys.max())


def crop_box(H, pose, w, h, pad=0.12):
    q = project(H, rug_corners(*pose))
    if q is None:
        return 0, 0, w, h
    x0, y0 = q.min(0)
    x1, y1 = q.max(0)
    px, py = pad * w, pad * h
    return int(max(0, x0 - px)), int(max(0, y0 - py)), int(min(w, x1 + px)), int(min(h, y1 + py))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rooms", nargs="+", required=True)
    ap.add_argument("--rugs", nargs="+", required=True)
    ap.add_argument("--out", default="rugs_out")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    settings = Settings()
    models = ModelRegistry(settings)
    rugs = {Path(p).stem: load_rug(Path(p)) for p in args.rugs}
    log = []
    for ri, room_path in enumerate(args.rooms):
        img = load_image(Path(room_path).read_bytes(), settings.max_upload_bytes, settings.max_pixels)
        res = analyze(img, models, settings.work_long_edge)
        room = img.rgb
        h, w = room.shape[:2]
        if not res["floor"]["detected"] or not res["geometry"]:
            log.append({"room": Path(room_path).name, "detected": False})
            print(Path(room_path).name, "no floor")
            continue
        H = np.array(res["geometry"]["homography"]).reshape(3, 3)
        Hinv = np.linalg.inv(H)
        alpha = decode_png(res["floor"]["occlusionPng"], w, h)
        mask = decode_png(res["floor"]["maskPng"], w, h)
        light = res["lighting"]
        shading = decode_png(light["shadingPng"], w, h) * light["shadingScale"] if light else None
        illum = np.array(light["illuminant"] if light else [1, 1, 1], np.float32)

        sites = {"suggested": (res["placement"]["x"], res["placement"]["y"])}
        foot = object_foot(alpha, mask)
        if foot:
            sites["under-object"] = tuple(apply_h(Hinv, np.array([foot]))[0])
        names = list(rugs)
        for si, (site, (cx, cy)) in enumerate(sites.items()):
            name = names[(ri + si) % len(names)]
            rug = rugs[name]
            rh_cm = RUG_WIDTH_CM * rug.shape[0] / rug.shape[1]
            pose = (cx, cy, RUG_WIDTH_CM, rh_cm, 90.0 if rh_cm > RUG_WIDTH_CM else 0.0)
            old = composite(room, H, rug, pose, (mask >= 0.5).astype(np.float32), None, illum * 0 + 1)
            new = composite(room, H, rug, pose, alpha, shading, illum)
            x0, y0, x1, y1 = crop_box(H, pose, w, h)
            pair = np.hstack([old[y0:y1, x0:x1], np.full((y1 - y0, 6, 3), 255, np.uint8), new[y0:y1, x0:x1]])
            scale = 900 / pair.shape[1] if pair.shape[1] > 900 else 1.0
            pair = cv2.resize(pair, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            fn = f"{Path(room_path).stem}__{site}__{name}.jpg"
            cv2.imwrite(str(out / fn), cv2.cvtColor(pair, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 88])
            full = out / "full"
            full.mkdir(exist_ok=True)
            cv2.imwrite(str(full / fn), cv2.cvtColor(new, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 88])
        log.append({"room": Path(room_path).name, "detected": True, "sites": list(sites),
                    "method": res["geometry"]["method"], "illuminant": light["illuminant"] if light else None,
                    "timingsMs": res["timingsMs"]})
        print(json.dumps(log[-1]))
    (out / "log.json").write_text(json.dumps(log, indent=2))


if __name__ == "__main__":
    main()
