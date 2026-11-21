"""Is the assumed focal length right? Floor planks are parallel in reality; under the
correct homography their back-projected directions should agree. Sweep f and measure."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]  # repo root
sys.path.insert(0, str(ROOT / "backend"))
import os, time
import numpy as np
from app.core.config import Settings
from app.services.models import ModelRegistry
from app.services.image_io import load_image, resize_long_edge
from app.services.segmentation import segment
from app.services.postprocess import extract_floor
from app.services.depth import estimate_depth
from app.services import floor_geometry as fg
from app.services.vanishing import detect_floor_lines

s = Settings(); m = ModelRegistry(s)
for name in sys.argv[1:]:
    img = load_image(open(name, "rb").read(), s.max_upload_bytes, s.max_pixels)
    work, _ = resize_long_edge(img.rgb, 1024)
    h, w = work.shape[:2]
    seg = segment(work, m.segmentation, m.device)
    floor = extract_floor(seg.labels, seg.floor_prob, seg.floor_ids)
    depth = estimate_depth(work, m.depth, m.device)
    lines = detect_floor_lines(work, floor.mask)
    lengths = np.hypot(lines[:, 2] - lines[:, 0], lines[:, 3] - lines[:, 1])
    print(f"\n{name.split('/')[-1]}  lines={len(lines)}")
    for f35 in [16, 20, 24, 28, 32, 38, 45, 55]:
        K = fg.intrinsics_for(w, h, f35)
        fit = fg.fit_floor_plane(depth, floor.mask, K)
        if fit is None:
            continue
        geo = fg.build_homography(fit.normal, fit.height, K, floor.centroid, "x")
        Hi = np.linalg.inv(geo.H)
        a = fg.apply_h(Hi, lines[:, :2]); b = fg.apply_h(Hi, lines[:, 2:])
        ang = np.arctan2(b[:, 1] - a[:, 1], b[:, 0] - a[:, 0])
        # Doubled-angle circular statistics (direction mod 180°), length-weighted.
        z = (lengths * np.exp(2j * ang)).sum() / lengths.sum()
        spread = np.degrees(np.sqrt(-2 * np.log(max(abs(z), 1e-9))) / 2)
        print(f"  f35={f35:>3}mm  hfov={np.degrees(2*np.arctan(18/f35)):5.1f}°  pitch={geo.pitch_deg:6.2f}  h={fit.height:4.2f}m  inl={fit.inlier_ratio:.2f}  plank-direction spread={spread:5.1f}°")
