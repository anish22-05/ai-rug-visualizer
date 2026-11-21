"""Compare floor/occluder segmentation quality on known failure regions."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]  # repo root
sys.path.insert(0, str(ROOT / "backend"))
import os, time
import cv2, numpy as np, torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForSemanticSegmentation

OUT = str(ROOT / "docs" / "research" / "segcmp") + "/"
import os; os.makedirs(OUT, exist_ok=True)
img = np.asarray(Image.open(str(ROOT / "samples" / "living-room-wood.jpg")).convert("RGB"))  # 1600x1067
H, W = img.shape[:2]
torch.set_num_threads(os.cpu_count())

def floor_ids(model, names=("floor", "rug")):
    return [int(i) for i, l in model.config.id2label.items() if str(l).split(",")[0].strip().lower() in names]

def segformer(input_long):
    proc = AutoImageProcessor.from_pretrained("nvidia/segformer-b2-finetuned-ade-512-512")
    model = AutoModelForSemanticSegmentation.from_pretrained("nvidia/segformer-b2-finetuned-ade-512-512").eval()
    s = input_long / max(H, W)
    h, w = round(H * s / 32) * 32, round(W * s / 32) * 32
    t = time.time()
    # keep aspect ratio (current code squashes to 512x512)
    inputs = proc(images=img, return_tensors="pt", size={"height": h, "width": w})
    with torch.inference_mode():
        logits = model(**inputs).logits
    probs = torch.nn.functional.interpolate(logits, size=(H, W), mode="bilinear").softmax(1)[0]
    p = probs[floor_ids(model)].sum(0).numpy()
    return p, time.time() - t, logits.shape[-2:]

def eomt():
    name = "tue-mps/ade20k_semantic_eomt_large_512"
    proc = AutoImageProcessor.from_pretrained(name)
    from transformers import EomtForUniversalSegmentation
    model = EomtForUniversalSegmentation.from_pretrained(name).eval()
    t = time.time()
    inputs = proc(images=img, return_tensors="pt")
    with torch.inference_mode():
        out = model(**inputs)
    seg = proc.post_process_semantic_segmentation(out, target_sizes=[(H, W)])[0].numpy()
    p = np.isin(seg, floor_ids(model)).astype(np.float32)
    return p, time.time() - t, None

def guided_filter(I, p, r, eps):
    """He et al. guided filter (grayscale guide), box filters only."""
    I = I.astype(np.float32); p = p.astype(np.float32)
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    mI, mp = box(I), box(p)
    cov = box(I * p) - mI * mp
    var = box(I * I) - mI * mI
    a = cov / (var + eps); b = mp - a * mI
    return box(a) * I + box(b)

gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
results = {}
for name, fn in [("segformer_512sq", lambda: segformer(512)), ("segformer_1024", lambda: segformer(1024))]:
    p, dt, grid = fn(); results[name] = p; print(name, f"{dt:.2f}s", "logit grid", tuple(grid))
results["segformer_1024_guided"] = np.clip(guided_filter(gray, results["segformer_1024"], 6, 1e-3), 0, 1)
try:
    p, dt, _ = eomt(); results["eomt_L"] = p; print("eomt_L", f"{dt:.2f}s")
except Exception as e:
    print("eomt failed:", repr(e)[:300])

regions = {"stool": (20, 760, 260, 980), "coffee_table": (650, 640, 960, 860), "sofa_edge": (1050, 760, 1450, 960)}
for rname, (x0, y0, x1, y1) in regions.items():
    tiles = []
    for name, p in results.items():
        crop = img[y0:y1, x0:x1].astype(np.float32)
        m = p[y0:y1, x0:x1][..., None]
        vis = crop * (1 - 0.55 * m) + np.array([0, 255, 80]) * 0.55 * m
        vis = vis.astype(np.uint8).copy()
        cv2.putText(vis, name, (5, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)
        tiles.append(vis)
    cv2.imwrite(OUT + f"{rname}.jpg", cv2.cvtColor(np.hstack(tiles), cv2.COLOR_RGB2BGR))
print("done")
