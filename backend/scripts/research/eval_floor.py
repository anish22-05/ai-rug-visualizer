"""Quantitative floor-detection and occlusion evaluation on held-out ADE20K validation rooms.

    python scripts/research/eval_floor.py --meta <dir>/meta.json --cache <dir>/img --n 60 --out ../docs/eval

The ADE20K *validation* split is not used to train either segmenter, so it is a fair
held-out test. Ground truth is rasterised from the per-object polygons (the hosted
label PNGs are re-encoded as lossy JPEG). Floor = ADE "floor" ∪ "rug/carpet".

Three pipelines are compared on identical images:

* ``baseline``  – the shipped code before the realism work: SegFormer-B2 on a squashed
  512x512 input; the *cleaned* mask was used for occlusion.
* ``segformer`` – current code with SegFormer (aspect ratio kept): the SEG_MODEL fallback.
* ``eomt``      – current code with EoMT-L (default): cleaned mask + soft occlusion alpha.

Metrics (per image, then mean / median):

* floor IoU / precision / recall and boundary F1 of the cleaned mask (placement region);
* ``occluder recall``: share of GT non-floor pixels *enclosed by floor* (stools, legs,
  table bases) that the occlusion layer keeps in front of a rug;
* rug test: three 160x230 cm rugs are dropped on floor next to objects, using the
  pipeline's own homography. ``leak`` = share of non-floor pixels inside the rug
  footprint that the rug wrongly covers; ``hole`` = share of floor inside the footprint
  where the rug wrongly disappears. Both pipelines use the same footprints.

Images are research-only (ADE20K licence), so they stay in --cache, never in the repo.
"""

import argparse
import base64
import json
import statistics
import sys
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import torch
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core.config import Settings  # noqa: E402
from app.services import postprocess  # noqa: E402
from app.services.analyzer import analyze  # noqa: E402
from app.services.floor_geometry import apply_h  # noqa: E402
from app.services.image_io import LoadedImage  # noqa: E402
from app.services.models import ModelRegistry  # noqa: E402
from app.services.segmentation import FLOOR_LABELS, _resolve  # noqa: E402

FLOOR_NAMES = {"floor", "flooring", "rug", "carpet", "carpeting"}
LAYOUT_NAMES = {"wall", "ceiling", "sky"}
HOME = ("living room", "bedroom", "dining room", "kitchen", "home office", "childs room", "nursery",
        "playroom", "hotel room", "game room", "waiting room", "lobby", "office", "television room",
        "recreation room", "parlor", "artists loft", "attic", "basement", "corridor", "entrance hall")
RUG_CM = (160.0, 230.0)
SEGFORMER = "nvidia/segformer-b2-finetuned-ade-512-512"


# ---------------------------------------------------------------- data

def fetch(url: str, path: Path) -> np.ndarray:
    if not path.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "room-visualizer-eval/1.0"})
        path.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    return cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2RGB)


def gt_floor(meta: dict, h: int, w: int) -> np.ndarray:
    """Paint whole-object polygons back to front; floor = 1.

    ADE's depth_ordering_rank is not consistent between images (a floor polygon is
    sometimes ranked in front of the sofa standing on it), so layout surfaces are
    painted first, then rugs, then every other object by rank (higher = nearer).
    """
    lab = np.zeros((h, w), np.uint8)  # 0 unlabeled, 1 floor, 2 other
    objs = [o for o in meta["objects"] if o["level"] == 0 and len(o["x"]) >= 3]

    def layer(o: dict) -> tuple[int, int]:
        primary = {n.strip() for n in o["name"].lower().split(",")}
        if primary & (LAYOUT_NAMES | {"floor", "flooring"}):
            return 0, o["rank"]
        if primary & {"rug", "carpet", "carpeting"}:
            return 1, o["rank"]
        return 2, o["rank"]

    for o in sorted(objs, key=layer):
        pts = np.stack([o["x"], o["y"]], 1).astype(np.int32)
        primary = {n.strip() for n in o["name"].lower().split(",")}
        cv2.fillPoly(lab, [pts], 1 if primary & FLOOR_NAMES else 2)
    return lab


def is_home(meta: dict) -> bool:
    s = " ".join(meta["scene"]).replace("_", " ")
    return any(h in s for h in HOME)


# ---------------------------------------------------------------- baseline (pre-realism code)

@torch.inference_mode()
def baseline_floor(rgb: np.ndarray, seg, device) -> np.ndarray:
    """Old pipeline: SegFormer on the processor's squashed 512x512 input, cleaned mask."""
    h, w = rgb.shape[:2]
    inputs = seg.processor(images=rgb, return_tensors="pt").to(device)
    logits = seg.model(**inputs).logits
    s = 512 / max(h, w)
    logits = torch.nn.functional.interpolate(logits, size=(max(1, round(h * s)), max(1, round(w * s))),
                                             mode="bilinear", align_corners=False)
    probs = logits.softmax(dim=1)[0]
    ids = _resolve(seg.model.config.id2label, FLOOR_LABELS)
    labels = cv2.resize(probs.argmax(0).to(torch.int32).cpu().numpy(), (w, h), interpolation=cv2.INTER_NEAREST)
    prob = cv2.resize(probs[ids].sum(0).float().cpu().numpy(), (w, h), interpolation=cv2.INTER_LINEAR)
    return postprocess.extract_floor(labels, prob, ids).mask


# ---------------------------------------------------------------- metrics

def decode(b64: str, w: int, h: int) -> np.ndarray:
    m = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), 0)
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255


def boundary_f1(pred: np.ndarray, gt: np.ndarray, tol: int) -> float:
    def edge(m):
        m = m.astype(np.uint8)
        return (m - cv2.erode(m, np.ones((3, 3), np.uint8))) > 0
    pe, ge = edge(pred), edge(gt)
    if not pe.any() or not ge.any():
        return float(pe.any() == ge.any())
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * tol + 1, 2 * tol + 1))
    gd, pd = cv2.dilate(ge.astype(np.uint8), k) > 0, cv2.dilate(pe.astype(np.uint8), k) > 0
    p, r = (pe & gd).sum() / pe.sum(), (ge & pd).sum() / ge.sum()
    return float(2 * p * r / (p + r)) if p + r else 0.0


def region_metrics(pred: np.ndarray, gt: np.ndarray, valid: np.ndarray) -> dict:
    p, g = pred & valid, gt & valid
    inter, union = (p & g).sum(), (p | g).sum()
    return {"iou": inter / union if union else 1.0,
            "precision": inter / p.sum() if p.sum() else 1.0,
            "recall": inter / g.sum() if g.sum() else 1.0}


def enclosed_occluders(gt: np.ndarray) -> np.ndarray:
    """GT non-floor pixels completely surrounded by floor (stools, legs, table bases...)."""
    floor = gt == 1
    return ndimage.binary_fill_holes(floor) & ~floor & (gt == 2)


def rug_sites(gt: np.ndarray, rng: np.random.Generator, k: int = 3) -> list[tuple[float, float]]:
    """Floor pixels 4-30 px away from a non-floor object, i.e. rugs placed next to furniture."""
    floor = (gt == 1).astype(np.uint8)
    dist = cv2.distanceTransform(floor, cv2.DIST_L2, 5)
    hull = ndimage.binary_fill_holes(floor > 0)
    cand = np.argwhere((dist >= 4) & (dist <= 30) & hull)
    if len(cand) == 0:
        cand = np.argwhere(floor > 0)
    if len(cand) == 0:
        return []
    pick = cand[rng.choice(len(cand), size=min(k, len(cand)), replace=False)]
    return [(float(x), float(y)) for y, x in pick]


def footprint(H: np.ndarray, center_px, w: int, h: int) -> np.ndarray | None:
    Hinv = np.linalg.inv(H)
    cx, cy = apply_h(Hinv, np.array([center_px]))[0]
    hw, hh = RUG_CM[0] / 2, RUG_CM[1] / 2
    corners = np.array([[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]])
    hom = np.hstack([corners, np.ones((4, 1))]) @ H.T
    if not (np.sign(hom[:, 2]) == np.sign(hom[0, 2])).all():
        return None  # rug crosses the horizon at this spot
    q = hom[:, :2] / hom[:, 2:3]
    if np.abs(q).max() > 1e5:
        return None
    m = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(m, np.round(q).astype(np.int32), 1)
    return m > 0


def rug_errors(fp: np.ndarray, alpha: np.ndarray, gt: np.ndarray) -> dict:
    lab = gt > 0
    shown = alpha >= 0.5
    other, floor = fp & lab & (gt == 2), fp & lab & (gt == 1)
    return {"leak": shown[other].mean() if other.any() else None,
            "hole": (~shown[floor]).mean() if floor.any() else None,
            "other_px": int(other.sum()), "floor_px": int(floor.sum())}


# ---------------------------------------------------------------- main

def summarize(rows: list[dict], key: str) -> dict:
    vals = [r[key] for r in rows if r.get(key) is not None]
    if not vals:
        return {}
    return {"mean": round(float(np.mean(vals)), 4), "median": round(float(np.median(vals)), 4), "n": len(vals)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--meta", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--negatives", type=int, default=15)
    ap.add_argument("--out", default="eval_out")
    ap.add_argument("--panels", type=int, default=0, help="also save N side-by-side panels to --cache")
    args = ap.parse_args()
    cache, out = Path(args.cache), Path(args.out)
    cache.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)

    meta = json.loads(Path(args.meta).read_text())
    rng = np.random.default_rng(7)
    pos, neg = [], []
    # Seeded random order: the index is alphabetical by scene, which would bias the sample.
    for k in np.random.default_rng(0).permutation(len(meta)):
        m = meta[k]
        if not m["image"]:
            continue
        names = {n.strip() for o in m["objects"] if o["level"] == 0 for n in o["name"].lower().split(",")}
        if is_home(m) and names & FLOOR_NAMES and len(pos) < args.n:
            pos.append(m)
        elif not (names & FLOOR_NAMES) and len(neg) < args.negatives and ("outdoor" in m["scene"] or is_home(m)):
            neg.append(m)

    s = Settings()
    eomt = ModelRegistry(s)
    segf = ModelRegistry(s.model_copy(update={"seg_model": SEGFORMER}))
    torch.set_num_threads(max(1, torch.get_num_threads()))

    rows = {"baseline": [], "segformer": [], "eomt": []}
    neg_rows = {"baseline": [], "segformer": [], "eomt": []}
    for i, m in enumerate(pos + neg):
        is_pos = i < len(pos)
        try:
            rgb = fetch(m["image"], cache / f"{m['idx']:04d}.jpg")
        except Exception as e:  # noqa: BLE001
            print("skip", m["file"], e)
            continue
        h, w = rgb.shape[:2]
        gt = gt_floor(m, h, w)
        if is_pos and (gt == 1).mean() < 0.03:
            continue
        valid = gt > 0
        tol = max(2, round(0.005 * np.hypot(h, w)))
        occl_gt = enclosed_occluders(gt)
        sites = rug_sites(gt, rng)

        img = LoadedImage(rgb, None)
        t0 = time.perf_counter()
        base_mask = baseline_floor(rgb, segf.segmentation, segf.device) > 0
        base_ms = (time.perf_counter() - t0) * 1000
        results = {
            "eomt": analyze(img, eomt, s.work_long_edge),
            "segformer": analyze(img, segf, s.work_long_edge),
        }
        H_ref = None
        if results["eomt"]["geometry"]:
            H_ref = np.array(results["eomt"]["geometry"]["homography"]).reshape(3, 3)
        fps = [f for f in (footprint(H_ref, c, w, h) for c in sites) if f is not None] if H_ref is not None else []

        for name in ("baseline", "segformer", "eomt"):
            if name == "baseline":
                mask = base_mask
                alpha = base_mask.astype(np.float32)  # old frontend occluded with the cleaned mask
                detected = bool(mask.mean() >= postprocess.MIN_FLOOR_AREA_RATIO)
                row = {"timing_ms": base_ms}
            else:
                r = results[name]
                mask = decode(r["floor"]["maskPng"], w, h) >= 0.5
                alpha = decode(r["floor"]["occlusionPng"], w, h)
                detected = r["floor"]["detected"]
                geo = r["geometry"] or {}
                row = {"timing_ms": r["timingsMs"]["total"], "method": geo.get("method"),
                       "camera_h": geo.get("cameraHeightM"), "pitch": geo.get("pitchDeg")}
            row.update({"image": m["file"], "scene": m["scene"][-1], "detected": detected})
            if not is_pos:
                neg_rows[name].append(row)
                continue
            row.update(region_metrics(mask, gt == 1, valid))
            row["boundary_f1"] = boundary_f1(mask & valid, (gt == 1), tol)
            row["occluder_recall"] = float((alpha[occl_gt] < 0.5).mean()) if occl_gt.sum() >= 20 else None
            errs = [rug_errors(f, alpha, gt) for f in fps]
            leaks = [e["leak"] for e in errs if e["leak"] is not None and e["other_px"] >= 50]
            holes = [e["hole"] for e in errs if e["hole"] is not None and e["floor_px"] >= 50]
            row["rug_leak"] = float(np.mean(leaks)) if leaks else None
            row["rug_hole"] = float(np.mean(holes)) if holes else None
            rows[name].append(row)

        if args.panels and is_pos and len(rows["eomt"]) <= args.panels:
            tint = lambda a, col: (rgb * (1 - 0.5 * a[..., None]) + np.array(col) * 0.5 * a[..., None]).astype(np.uint8)
            gt_vis = tint((gt == 1).astype(np.float32), (0, 255, 80))
            panel = np.hstack([gt_vis, tint(base_mask.astype(np.float32), (255, 160, 0)),
                               tint(decode(results["eomt"]["floor"]["occlusionPng"], w, h), (0, 160, 255))])
            cv2.imwrite(str(cache / f"panel_{m['idx']:04d}.jpg"), cv2.cvtColor(panel, cv2.COLOR_RGB2BGR))
        e = rows["eomt"][-1] if is_pos and rows["eomt"] else None
        print(f"[{i + 1}/{len(pos) + len(neg)}] {m['file']} {'pos' if is_pos else 'neg'}"
              + (f" iou base={rows['baseline'][-1]['iou']:.3f} eomt={e['iou']:.3f}" if e else ""), flush=True)

    keys = ["iou", "precision", "recall", "boundary_f1", "occluder_recall", "rug_leak", "rug_hole", "timing_ms"]
    summary = {}
    for name in rows:
        pr, nr = rows[name], neg_rows[name]
        summary[name] = {k: summarize(pr, k) for k in keys}
        summary[name]["detection_rate"] = round(float(np.mean([r["detected"] for r in pr])), 3) if pr else None
        summary[name]["false_detection_rate"] = round(float(np.mean([r["detected"] for r in nr])), 3) if nr else None
        if name != "baseline":
            methods = [r.get("method") for r in pr if r.get("method")]
            summary[name]["geometry_methods"] = {mm: methods.count(mm) for mm in sorted(set(methods))}
            hs = [r["camera_h"] for r in pr if r.get("camera_h")]
            summary[name]["camera_height_m"] = {"median": round(statistics.median(hs), 2),
                                                "min": min(hs), "max": max(hs)} if hs else None
    summary["counts"] = {"positives": len(rows["eomt"]), "negatives": len(neg_rows["eomt"])}
    (out / "ade_summary.json").write_text(json.dumps(summary, indent=2))
    (out / "ade_rows.json").write_text(json.dumps({"positives": rows, "negatives": neg_rows}, indent=1, default=float))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
