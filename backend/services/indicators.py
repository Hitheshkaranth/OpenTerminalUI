from __future__ import annotations

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_array(values) -> np.ndarray:
    if isinstance(values, pd.Series):
        values = values.values
    return np.asarray(values, dtype=np.float64)


def _fillna_local(series: pd.Series) -> pd.Series:
    return series.ffill().bfill()


# ---------------------------------------------------------------------------
# Stochastic Oscillator ( %K and %D )
# ---------------------------------------------------------------------------

def stochastic_oscillator(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    k_period: int = 14,
    d_smooth: int = 3,
) -> dict[str, list[float]]:
    h = _to_array(high)
    l = _to_array(low)
    c = _to_array(close)

    low_min = pd.Series(l).rolling(k_period).min().values
    high_max = pd.Series(h).rolling(k_period).max().values
    denom = high_max - low_min
    denom = np.where(denom == 0, 1.0, denom)
    k = 100.0 * (c - low_min) / denom

    d = pd.Series(k).rolling(d_smooth).mean().values
    return {
        "stoch_k": _fillna_local(pd.Series(k, index=range(len(k)))).tolist(),
        "stoch_d": _fillna_local(pd.Series(d, index=range(len(d)))).tolist(),
    }


# ---------------------------------------------------------------------------
# ADX (Average Directional Index)
# ---------------------------------------------------------------------------

def adx(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    period: int = 14,
) -> dict[str, list[float]]:
    h = _to_array(high)
    l = _to_array(low)
    c = _to_array(close)

    prev_c = np.roll(c, 1)
    prev_c[0] = c[0]

    tr = np.maximum(
        h - l,
        np.maximum(np.abs(h - prev_c), np.abs(l - prev_c)),
    )
    atr_calc = _fillna_local(pd.Series(tr).rolling(period).mean())

    up = np.diff(h, prepend=h[0])
    dn = -np.diff(l, prepend=l[0])
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)

    plus_di = 100.0 * pd.Series(plus_dm).rolling(period).mean() / atr_calc
    minus_di = 100.0 * pd.Series(minus_dm).rolling(period).mean() / atr_calc

    di_diff = np.abs(plus_di - minus_di)
    di_sum = plus_di + minus_di
    dx = 100.0 * di_diff / np.where(di_sum == 0, 1.0, di_sum)
    adx_line = _fillna_local(pd.Series(dx).rolling(period).mean())

    return {
        "adx": adx_line.clip(lower=0.0).tolist(),
        "plus_di": plus_di.clip(lower=0.0).tolist(),
        "minus_di": minus_di.clip(lower=0.0).tolist(),
    }


# ---------------------------------------------------------------------------
# Aroon
# ---------------------------------------------------------------------------

def aroon(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    period: int = 25,
) -> dict[str, list[float]]:
    h = _to_array(high)
    l = _to_array(low)
    n = len(h)

    aroon_up: list[float] = []
    aroon_down: list[float] = []

    for i in range(n):
        window = h[max(0, i - period + 1): i + 1]
        if len(window) == 0:
            aroon_up.append(0.0)
            aroon_down.append(0.0)
            continue
        high_idx = np.argmax(window)
        window_l = l[max(0, i - period + 1): i + 1]
        low_idx = np.argmin(window_l)
        aroon_up.append(100.0 * (period - high_idx) / period)
        aroon_down.append(100.0 * (period - low_idx) / period)

    return {
        "aroon_up": aroon_up,
        "aroon_down": aroon_down,
    }


# ---------------------------------------------------------------------------
# CCI (Commodity Channel Index)
# ---------------------------------------------------------------------------

def cci(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    period: int = 20,
) -> dict[str, list[float]]:
    h = _to_array(high)
    l = _to_array(low)
    c = _to_array(close)

    tp = (h + l + c) / 3.0
    tp_series = pd.Series(tp)
    sma_tp = tp_series.rolling(period).mean()
    dev = tp_series.rolling(period).apply(lambda x: np.mean(np.abs(x - x.mean())), raw=True)
    denom = 0.015 * dev
    denom = np.where(denom == 0, 1.0, denom.values)
    result = (tp - sma_tp.values) / denom
    return {"cci": _fillna_local(pd.Series(result)).tolist()}


# ---------------------------------------------------------------------------
# Ichimoku Cloud
# ---------------------------------------------------------------------------

def ichimoku_cloud(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    tenkan_period: int = 9,
    kijun_period: int = 26,
    senkou_b_period: int = 52,
) -> dict[str, list[float]]:
    h = _to_array(high)
    l = _to_array(low)
    n = len(h)

    tenkan: list[float | None] = [None] * n
    kijun: list[float | None] = [None] * n
    senkou_a: list[float | None] = [None] * n
    senkou_b: list[float | None] = [None] * n

    for i in range(n):
        start_t = max(0, i - tenkan_period + 1)
        start_k = max(0, i - kijun_period + 1)
        start_sb = max(0, i - senkou_b_period + 1)

        high_t = h[start_t: i + 1]
        low_t = l[start_t: i + 1]
        high_k = h[start_k: i + 1]
        low_k = l[start_k: i + 1]
        high_sb = h[start_sb: i + 1]
        low_sb = l[start_sb: i + 1]

        if len(high_t) >= 2:
            ten = float(np.max(high_t)) - float(np.min(low_t))
            ten = 0.5 * (float(np.max(high_t)) + float(np.min(low_t)))
            tenkan[i] = ten

        if len(high_k) >= 2:
            kijun[i] = 0.5 * (float(np.max(high_k)) + float(np.min(low_k)))

        if len(high_sb) >= 2:
            sen_b = 0.5 * (float(np.max(high_sb)) + float(np.min(low_sb)))
            senkou_b[i] = sen_b
            if tenkan[i] is not None and kijun[i] is not None:
                senkou_a[i] = 0.5 * (tenkan[i] + kijun[i])

    return {
        "tenkan_sen": tenkan,
        "kijun_sen": kijun,
        "senkou_span_a": senkou_a,
        "senkou_span_b": senkou_b,
    }


# ---------------------------------------------------------------------------
# Parabolic SAR
# ---------------------------------------------------------------------------

def parabolic_sar(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    step: float = 0.02,
    max_af: float = 0.20,
) -> dict[str, list[float]]:
    h = _to_array(high)
    l = _to_array(low)
    n = len(h)
    sar_vals: list[float | None] = [None] * n
    is_up_trend = [True] * n

    if n < 2:
        return {"parabolic_sar": sar_vals}

    hp = float("-inf")
    lp = float("inf")
    sar = l[0]
    af = step

    for i in range(1, n):
        if af <= max_af:
            if h[i] > hp:
                hp = h[i]
                af = min(af + step, max_af)
            if l[i] < lp:
                lp = l[i]
            sar_new = sar + af * (hp - sar)
            if l[i] < sar_new:
                sar = hp
                af = step
                hp = l[0]
                lp = float("inf")
            else:
                sar = sar_new
        else:
            sar = sar + af * (hp - sar)
            if l[i] < sar:
                sar = hp
                af = step
                hp = l[0]
                lp = float("inf")
        sar_vals[i] = round(sar, 6)

    return {"parabolic_sar": sar_vals}


# ---------------------------------------------------------------------------
# Williams %R
# ---------------------------------------------------------------------------

def williams_pct_r(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    period: int = 14,
) -> dict[str, list[float]]:
    h = _to_array(high)
    l = _to_array(low)
    c = _to_array(close)

    highest_h = pd.Series(h).rolling(period).max()
    lowest_l = pd.Series(l).rolling(period).min()
    denom = highest_h - lowest_l
    denom = denom.fillna(0)
    denom = np.where(denom == 0, 1.0, denom.values)
    wr = -100.0 * (highest_h.values - c) / denom

    return {"williams_r": _fillna_local(pd.Series(wr)).tolist()}


# ---------------------------------------------------------------------------
# ROC (Rate of Change)
# ---------------------------------------------------------------------------

def roc(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    period: int = 12,
) -> dict[str, list[float]]:
    c = _to_array(close)
    c_series = pd.Series(c)
    roc_vals = 100.0 * c_series.diff(period) / c_series.shift(period)
    roc_clean = _fillna_local(roc_vals)
    return {"roc": roc_clean.tolist()}


# ---------------------------------------------------------------------------
# Ultimate Oscillator
# ---------------------------------------------------------------------------

def ultimate_oscillator(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    period1: int = 7,
    period2: int = 14,
    period3: int = 28,
) -> dict[str, list[float]]:
    h = _to_array(high)
    l = _to_array(low)
    c = _to_array(close)

    prev_c = np.roll(c, 1)
    prev_c[0] = c[0]
    bp = c - np.minimum(l, prev_c)
    tr = np.maximum(h - l, np.maximum(np.abs(h - prev_c), np.abs(l - prev_c)))

    bp_series = pd.Series(bp)
    tr_series = pd.Series(tr)

    avg1 = bp_series.rolling(period1).mean() / tr_series.rolling(period1).mean()
    avg2 = bp_series.rolling(period2).mean() / tr_series.rolling(period2).mean()
    avg3 = bp_series.rolling(period3).mean() / tr_series.rolling(period3).mean()

    denom = avg1 + avg2 * 2.0 + avg3
    denom = _fillna_local(denom)
    denom = np.where(denom == 0, 1.0, denom.values)

    uo = 100.0 * (avg1 + avg2 * 2.0 + avg3) / denom
    return {"ultimate_oscillator": _fillna_local(uo).tolist()}


# ---------------------------------------------------------------------------
# Awesome Oscillator
# ---------------------------------------------------------------------------

def awesome_oscillator(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    fast_period: int = 5,
    slow_period: int = 34,
) -> dict[str, list[float]]:
    mid = (np.asarray(high, dtype=np.float64) + np.asarray(low, dtype=np.float64)) / 2.0
    mid_series = pd.Series(mid)
    sma_fast = mid_series.rolling(fast_period).mean()
    sma_slow = mid_series.rolling(slow_period).mean()
    ao = sma_fast - sma_slow
    return {"awesome_oscillator": _fillna_local(ao).tolist()}


# ---------------------------------------------------------------------------
# Momentum
# ---------------------------------------------------------------------------

def momentum(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    period: int = 10,
) -> dict[str, list[float]]:
    c = _to_array(close)
    c_series = pd.Series(c)
    mom = c_series.diff(period)
    mom_clean = _fillna_local(mom)
    return {"momentum": mom_clean.tolist()}


# ---------------------------------------------------------------------------
# Standard Deviation / Volatility
# ---------------------------------------------------------------------------

def std_deviation(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray | None = None,
    *,
    period: int = 20,
) -> dict[str, list[float]]:
    c = _to_array(close)
    c_series = pd.Series(c)
    std = c_series.rolling(period).std()
    # Annualise if daily (multiply by sqrt(252))
    annualised = std * np.sqrt(252)
    return {
        "std_dev": _fillna_local(std).tolist(),
        "volatility_annual": _fillna_local(annualised).tolist(),
    }


# ---------------------------------------------------------------------------
# Registry – maps indicator names to their callables
# ---------------------------------------------------------------------------

_INDICATORS: dict[str, callable] = {
    "stochastic": stochastic_oscillator,
    "adx": adx,
    "aroon": aroon,
    "cci": cci,
    "ichimoku": ichimoku_cloud,
    "parabolic_sar": parabolic_sar,
    "williams_r": williams_pct_r,
    "roc": roc,
    "ultimate_oscillator": ultimate_oscillator,
    "awesome_oscillator": awesome_oscillator,
    "momentum": momentum,
    "std_deviation": std_deviation,
    "volatility": std_deviation,
}


def list_indicators() -> list[dict[str, str | list[str]]]:
    return [
        {
            "id": name,
            "name": name.replace("_", " ").title(),
            "category": "momentum" if name in ("stochastic", "roc", "williams_r", "momentum", "awesome_oscillator") else "trend",
            "outputs": sorted(_get_field_names(name)),
        }
        for name in sorted(_INDICATORS)
    ]


def _get_field_names(name: str) -> list[str]:
    fn = _INDICATORS.get(name)
    if not fn:
        return []
    import inspect
    sig = inspect.signature(fn)
    param_names = [p for p in sig.parameters if p not in ("high", "low", "close", "volume")]
    return param_names


def compute(name: str, **kwargs) -> dict[str, list[float]]:
    fn = _INDICATORS.get(name)
    if fn is None:
        raise ValueError(f"Unknown indicator: {name}")
    return fn(**kwargs)