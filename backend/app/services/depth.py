"""Monocular metric depth with Depth Anything V2 (indoor metric checkpoint).

The metric-indoor model is fine-tuned on Hypersim, so it predicts depth in metres
for indoor scenes. We only need the floor *orientation* to be right; absolute
scale errors are corrected later by a camera-height sanity check.
"""

import numpy as np
import torch

from app.services.models import LoadedModel


@torch.inference_mode()
def estimate_depth(rgb: np.ndarray, depth: LoadedModel, device: torch.device) -> np.ndarray:
    """Return an HxW float32 depth map in metres at the input resolution."""
    h, w = rgb.shape[:2]
    inputs = depth.processor(images=rgb, return_tensors="pt").to(device)
    outputs = depth.model(**inputs)
    post = depth.processor.post_process_depth_estimation(outputs, target_sizes=[(h, w)])
    return post[0]["predicted_depth"].float().cpu().numpy()
