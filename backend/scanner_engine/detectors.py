from __future__ import annotations

from typing import Any

import pandas as pd


def _last(df: pd.DataFrame, col: str) -> float | None:
    if col not in df.columns or df.empty:
        return None
    value = df[col].iloc[-1]
    if pd.isna(value):
        return None
    return float(value)


def _step(name: str, passed: bool, value: Any, expected: str) -> dict[str, Any]:
    return {"rule": name, "passed": bool(passed), "value": value, "expected": expected}


def breakout_n_day_high(df: pd.DataFrame, n: int, buffer_pct: float, rvol_threshold: float, near_trigger_pct: float) -> dict[str, Any]:
    if len(df) < n + 1:
        return {"passed": False, "setup_type": f"{n}D_BREAKOUT", "explain_steps": [_step("history", False, len(df), f">={n + 1}")]}
    prev_high = float(df["High"].iloc[-(n + 1):-1].max())
    close = float(df["Close"].iloc[-1])
    rvol = _last(df, "rvol_20") or 0.0
    breakout_level = prev_high * (1.0 + buffer_pct)
    distance = (breakout_level - close) / breakout_level if breakout_level else 0.0
    passed_price = close > breakout_level
    passed_volume = rvol >= rvol_threshold
    near = (not passed_price) and (distance <= near_trigger_pct)
    passed = passed_price and passed_volume
    explain = [
        _step("close_above_breakout_level", passed_price, close, f">{breakout_level:.4f}"),
        _step("rvol_threshold", passed_volume, rvol, f">={rvol_threshold:.2f}"),
    ]
    return {
        "passed": passed,
        "setup_type": f"{n}D_BREAKOUT",
        "event_type": "triggered" if passed else ("near_trigger" if near else "none"),
        "signal_age": 0 if (passed or near) else None,
        "trend_state": "up" if close >= (_last(df, "ema_50") or close) else "flat",
        "breakout_level": breakout_level,
        "distance_to_trigger": distance,
        "levels": {"breakout_level": breakout_level},
        "features": {"rvol": rvol, "atr_pct": _last(df, "atr_pct"), "close": close, "near_trigger": near},
        "explain_steps": explain,
    }


def bb_squeeze_breakout(df: pd.DataFrame, width_pct_threshold: float, lookback: int, require_keltner: bool) -> dict[str, Any]:
    width_rank = _last(df, "bb_width_pct_rank_120")
    close = _last(df, "Close") or 0.0
    bb_upper = _last(df, "bb_upper") or close
    kc_upper = _last(df, "kc_upper") or close
    squeezed = width_rank is not None and width_rank <= width_pct_threshold
    bb_break = close > bb_upper
    kc_break = close > kc_upper
    passed = squeezed and bb_break and (kc_break if require_keltner else True)
    explain = [
        _step("bb_width_percentile", squeezed, width_rank, f"<={width_pct_threshold:.1f}"),
        _step("close_above_bb_upper", bb_break, close, f">{bb_upper:.4f}"),
    ]
    if require_keltner:
        explain.append(_step("close_above_kc_upper", kc_break, close, f">{kc_upper:.4f}"))
    return {
        "passed": passed,
        "setup_type": "BB_SQUEEZE_EXPANSION",
        "event_type": "triggered" if passed else "none",
        "signal_age": 0 if passed else None,
        "trend_state": "up" if close > (_last(df, "ema_21") or close) else "flat",
        "breakout_level": bb_upper,
        "distance_to_trigger": (bb_upper - close) / bb_upper if bb_upper else 0.0,
        "levels": {"bb_upper": bb_upper, "kc_upper": kc_upper},
        "features": {"bb_width_rank": width_rank, "lookback": lookback},
        "explain_steps": explain,
    }


def nr7_breakout(df: pd.DataFrame, volume_mult: float = 1.2) -> dict[str, Any]:
    if len(df) < 9:
        return {"passed": False, "setup_type": "NR7_BREAKOUT", "explain_steps": [_step("history", False, len(df), ">=9")]}
    setup_ranges = (df["High"] - df["Low"]).iloc[-8:-1]
    is_nr7 = float(setup_ranges.iloc[-1]) <= float(setup_ranges.min())
    setup_high = float(df["High"].iloc[-2])
    close = float(df["Close"].iloc[-1])
    breakout = close > setup_high
    vol = float(df["Volume"].iloc[-1] or 0.0)
    avg_vol = float(df["avg_volume_20"].iloc[-1] or 0.0)
    vol_ok = avg_vol > 0 and vol >= avg_vol * volume_mult
    passed = is_nr7 and breakout and vol_ok
    return {
        "passed": passed,
        "setup_type": "NR7_BREAKOUT",
        "event_type": "triggered" if passed else "none",
        "signal_age": 0 if passed else None,
        "trend_state": "compression",
        "breakout_level": setup_high,
        "distance_to_trigger": (setup_high - close) / setup_high if setup_high else 0.0,
        "levels": {"nr7_high": setup_high},
        "features": {"range_today": float(setup_ranges.iloc[-1]), "range_7_min": float(setup_ranges.min()), "volume_mult": vol / avg_vol if avg_vol else None},
        "explain_steps": [
            _step("is_nr7", is_nr7, float(setup_ranges.iloc[-1]), f"<={float(setup_ranges.min()):.4f}"),
            _step("break_nr7_high", breakout, close, f">{setup_high:.4f}"),
            _step("volume_confirmation", vol_ok, vol, f">={avg_vol * volume_mult:.1f}"),
        ],
    }


def inside_bar_breakout(df: pd.DataFrame) -> dict[str, Any]:
    if len(df) < 4:
        return {"passed": False, "setup_type": "INSIDE_BAR_BREAKOUT", "explain_steps": [_step("history", False, len(df), ">=4")]}
    mother = df.iloc[-3]
    inside_bar = df.iloc[-2]
    trigger_bar = df.iloc[-1]
    inside = float(inside_bar["High"]) <= float(mother["High"]) and float(inside_bar["Low"]) >= float(mother["Low"])
    break_up = float(trigger_bar["Close"]) > float(mother["High"])
    passed = inside and break_up
    return {
        "passed": passed,
        "setup_type": "INSIDE_BAR_BREAKOUT",
        "event_type": "triggered" if passed else "none",
        "signal_age": 0 if passed else None,
        "trend_state": "continuation" if break_up else "inside",
        "breakout_level": float(mother["High"]),
        "distance_to_trigger": (float(mother["High"]) - float(trigger_bar["Close"])) / float(mother["High"]) if float(mother["High"]) else 0.0,
        "levels": {"mother_high": float(mother["High"]), "mother_low": float(mother["Low"])},
        "features": {"inside_bar": inside},
        "explain_steps": [
            _step("inside_bar", inside, {"inside_high": float(inside_bar["High"]), "inside_low": float(inside_bar["Low"])}, "within mother range"),
            _step("break_mother_high", break_up, float(trigger_bar["Close"]), f">{float(mother['High']):.4f}"),
        ],
    }


def trend_retest(df: pd.DataFrame, ema_tolerance_pct: float, rvol_threshold: float) -> dict[str, Any]:
    close = _last(df, "Close") or 0.0
    ema21 = _last(df, "ema_21") or close
    ema50 = _last(df, "ema_50") or close
    ema200 = _last(df, "ema_200") or close
    uptrend = ema21 > ema50 > ema200
    tolerance = ema21 * ema_tolerance_pct
    pullback = abs(close - ema21) <= tolerance
    bullish = close >= float(df["Open"].iloc[-1])
    rvol_value = _last(df, "rvol_20") or 0.0
    vol_ok = rvol_value >= rvol_threshold
    passed = uptrend and pullback and bullish and vol_ok
    return {
        "passed": passed,
        "setup_type": "TREND_RETEST",
        "event_type": "triggered" if passed else "none",
        "signal_age": 0 if passed else None,
        "trend_state": "up" if uptrend else "flat",
        "breakout_level": ema21,
        "distance_to_trigger": (ema21 - close) / ema21 if ema21 else 0.0,
        "levels": {"ema21": ema21, "ema50": ema50, "ema200": ema200},
        "features": {"rvol": rvol_value, "close": close},
        "explain_steps": [
            _step("ema_stack_uptrend", uptrend, [ema21, ema50, ema200], "ema21>ema50>ema200"),
            _step("pullback_to_ema21", pullback, close, f"within {ema_tolerance_pct * 100:.2f}% of ema21"),
            _step("bullish_close", bullish, close, f">=open {float(df['Open'].iloc[-1]):.4f}"),
            _step("rvol_threshold", vol_ok, rvol_value, f">={rvol_threshold:.2f}"),
        ],
    }


def supertrend_flip_ema_stack(df: pd.DataFrame) -> dict[str, Any]:
    if len(df) < 2:
        return {"passed": False, "setup_type": "SUPERTREND_FLIP_EMA_STACK", "explain_steps": [_step("history", False, len(df), ">=2")]}
    prev_dir = int(df["supertrend_dir"].iloc[-2]) if not pd.isna(df["supertrend_dir"].iloc[-2]) else 1
    curr_dir = int(df["supertrend_dir"].iloc[-1]) if not pd.isna(df["supertrend_dir"].iloc[-1]) else 1
    flip_bull = prev_dir < 0 and curr_dir > 0
    ema21 = _last(df, "ema_21") or 0.0
    ema50 = _last(df, "ema_50") or 0.0
    ema200 = _last(df, "ema_200") or 0.0
    close = _last(df, "Close") or 0.0
    stack = ema21 > ema50 > ema200
    close_ok = close > ema21
    passed = flip_bull and stack and close_ok
    return {
        "passed": passed,
        "setup_type": "SUPERTREND_FLIP_EMA_STACK",
        "event_type": "triggered" if passed else "none",
        "signal_age": 0 if passed else None,
        "trend_state": "up" if curr_dir > 0 else "down",
        "breakout_level": ema21,
        "distance_to_trigger": (ema21 - close) / ema21 if ema21 else 0.0,
        "levels": {"supertrend": _last(df, "supertrend"), "ema21": ema21},
        "features": {"supertrend_prev": prev_dir, "supertrend_curr": curr_dir},
        "explain_steps": [
            _step("supertrend_flip_bull", flip_bull, [prev_dir, curr_dir], "[-1 -> +1]"),
            _step("ema_stack", stack, [ema21, ema50, ema200], "ema21>ema50>ema200"),
            _step("close_above_ema21", close_ok, close, f">{ema21:.4f}"),
        ],
    }


DETECTOR_MAP = {
    "breakout_n_day_high": breakout_n_day_high,
    "bb_squeeze_breakout": bb_squeeze_breakout,
    "nr7_breakout": nr7_breakout,
    "inside_bar_breakout": inside_bar_breakout,
    "trend_retest": trend_retest,
    "supertrend_flip_ema_stack": supertrend_flip_ema_stack,
}
