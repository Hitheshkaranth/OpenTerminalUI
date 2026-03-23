from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DetectedPattern:
    pattern_type: str
    direction: str
    confidence: float
    anchor_points: list[dict[str, Any]]
    trendlines: list[dict[str, Any]]
    target_price: float | None
    description: str
    start_bar: int
    end_bar: int

    def to_wire(self) -> dict[str, Any]:
        return {
            "pattern_type": self.pattern_type,
            "direction": self.direction,
            "confidence": round(float(self.confidence), 4),
            "anchor_points": list(self.anchor_points),
            "trendlines": list(self.trendlines),
            "target_price": self.target_price,
            "description": self.description,
            "start_bar": int(self.start_bar),
            "end_bar": int(self.end_bar),
        }


def _num(row: dict[str, Any], key: str) -> float:
    value = row.get(key)
    try:
        out = float(value)
    except Exception:
        return 0.0
    return out


def _pct_diff(a: float, b: float) -> float:
    base = max(abs(a), abs(b), 1e-9)
    return abs(a - b) / base


def _slope(a_idx: int, a_price: float, b_idx: int, b_price: float) -> float:
    span = max(1, b_idx - a_idx)
    return (b_price - a_price) / span


class PatternRecognitionService:
    def _dedupe_pivots(self, pivots: list[dict[str, Any]], window: int, prefer: str) -> list[dict[str, Any]]:
        if not pivots:
            return []
        ordered = sorted(pivots, key=lambda row: int(row["bar_index"]))
        out: list[dict[str, Any]] = []
        for row in ordered:
            idx = int(row["bar_index"])
            if not out:
                out.append(row)
                continue
            prev = out[-1]
            prev_idx = int(prev["bar_index"])
            if idx - prev_idx <= window:
                prev_price = float(prev["price"])
                next_price = float(row["price"])
                if (prefer == "high" and next_price >= prev_price) or (prefer == "low" and next_price <= prev_price):
                    out[-1] = row
                continue
            out.append(row)
        return out

    def detect_pivots(self, ohlcv: list[dict[str, Any]], window: int = 5) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        bars = [row for row in ohlcv if isinstance(row, dict)]
        if len(bars) < max(5, window * 2 + 1):
            return [], []

        highs: list[dict[str, Any]] = []
        lows: list[dict[str, Any]] = []
        n = max(2, int(window))
        for idx in range(n, len(bars) - n):
            hi = _num(bars[idx], "high")
            lo = _num(bars[idx], "low")
            left = bars[idx - n : idx]
            right = bars[idx + 1 : idx + n + 1]
            if not left or not right:
                continue
            max_left = max(_num(row, "high") for row in left)
            max_right = max(_num(row, "high") for row in right)
            min_left = min(_num(row, "low") for row in left)
            min_right = min(_num(row, "low") for row in right)
            if hi >= max_left and hi >= max_right:
                highs.append(
                    {
                        "bar_index": idx,
                        "price": hi,
                        "type": "peak",
                        "date": str(bars[idx].get("date") or bars[idx].get("ts") or ""),
                    }
                )
            if lo <= min_left and lo <= min_right:
                lows.append(
                    {
                        "bar_index": idx,
                        "price": lo,
                        "type": "trough",
                        "date": str(bars[idx].get("date") or bars[idx].get("ts") or ""),
                    }
                )
        return self._dedupe_pivots(highs, n, "high"), self._dedupe_pivots(lows, n, "low")

    def detect_patterns(self, ohlcv: list[dict[str, Any]], min_confidence: float = 0.6) -> list[DetectedPattern]:
        bars = [row for row in ohlcv if isinstance(row, dict)]
        if len(bars) < 20:
            return []

        highs, lows = self.detect_pivots(bars, window=3 if len(bars) < 120 else 5)
        candidates: list[DetectedPattern] = []
        candidates.extend(self._detect_head_shoulders(bars, highs, lows))
        candidates.extend(self._detect_double_top(bars, highs, lows))
        candidates.extend(self._detect_ascending_triangle(bars, highs, lows))
        candidates.extend(self._detect_bull_flag(bars))
        candidates.extend(self._detect_cup_handle(bars))

        threshold = max(0.0, min(1.0, float(min_confidence)))
        filtered = [p for p in candidates if p.confidence >= threshold]
        filtered.sort(key=lambda p: (p.confidence, p.end_bar), reverse=True)

        # Keep strongest hit per pattern type and endpoint location.
        seen: set[tuple[str, int]] = set()
        out: list[DetectedPattern] = []
        for item in filtered:
            key = (item.pattern_type, item.end_bar)
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
        return out

    def _detect_head_shoulders(
        self,
        bars: list[dict[str, Any]],
        highs: list[dict[str, Any]],
        lows: list[dict[str, Any]],
    ) -> list[DetectedPattern]:
        out: list[DetectedPattern] = []
        if len(highs) < 3 or len(lows) < 2:
            return out

        lows_by_idx = {int(p["bar_index"]): p for p in lows}
        for i in range(len(highs) - 2):
            p1, p2, p3 = highs[i], highs[i + 1], highs[i + 2]
            i1, i2, i3 = int(p1["bar_index"]), int(p2["bar_index"]), int(p3["bar_index"])
            if not (i1 < i2 < i3):
                continue
            between_12 = [l for l in lows if i1 < int(l["bar_index"]) < i2]
            between_23 = [l for l in lows if i2 < int(l["bar_index"]) < i3]
            if not between_12 or not between_23:
                continue
            n1 = min(between_12, key=lambda x: x["price"])
            n2 = min(between_23, key=lambda x: x["price"])

            ls, hd, rs = float(p1["price"]), float(p2["price"]), float(p3["price"])
            if hd <= max(ls, rs):
                continue
            if _pct_diff(ls, rs) > 0.03:
                continue
            if (hd - max(ls, rs)) / max(hd, 1e-9) < 0.02:
                continue

            neckline_slope = abs(_slope(int(n1["bar_index"]), float(n1["price"]), int(n2["bar_index"]), float(n2["price"])))
            symmetry = 1.0 - min(1.0, abs((i2 - i1) - (i3 - i2)) / max(1, (i3 - i1)))
            shoulder_match = 1.0 - min(1.0, _pct_diff(ls, rs) / 0.03)
            confidence = max(0.0, min(1.0, 0.55 + 0.2 * symmetry + 0.2 * shoulder_match - min(0.15, neckline_slope * 2)))

            neckline = (float(n1["price"]) + float(n2["price"])) / 2.0
            target = round(neckline - (hd - neckline), 4)
            out.append(
                DetectedPattern(
                    pattern_type="head_shoulders",
                    direction="bearish",
                    confidence=confidence,
                    anchor_points=[
                        {**p1, "type": "left_shoulder"},
                        {**n1, "type": "neckline_left"},
                        {**p2, "type": "head"},
                        {**n2, "type": "neckline_right"},
                        {**p3, "type": "right_shoulder"},
                    ],
                    trendlines=[
                        {
                            "start": {"idx": int(n1["bar_index"]), "price": float(n1["price"])},
                            "end": {"idx": int(n2["bar_index"]), "price": float(n2["price"])},
                            "role": "neckline",
                        }
                    ],
                    target_price=target,
                    description=f"Head & Shoulders with neckline near {neckline:.2f}.",
                    start_bar=i1,
                    end_bar=i3,
                )
            )
        return out

    def _detect_double_top(
        self,
        bars: list[dict[str, Any]],
        highs: list[dict[str, Any]],
        lows: list[dict[str, Any]],
    ) -> list[DetectedPattern]:
        out: list[DetectedPattern] = []
        if len(highs) < 2:
            return out

        for i in range(len(highs) - 1):
            p1, p2 = highs[i], highs[i + 1]
            i1, i2 = int(p1["bar_index"]), int(p2["bar_index"])
            if i2 - i1 < 3:
                continue
            top1, top2 = float(p1["price"]), float(p2["price"])
            if _pct_diff(top1, top2) > 0.015:
                continue
            between = [l for l in lows if i1 < int(l["bar_index"]) < i2]
            if not between:
                continue
            trough = min(between, key=lambda x: x["price"])
            depth = (min(top1, top2) - float(trough["price"])) / max(min(top1, top2), 1e-9)
            if depth < 0.02:
                continue

            similarity = 1.0 - min(1.0, _pct_diff(top1, top2) / 0.015)
            confidence = max(0.0, min(1.0, 0.58 + 0.22 * similarity + min(0.18, depth * 2.5)))
            out.append(
                DetectedPattern(
                    pattern_type="double_top",
                    direction="bearish",
                    confidence=confidence,
                    anchor_points=[
                        {**p1, "type": "peak_1"},
                        {**trough, "type": "trough"},
                        {**p2, "type": "peak_2"},
                    ],
                    trendlines=[],
                    target_price=round(float(trough["price"]) - (max(top1, top2) - float(trough["price"])), 4),
                    description="Double Top pattern with two similar peaks.",
                    start_bar=i1,
                    end_bar=i2,
                )
            )
        return out

    def _detect_ascending_triangle(
        self,
        bars: list[dict[str, Any]],
        highs: list[dict[str, Any]],
        lows: list[dict[str, Any]],
    ) -> list[DetectedPattern]:
        out: list[DetectedPattern] = []
        if len(highs) < 3 or len(lows) < 3:
            return out

        recent_highs = highs[-6:]
        recent_lows = lows[-6:]
        if len(recent_highs) < 3 or len(recent_lows) < 3:
            return out

        candidate_highs = recent_highs[-3:]
        h_prices = [float(x["price"]) for x in candidate_highs]
        resistance = sum(h_prices) / len(h_prices)
        if max(abs(v - resistance) / max(resistance, 1e-9) for v in h_prices) > 0.01:
            return out

        candidate_lows = sorted(recent_lows[-3:], key=lambda x: int(x["bar_index"]))
        l1, l2, l3 = candidate_lows
        p1, p2, p3 = float(l1["price"]), float(l2["price"]), float(l3["price"])
        if not (p1 < p2 < p3):
            return out
        support_slope = _slope(int(l1["bar_index"]), p1, int(l3["bar_index"]), p3)
        if support_slope <= 0:
            return out

        i_start = min(int(candidate_highs[0]["bar_index"]), int(l1["bar_index"]))
        i_end = max(int(candidate_highs[-1]["bar_index"]), int(l3["bar_index"]))
        confidence = max(0.0, min(1.0, 0.62 + min(0.18, support_slope * 25) + 0.14))
        out.append(
            DetectedPattern(
                pattern_type="ascending_triangle",
                direction="bullish",
                confidence=confidence,
                anchor_points=[
                    {**candidate_highs[0], "type": "resistance_1"},
                    {**candidate_highs[1], "type": "resistance_2"},
                    {**candidate_highs[2], "type": "resistance_3"},
                    {**l1, "type": "support_1"},
                    {**l2, "type": "support_2"},
                    {**l3, "type": "support_3"},
                ],
                trendlines=[
                    {
                        "start": {"idx": int(candidate_highs[0]["bar_index"]), "price": resistance},
                        "end": {"idx": int(candidate_highs[-1]["bar_index"]), "price": resistance},
                        "role": "resistance",
                    },
                    {
                        "start": {"idx": int(l1["bar_index"]), "price": p1},
                        "end": {"idx": int(l3["bar_index"]), "price": p3},
                        "role": "support",
                    },
                ],
                target_price=round(resistance + (resistance - p1), 4),
                description="Ascending Triangle with flat resistance and rising support.",
                start_bar=i_start,
                end_bar=i_end,
            )
        )
        return out

    def _detect_bull_flag(self, bars: list[dict[str, Any]]) -> list[DetectedPattern]:
        out: list[DetectedPattern] = []
        if len(bars) < 24:
            return out
        closes = [_num(row, "close") for row in bars]
        highs = [_num(row, "high") for row in bars]
        lows = [_num(row, "low") for row in bars]

        best: DetectedPattern | None = None
        for pole_len in range(6, 13):
            for flag_len in range(6, 15):
                end = len(bars) - 1
                flag_start = end - flag_len + 1
                pole_start = flag_start - pole_len
                if pole_start < 0:
                    continue
                pole_move = (closes[flag_start - 1] - closes[pole_start]) / max(closes[pole_start], 1e-9)
                if pole_move < 0.08:
                    continue

                flag_highs = highs[flag_start : end + 1]
                flag_lows = lows[flag_start : end + 1]
                retrace = (max(flag_highs) - min(flag_lows)) / max(closes[flag_start - 1], 1e-9)
                if retrace > 0.5 * pole_move:
                    continue
                slope_flag = _slope(flag_start, closes[flag_start], end, closes[end])
                if slope_flag >= 0:
                    continue

                confidence = max(0.0, min(1.0, 0.6 + min(0.22, pole_move * 1.2) + min(0.12, abs(slope_flag) / max(closes[end], 1e-9) * 500)))
                anchors = [
                    {"bar_index": pole_start, "price": closes[pole_start], "type": "pole_start", "date": str(bars[pole_start].get("date") or "")},
                    {"bar_index": flag_start - 1, "price": closes[flag_start - 1], "type": "pole_end", "date": str(bars[flag_start - 1].get("date") or "")},
                    {"bar_index": flag_start, "price": highs[flag_start], "type": "flag_start", "date": str(bars[flag_start].get("date") or "")},
                    {"bar_index": end, "price": lows[end], "type": "flag_end", "date": str(bars[end].get("date") or "")},
                ]
                pattern = DetectedPattern(
                    pattern_type="bull_flag",
                    direction="bullish",
                    confidence=confidence,
                    anchor_points=anchors,
                    trendlines=[
                        {
                            "start": {"idx": flag_start, "price": max(flag_highs)},
                            "end": {"idx": end, "price": max(flag_highs) + slope_flag * (end - flag_start)},
                            "role": "flag_resistance",
                        },
                        {
                            "start": {"idx": flag_start, "price": min(flag_lows)},
                            "end": {"idx": end, "price": min(flag_lows) + slope_flag * (end - flag_start)},
                            "role": "flag_support",
                        },
                    ],
                    target_price=round(closes[flag_start - 1] + (closes[flag_start - 1] - closes[pole_start]), 4),
                    description="Bull Flag after sharp upside pole and downward channel.",
                    start_bar=pole_start,
                    end_bar=end,
                )
                if best is None or pattern.confidence > best.confidence:
                    best = pattern
        return [best] if best is not None else []

    def _detect_cup_handle(self, bars: list[dict[str, Any]]) -> list[DetectedPattern]:
        out: list[DetectedPattern] = []
        if len(bars) < 60:
            return out
        closes = [_num(row, "close") for row in bars]
        n = len(closes)

        left_idx = max(5, int(n * 0.15))
        right_idx = min(n - 8, int(n * 0.82))
        if right_idx - left_idx < 30:
            return out

        left_peak = closes[left_idx]
        right_peak = closes[right_idx]
        if _pct_diff(left_peak, right_peak) > 0.04:
            return out

        cup_mid_idx = min(range(left_idx + 8, right_idx - 7), key=lambda idx: closes[idx])
        cup_bottom = closes[cup_mid_idx]
        depth = (max(left_peak, right_peak) - cup_bottom) / max(max(left_peak, right_peak), 1e-9)
        if depth < 0.12 or depth > 0.33:
            return out

        handle_start = right_idx
        handle_end = n - 1
        handle_low = min(closes[handle_start: handle_end + 1])
        handle_drop = (right_peak - handle_low) / max(right_peak, 1e-9)
        if handle_drop <= 0 or handle_drop > 0.15:
            return out

        # Avoid false positives on noisy flat series.
        if closes[handle_end] < closes[handle_start] * 0.9:
            return out

        symmetry = 1.0 - min(1.0, abs((cup_mid_idx - left_idx) - (right_idx - cup_mid_idx)) / max(1, right_idx - left_idx))
        confidence = max(0.0, min(1.0, 0.58 + min(0.2, depth * 0.8) + 0.15 * symmetry))
        out.append(
            DetectedPattern(
                pattern_type="cup_handle",
                direction="bullish",
                confidence=confidence,
                anchor_points=[
                    {"bar_index": left_idx, "price": left_peak, "type": "left_rim", "date": str(bars[left_idx].get("date") or "")},
                    {"bar_index": cup_mid_idx, "price": cup_bottom, "type": "cup_bottom", "date": str(bars[cup_mid_idx].get("date") or "")},
                    {"bar_index": right_idx, "price": right_peak, "type": "right_rim", "date": str(bars[right_idx].get("date") or "")},
                    {"bar_index": handle_end, "price": closes[handle_end], "type": "handle_end", "date": str(bars[handle_end].get("date") or "")},
                ],
                trendlines=[],
                target_price=round(right_peak + (right_peak - cup_bottom), 4),
                description="Cup & Handle with rounded base and shallow handle pullback.",
                start_bar=left_idx,
                end_bar=handle_end,
            )
        )
        return out


service = PatternRecognitionService()
