import numpy as np
import pytest

from app.services import floor_geometry as fg
from app.services.vanishing import find_vanishing_point


def synthetic_floor_depth(w=640, h=480, pitch_deg=20.0, height=1.3, f=500.0):
    """Render the depth map a pinhole camera would see of an infinite floor."""
    K = fg.Intrinsics(f=f, cx=w / 2, cy=h / 2)
    n = fg.normal_from_pitch(np.radians(pitch_deg))
    vs, us = np.mgrid[0:h, 0:w].astype(float)
    rays = np.stack([(us - K.cx) / f, (vs - K.cy) / f, np.ones_like(us)], -1)
    denom = rays @ n
    t = np.where(denom < -1e-6, -height / denom, 0.0)
    depth = t * rays[..., 2]
    mask = (depth > 0) & (depth < 15)
    return depth.astype(np.float32), (mask * 255).astype(np.uint8), K, n


def test_plane_fit_recovers_normal_and_height():
    depth, mask, K, n_true = synthetic_floor_depth()
    noisy = depth + np.random.default_rng(1).normal(0, 0.005, depth.shape).astype(np.float32)
    fit = fg.fit_floor_plane(noisy, mask, K)
    assert fit is not None and fg.is_plausible_floor(fit)
    assert np.degrees(np.arccos(np.clip(fit.normal @ n_true, -1, 1))) < 1.0
    assert fit.height == pytest.approx(1.3, abs=0.05)


def test_homography_maps_floor_points_onto_the_plane():
    _, mask, K, n = synthetic_floor_depth(pitch_deg=25)
    geo = fg.build_homography(n, 1.3, K, (320, 400), "test")
    assert geo.pitch_deg == pytest.approx(25, abs=1e-6)
    # Origin (0,0) projects to the anchor pixel.
    assert fg.apply_h(geo.H, np.array([[0.0, 0.0]]))[0] == pytest.approx([320, 400], abs=1e-6)
    # +v points towards the camera => lower in the image.
    near = fg.apply_h(geo.H, np.array([[0.0, 100.0]]))[0]
    assert near[1] > 400
    # Round trip through the inverse.
    pts = np.array([[-120.0, 40.0], [75.0, -200.0], [10.0, 10.0]])
    back = fg.apply_h(np.linalg.inv(geo.H), fg.apply_h(geo.H, pts))
    assert back == pytest.approx(pts, abs=1e-6)


def test_homography_preserves_metric_lengths():
    _, _, K, n = synthetic_floor_depth(pitch_deg=30)
    geo = fg.build_homography(n, 1.5, K, (320, 420), "test")
    # Back-project two image points of a 100 cm segment and measure it in 3-D.
    Kinv = np.linalg.inv(K.K)

    def to_3d(px):
        ray = Kinv @ np.array([px[0], px[1], 1.0])
        return ray * (-1.5 / (n @ ray))

    a, b = fg.apply_h(geo.H, np.array([[0.0, 0.0], [100.0, 0.0]]))
    assert np.linalg.norm(to_3d(a) - to_3d(b)) == pytest.approx(1.0, abs=1e-6)


def test_horizon_matches_pitch():
    _, _, K, n = synthetic_floor_depth(pitch_deg=15)
    geo = fg.build_homography(n, 1.3, K, (320, 400), "test")
    assert geo.horizon_y == pytest.approx(K.cy - K.f * np.tan(np.radians(15)), abs=1e-6)


def test_vanishing_point_from_converging_lines():
    vp = np.array([400.0, 120.0])
    lines = []
    for x0 in np.linspace(0, 800, 12):
        start = np.array([x0, 600.0])
        mid = start + 0.5 * (vp - start)
        lines.append([*start, *mid])
    found, support = find_vanishing_point(np.array(lines), floor_top_y=300)
    assert support >= 10
    assert np.allclose(found, vp, atol=1.0)


def test_suggest_placement_finds_open_space():
    depth, mask, K, n = synthetic_floor_depth()
    geo = fg.build_homography(n, 1.3, K, (320, 400), "test")
    poly = fg.apply_h(np.linalg.inv(geo.H), np.array([[0, 479], [639, 479], [639, 300], [0, 300]], float))
    placement = fg.suggest_placement(geo.H, mask, poly)
    assert placement is not None and placement["radiusCm"] > 30
