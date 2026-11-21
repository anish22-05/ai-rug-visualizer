"""Offline prototype: current compositing vs. proposed realistic compositing."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]  # repo root
sys.path.insert(0, str(ROOT / "backend"))
import os, time
import cv2, numpy as np, torch
from PIL import Image
from transformers import AutoImageProcessor, EomtForUniversalSegmentation
from app.core.config import Settings
from app.services.models import ModelRegistry
from app.services.image_io import load_image
from app.services.analyzer import analyze
from app.services.floor_geometry import apply_h

OUT = str(ROOT / "docs" / "research" / "proto") + "/"
os.makedirs(OUT, exist_ok=True)
SRC = str(ROOT / "samples" / "living-room-wood.jpg")
s = Settings(); m = ModelRegistry(s)
img_l = load_image(open(SRC, "rb").read(), s.max_upload_bytes, s.max_pixels)
res = analyze(img_l, m, 1024)
H = np.array(res["geometry"]["homography"]).reshape(3, 3)
Hi = np.linalg.inv(H)
img = img_l.rgb.astype(np.float32) / 255
Hh, Ww = img.shape[:2]

to_lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
to_srgb = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)

# ---------------- current occlusion mask (cleaned, as shipped)
import base64
cur_mask = cv2.imdecode(np.frombuffer(base64.b64decode(res["floor"]["maskPng"]), np.uint8), 0)
cur_mask = cv2.resize(cur_mask, (Ww, Hh), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255

# ---------------- proposed occlusion: EoMT floor prob + guided filter (edge-snapped soft alpha)
name = "tue-mps/ade20k_semantic_eomt_large_512"
proc = AutoImageProcessor.from_pretrained(name); eom = EomtForUniversalSegmentation.from_pretrained(name).eval()
with torch.inference_mode():
    out = eom(**proc(images=img_l.rgb, return_tensors="pt"))
seg = proc.post_process_semantic_segmentation(out, target_sizes=[(Hh, Ww)])[0].numpy()
fids = [int(i) for i, l in eom.config.id2label.items() if str(l).split(",")[0].strip().lower() in ("floor", "rug")]
floor_hard = np.isin(seg, fids).astype(np.float32)

def guided(I, p, r, eps):
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    mI, mp = box(I), box(p); a = (box(I * p) - mI * mp) / (box(I * I) - mI * mI + eps); b = mp - a * mI
    return box(a) * I + box(b)
gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
new_mask = np.clip(guided(gray, floor_hard, 4, 2e-3), 0, 1)

# ---------------- proposed shading layer: masked (normalized) blur of floor luminance
lin = to_lin(img)
lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
w = (floor_hard > 0.5).astype(np.float32)
sig = 0.012 * Ww
num = cv2.GaussianBlur(np.log(lum + 1e-4) * w, (0, 0), sig); den = cv2.GaussianBlur(w, (0, 0), sig)
loglum = num / np.maximum(den, 1e-4)           # fills holes under furniture from surrounding floor
ref = np.median(np.log(lum + 1e-4)[w > 0])
shading = np.exp(loglum - ref)
shading = np.clip(shading, 0.25, 1.08)         # rugs are matte: no specular highlights transferred

# current shading (as shipped): heavily blurred, unmasked, clamped 0.45..1.2, 80% strength
cs = cv2.GaussianBlur(lum, (0, 0), 0.06 * Ww * 0.5)
cur_shading = np.clip((cs / (lum[w > 0].mean())) ** (1 / 2.2), 0.45, 1.2) * 0.8 + 0.2

# illuminant (white balance) of the scene from bright neutral-ish pixels (walls/ceiling)
bright = lum > np.percentile(lum, 85)
illum = lin[bright].mean(0); illum = illum / illum.mean()

tex = np.asarray(Image.open(str(ROOT / "backend" / "static" / "rugs" / "classic-pattern.png")).convert("RGBA")).astype(np.float32) / 255

def rug_quad(cx, cy, w_cm, h_cm, rot, lift_cm=0.0):
    r = np.radians(rot); c, s_ = np.cos(r), np.sin(r)
    pts = np.array([[-w_cm / 2, -h_cm / 2], [w_cm / 2, -h_cm / 2], [w_cm / 2, h_cm / 2], [-w_cm / 2, h_cm / 2]])
    pts = pts @ np.array([[c, s_], [-s_, c]]) + [cx, cy]
    if lift_cm == 0:
        return apply_h(H, pts)
    # raised plane: shift along the floor normal in 3D (approximation: use camera-space plane offset)
    n = np.array(res["geometry"]["normal"]); K = np.array([[res["geometry"]["intrinsics"]["f"], 0, res["geometry"]["intrinsics"]["cx"]], [0, res["geometry"]["intrinsics"]["f"], res["geometry"]["intrinsics"]["cy"]], [0, 0, 1]])
    Kinv = np.linalg.inv(K)
    out = []
    for p in apply_h(H, pts):
        ray = Kinv @ np.array([p[0], p[1], 1.0]); t = -res["geometry"]["cameraHeightM"] / (n @ ray)
        X = t * ray + n * lift_cm / 100
        q = K @ X; out.append(q[:2] / q[2])
    return np.array(out)

def warp(quad):
    src = np.float32([[0, 0], [tex.shape[1], 0], [tex.shape[1], tex.shape[0]], [0, tex.shape[0]]])
    M = cv2.getPerspectiveTransform(src, np.float32(quad))
    return cv2.warpPerspective(tex, M, (Ww, Hh), flags=cv2.INTER_AREA, borderValue=0)

def render(cx, cy, mode):
    w_cm, h_cm, rot = 120, 180, 90
    base = lin.copy()
    if mode == "current":
        q = rug_quad(cx, cy, w_cm, h_cm, rot); t = warp(q)
        a = t[..., 3] * cur_mask; col = to_lin(t[..., :3]) * cur_shading[..., None]
        return to_srgb(base * (1 - a[..., None]) + col * a[..., None])
    # 1) contact shadow / ambient occlusion on the floor right around the rug
    q0 = rug_quad(cx, cy, w_cm, h_cm, rot)
    ao = np.zeros((Hh, Ww), np.float32); cv2.fillConvexPoly(ao, np.int32(rug_quad(cx, cy, w_cm + 6, h_cm + 6, rot)), 1.0)
    ao = cv2.GaussianBlur(ao, (0, 0), 3.0) * 0.45 * new_mask
    base = base * (1 - ao[..., None])
    # 2) rug thickness: top surface lifted 1.2 cm; side faces darker
    q1 = rug_quad(cx, cy, w_cm, h_cm, rot, lift_cm=1.2)
    side = np.zeros((Hh, Ww), np.float32)
    for i in range(4):
        poly = np.int32([q0[i], q0[(i + 1) % 4], q1[(i + 1) % 4], q1[i]]); cv2.fillConvexPoly(side, poly, 1.0)
    t = warp(q1)
    edge_col = to_lin(np.array([0.55, 0.12, 0.13])) * 0.35  # rug side in self-shadow
    side = side * (1 - (t[..., 3] > 0.5)) * new_mask
    base = base * (1 - side[..., None]) + edge_col * shading[..., None] * side[..., None]
    # 3) rug top: albedo * scene shading * illuminant, mild contrast compression, slight blur + grain
    alb = to_lin(t[..., :3])
    alb = 0.03 + alb * 0.9                                           # photo black level / compression
    col = alb * shading[..., None] * illum[None, None, :]
    col = cv2.GaussianBlur(col, (0, 0), 0.7)
    a = cv2.GaussianBlur(t[..., 3], (0, 0), 0.6) * new_mask
    noise = np.random.default_rng(0).normal(0, 0.006, col.shape[:2])[..., None]
    out = base * (1 - a[..., None]) + (col + noise) * a[..., None]
    return to_srgb(out)

cases = {"near_stool": (Ww * 0.27, Hh * 0.84), "near_sofa": (Ww * 0.68, Hh * 0.80)}
for cname, (px, py) in cases.items():
    cx, cy = apply_h(Hi, np.array([[px, py]]))[0]
    a = render(cx, cy, "current"); b = render(cx, cy, "new")
    x0, x1 = int(max(0, px - 0.22 * Ww)), int(min(Ww, px + 0.22 * Ww)); y0, y1 = int(py - 0.2 * Hh), Hh
    tile = np.hstack([a[y0:y1, x0:x1], np.ones((y1 - y0, 6, 3)), b[y0:y1, x0:x1]])
    Image.fromarray((np.clip(tile, 0, 1) * 255).astype(np.uint8)).save(OUT + f"{cname}.jpg", quality=90)
Image.fromarray((np.clip(shading / 1.1, 0, 1) * 255).astype(np.uint8)).save(OUT + "shading_layer.jpg")
print("illuminant", illum.round(3), "focal", res["geometry"]["intrinsics"]["f"])
