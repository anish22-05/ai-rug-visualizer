"""Run the analysis pipeline on images and save debug visualisations.

    python scripts/visualize_analysis.py ../samples/*.jpg --out ../docs/debug

Each output shows: floor mask (green tint), floor polygon (yellow), a projected
50 cm floor grid (cyan, which visually validates the homography), the horizon
(magenta), detected lines (orange) and the suggested rug placement (red circle).
A second image, `<name>_occlusion.jpg`, tints the soft occlusion alpha (green = the
rug shows, untinted = an occluder stands in front of it), and `<name>_shading.jpg`
shows the floor shading map (mid-grey ≈ typical floor light, darker = shadow).
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import Settings  # noqa: E402
from app.services.analyzer import analyze  # noqa: E402
from app.services.floor_geometry import apply_h  # noqa: E402
from app.services.image_io import load_image  # noqa: E402
from app.services.models import ModelRegistry  # noqa: E402


def draw(result: dict, rgb: np.ndarray) -> np.ndarray:
    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy()
    h, w = img.shape[:2]
    mask = cv2.imdecode(np.frombuffer(__import__("base64").b64decode(result["floor"]["maskPng"]), np.uint8), 0)
    mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
    tint = img.copy()
    tint[mask > 0] = (0.5 * tint[mask > 0] + [0, 110, 0]).clip(0, 255)
    img = tint
    poly = np.array(result["floor"]["polygon"], np.int32)
    if len(poly):
        cv2.polylines(img, [poly], True, (0, 230, 255), 3)

    geo = result.get("geometry")
    if geo:
        H = np.array(geo["homography"]).reshape(3, 3)
        for line in result["debug"].get("lines", []):
            x1, y1, x2, y2 = map(int, line)
            cv2.line(img, (x1, y1), (x2, y2), (0, 140, 255), 1)
        # Floor grid, 50 cm spacing, clipped to the floor mask.
        grid = np.zeros((h, w), np.uint8)
        for k in range(-20, 21):
            c = k * 50.0
            ts = np.linspace(-1000, 600, 400)
            for pts in (np.stack([np.full_like(ts, c), ts], 1), np.stack([ts, np.full_like(ts, c)], 1)):
                img_pts = apply_h(H, pts)
                hom = np.hstack([pts, np.ones((len(pts), 1))]) @ H.T
                ok = hom[:, 2] > 0
                img_pts = img_pts[ok]
                img_pts = img_pts[(np.abs(img_pts) < 1e5).all(1)]
                if len(img_pts) > 1:
                    cv2.polylines(grid, [img_pts.astype(np.int32)], False, 255, 2)
        grid[mask == 0] = 0
        img[grid > 0] = (255, 255, 0)
        if geo["horizonY"] is not None:
            y = int(geo["horizonY"])
            cv2.line(img, (0, y), (w, y), (255, 0, 255), 2)
        pl = result.get("placement")
        if pl:
            center = apply_h(H, np.array([[pl["x"], pl["y"]]]))[0]
            ring = apply_h(H, np.array([[pl["x"] + pl["radiusCm"] * np.cos(t), pl["y"] + pl["radiusCm"] * np.sin(t)]
                                        for t in np.linspace(0, 2 * np.pi, 60)]))
            cv2.polylines(img, [ring.astype(np.int32)], True, (0, 0, 255), 3)
            cv2.circle(img, tuple(center.astype(int)), 6, (0, 0, 255), -1)
        label = f"{geo['method']}  pitch={geo['pitchDeg']}  roll={geo['rollDeg']}  h={geo['cameraHeightM']}m  conf={result['floor']['confidence']}"
    else:
        label = f"NO FLOOR  conf={result['floor']['confidence']} area={result['floor']['areaRatio']}"
    cv2.rectangle(img, (0, 0), (w, 44), (0, 0, 0), -1)
    cv2.putText(img, label, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
    return img


def draw_occlusion(result: dict, rgb: np.ndarray) -> np.ndarray:
    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).astype(np.float32)
    h, w = img.shape[:2]
    alpha = cv2.imdecode(np.frombuffer(__import__("base64").b64decode(result["floor"]["occlusionPng"]), np.uint8), 0)
    alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)[..., None] / 255
    out = img * (1 - 0.55 * alpha) + np.array([0, 255, 80], np.float32) * 0.55 * alpha
    return out.clip(0, 255).astype(np.uint8)


def draw_shading(result: dict) -> np.ndarray | None:
    """Grey map of the floor shading (white = shading 1.25, mid-grey ≈ 1.0)."""
    light = result.get("lighting")
    if not light:
        return None
    img = cv2.imdecode(np.frombuffer(__import__("base64").b64decode(light["shadingPng"]), np.uint8), 0)
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default="debug_out")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    settings = Settings()
    models = ModelRegistry(settings)
    summary = []
    for path in args.images:
        data = Path(path).read_bytes()
        image = load_image(data, settings.max_upload_bytes, settings.max_pixels)
        result = analyze(image, models, settings.work_long_edge)
        cv2.imwrite(str(out / (Path(path).stem + ".jpg")), draw(result, image.rgb), [cv2.IMWRITE_JPEG_QUALITY, 85])
        cv2.imwrite(str(out / (Path(path).stem + "_occlusion.jpg")), draw_occlusion(result, image.rgb),
                    [cv2.IMWRITE_JPEG_QUALITY, 85])
        shade = draw_shading(result)
        if shade is not None:
            cv2.imwrite(str(out / (Path(path).stem + "_shading.jpg")), shade, [cv2.IMWRITE_JPEG_QUALITY, 85])
        geo = result["geometry"] or {}
        row = {"image": Path(path).name, "detected": result["floor"]["detected"],
               "confidence": result["floor"]["confidence"], "areaRatio": result["floor"]["areaRatio"],
               "method": geo.get("method"), "pitchDeg": geo.get("pitchDeg"), "rollDeg": geo.get("rollDeg"),
               "cameraHeightM": geo.get("cameraHeightM"), "inlierRatio": result["debug"].get("inlierRatio"),
               "timingsMs": result["timingsMs"]}
        summary.append(row)
        print(json.dumps(row))
    (out / "summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
