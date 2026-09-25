import numpy as np

from backend.services.indicators import adx, aroon, parabolic_sar, ultimate_oscillator


def _uptrend(n=30):
    h = np.arange(1, n + 1, dtype=float)
    return h, h - 1, h - 0.5


def test_aroon_up_is_100_when_high_is_current_bar():
    h, l, c = _uptrend()
    out = aroon(h, l, c, period=5)
    assert out["aroon_up"][-1] == 100.0
    assert out["aroon_down"][-1] == 20.0  # low was 4 bars ago


def test_ultimate_oscillator_is_not_constant_100():
    h, l, c = _uptrend()
    up = ultimate_oscillator(h, l, c)["ultimate_oscillator"][-1]
    down = ultimate_oscillator(h[::-1], l[::-1], c[::-1])["ultimate_oscillator"][-1]
    assert abs(up - 200 / 3) < 1e-9
    assert abs(down - 100 / 3) < 1e-9


def test_parabolic_sar_trails_above_price_in_downtrend():
    x = np.r_[np.arange(10, 20), np.arange(20, 5, -1)].astype(float)
    sar = parabolic_sar(x + 0.5, x - 0.5, x)["parabolic_sar"]
    # after the reversal the SAR sits above the highs and falls with price
    for i in range(14, len(x)):
        assert sar[i] > x[i] + 0.5
        assert sar[i] < sar[i - 1]


def test_adx_flat_data_has_no_inf():
    f = np.ones(30)
    out = adx(f, f, f)
    assert all(np.isfinite(v) for v in out["plus_di"][14:])
