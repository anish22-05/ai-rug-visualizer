"""Floor mask vs. occlusion alpha: the cleaned mask fills small occluders, the alpha keeps them."""

import numpy as np

from app.services import postprocess as pp

FLOOR, OTHER = 3, 7
H, W = 300, 400


def _scene():
    """Floor in the lower 2/3 with a small dark 'stool' seat and a thin 'leg' standing on it."""
    labels = np.full((H, W), OTHER, np.int32)
    labels[100:, :] = FLOOR
    rgb = np.full((H, W, 3), 200, np.uint8)       # light wall
    rgb[100:] = (150, 110, 70)                      # wood floor
    stool = (slice(180, 192), slice(120, 132))      # 12x12 = 144 px < small-hole limit (240 px)
    leg = (slice(200, 240), slice(260, 264))        # 4x40 = 160 px
    for region in (stool, leg):
        labels[region] = OTHER
        rgb[region] = (30, 30, 30)
    prob = (labels == FLOOR).astype(np.float32)
    return labels, prob, rgb, stool, leg


def test_mask_fills_small_occluders_but_occlusion_keeps_them():
    labels, prob, rgb, stool, leg = _scene()
    floor = pp.extract_floor(labels, prob, [FLOOR], rgb)

    # Cleaned mask: holes filled (placement/polygon want a solid floor).
    assert floor.mask[stool].min() == 255
    assert floor.mask[leg].min() == 255

    # Occlusion alpha: the stool and leg still hide the rug ...
    assert floor.occlusion.shape == (H, W) and floor.occlusion.dtype == np.uint8
    assert floor.occlusion[186, 126] < 25
    assert floor.occlusion[220, 261:263].max() < 25
    # ... while open floor stays fully visible and the wall stays hidden.
    assert floor.occlusion[260, 50] > 230
    assert floor.occlusion[40, 200] < 25


def test_occlusion_without_guide_is_tightened_probability():
    _, prob, _, stool, _ = _scene()
    alpha = pp.occlusion_alpha(prob * 0.5 + 0.25)  # 0.25 (non-floor) .. 0.75 (floor)
    assert alpha.dtype == np.float32
    assert alpha[stool].max() == 0.0     # below the 0.35 edge
    assert alpha[260, 50] == 1.0         # above the 0.65 edge


def test_guided_filter_snaps_blurry_probability_to_image_edge():
    # A sharp vertical edge in the photo, but a probability that ramps over 20 px.
    guide = np.zeros((40, 80), np.float32)
    guide[:, 40:] = 1.0
    prob = np.clip((np.arange(80, dtype=np.float32) - 30) / 20, 0, 1)[None].repeat(40, 0)
    out = pp.guided_filter(guide, prob, r=4, eps=1e-4)
    # The steepest step of the filtered alpha sits exactly on the photo edge (39 -> 40)
    # and is several times the ramp's 0.05/px slope.
    step = np.diff(out[20])
    assert int(np.argmax(step)) == 39
    assert step[39] > 4 * 0.05


def test_guided_filter_preserves_constants():
    guide = np.random.default_rng(0).random((32, 32)).astype(np.float32)
    out = pp.guided_filter(guide, np.full((32, 32), 0.7, np.float32))
    assert np.allclose(out, 0.7, atol=1e-4)
