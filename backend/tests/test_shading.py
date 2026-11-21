"""Floor shading comes from the floor only, fills under occluders, and stays matte."""

import numpy as np

from app.services import shading as sh

H, W = 200, 300


def _room(floor_value=140):
    """Bright wall on top, uniform grey floor below (rows 80+)."""
    rgb = np.full((H, W, 3), 235, np.uint8)
    rgb[80:] = floor_value
    weight = np.zeros((H, W), np.float32)
    weight[80:] = 1.0
    return rgb, weight


def test_uniform_floor_has_unit_shading():
    rgb, w = _room()
    s = sh.floor_shading(rgb, w)
    assert s.shape == (H, W) and s.dtype == np.float32
    assert np.allclose(s[90:, :], 1.0, atol=0.02)


def test_bright_wall_does_not_brighten_floor_next_to_it():
    # The old lighting blurred the whole photo, so floor next to a white wall got brighter.
    rgb, w = _room()
    s = sh.floor_shading(rgb, w)
    assert abs(float(s[82, 150]) - 1.0) < 0.03


def test_cast_shadow_on_floor_darkens_shading():
    rgb, w = _room()
    rgb[130:170, 40:120] = 60  # a furniture shadow on the floor
    s = sh.floor_shading(rgb, w)
    assert s[150, 80] < 0.6
    assert s[150, 250] > 0.95


def test_occluder_is_filled_from_surrounding_floor():
    rgb, w = _room()
    rgb[120:150, 140:160] = 20   # a dark stool standing on the floor ...
    w[120:150, 140:160] = 0.0    # ... which the occlusion alpha excludes
    s = sh.floor_shading(rgb, w)
    assert s[135, 150] > 0.9     # not the stool's darkness


def test_highlights_are_clamped_for_matte_rugs():
    rgb, w = _room()
    rgb[150:190, 200:280] = 255  # glossy reflection of a window
    s = sh.floor_shading(rgb, w)
    assert s.max() <= sh.SHADING_RANGE[1] + 1e-6


def test_map_is_small_and_keeps_aspect_ratio():
    rgb = np.full((1000, 1500, 3), 140, np.uint8)
    w = np.ones((1000, 1500), np.float32)
    s = sh.floor_shading(rgb, w)
    assert max(s.shape) == sh.MAP_LONG_EDGE
    assert abs(s.shape[1] / s.shape[0] - 1.5) < 0.01


def test_naturally_darker_floor_patch_is_attenuated():
    # A darker board/tile is part albedo: the rug must not go fully as dark as the floor does.
    rgb, w = _room()
    rgb[120:190, 20:140] = 100
    s = sh.floor_shading(rgb, w)
    lin = sh.srgb_to_linear(np.array([[100, 140]], np.uint8))
    floor_ratio = float(lin[0, 0] / lin[0, 1])
    assert floor_ratio < s[155, 80] < 1.0


def test_no_floor_gives_neutral_shading():
    rgb, _ = _room()
    assert np.all(sh.floor_shading(rgb, np.zeros((H, W), np.float32)) == 1.0)


def test_illuminant_neutral_and_warm():
    grey = np.full((50, 50, 3), 180, np.uint8)
    assert np.allclose(sh.scene_illuminant(grey), [1, 1, 1], atol=1e-3)
    warm = np.full((50, 50, 3), (230, 200, 160), np.uint8)
    r, g, b = sh.scene_illuminant(warm)
    assert r > g > b
    assert abs((r + g + b) / 3 - 1.0) < 1e-3
    assert min(r, g, b) >= sh.ILLUMINANT_RANGE[0] - 0.05


def test_illuminant_ignores_coloured_highlights():
    # White wall lit neutrally, plus an equally bright green "window" (foliage outside).
    img = np.full((60, 60, 3), 230, np.uint8)
    img[:, :20] = (120, 250, 110)
    img[40:] = 60  # dark floor
    r, g, b = sh.scene_illuminant(img)
    assert abs(g - 1.0) < 0.02 and abs(r - b) < 0.02


def test_illuminant_uses_wall_surfaces_when_given():
    # Pale-green window (passes the neutral test) next to a neutral wall.
    img = np.full((60, 60, 3), 225, np.uint8)
    img[:, :25] = (215, 240, 210)
    walls = np.zeros((60, 60), bool)
    walls[:, 25:] = True
    r, g, b = sh.scene_illuminant(img, walls)
    assert np.allclose([r, g, b], [1, 1, 1], atol=0.01)
    assert sh.scene_illuminant(img)[1] > 1.01  # without walls the window tints it


def test_encode_roundtrip():
    s = np.array([[0.4, 1.0, 1.05]], np.float32)
    enc = sh.encode_shading(s)
    assert enc.dtype == np.uint8
    assert np.allclose(enc / 255 * sh.ENCODE_MAX, s, atol=0.01)
