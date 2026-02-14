from __future__ import annotations

from typing import Any


class OIAnalyzer:
    """Analyzes Open Interest patterns for trading signals."""

    def _to_float(self, value: Any, default: float = 0.0) -> float:
        try:
            out = float(value)
            if out != out:
                return default
            return out
        except (TypeError, ValueError):
            return default

    def _buildup_label(self, oi_change: float, price_change: float) -> str:
        if oi_change >= 0 and price_change >= 0:
            return "long_buildup"
        if oi_change >= 0 and price_change < 0:
            return "short_buildup"
        if oi_change < 0 and price_change < 0:
            return "long_unwinding"
        return "short_covering"

    def analyze_oi_buildup(self, chain: dict[str, Any]) -> dict[str, Any]:
        """
        Classify OI change patterns at each strike.
        """
        out: list[dict[str, Any]] = []
        for row in chain.get("strikes", []) if isinstance(chain.get("strikes"), list) else []:
            if not isinstance(row, dict):
                continue
            strike = self._to_float(row.get("strike_price"))
            ce = row.get("ce") if isinstance(row.get("ce"), dict) else {}
            pe = row.get("pe") if isinstance(row.get("pe"), dict) else {}
            ce_change = self._to_float(ce.get("price_change"))
            pe_change = self._to_float(pe.get("price_change"))
            ce_oi_chg = self._to_float(ce.get("oi_change"))
            pe_oi_chg = self._to_float(pe.get("oi_change"))
            out.append(
                {
                    "strike_price": strike,
                    "ce_pattern": self._buildup_label(ce_oi_chg, ce_change),
                    "pe_pattern": self._buildup_label(pe_oi_chg, pe_change),
                    "ce_oi_change": ce_oi_chg,
                    "pe_oi_change": pe_oi_chg,
                    "ce_price_change": ce_change,
                    "pe_price_change": pe_change,
                }
            )
        return {"symbol": chain.get("symbol"), "expiry_date": chain.get("expiry_date"), "strikes": out}

    def find_max_pain(self, chain: dict[str, Any]) -> float:
        """
        Max Pain strike where total option writer payout is minimum.
        """
        strikes = [row for row in chain.get("strikes", []) if isinstance(row, dict)]
        if not strikes:
            return 0.0
        strike_values = [self._to_float(row.get("strike_price")) for row in strikes]
        strike_values = [v for v in strike_values if v > 0]
        if not strike_values:
            return 0.0

        best_strike = strike_values[0]
        best_payout = float("inf")
        for settle in strike_values:
            payout = 0.0
            for row in strikes:
                k = self._to_float(row.get("strike_price"))
                ce = row.get("ce") if isinstance(row.get("ce"), dict) else {}
                pe = row.get("pe") if isinstance(row.get("pe"), dict) else {}
                ce_oi = max(self._to_float(ce.get("oi")), 0.0)
                pe_oi = max(self._to_float(pe.get("oi")), 0.0)
                payout += max(settle - k, 0.0) * ce_oi
                payout += max(k - settle, 0.0) * pe_oi
            if payout < best_payout:
                best_payout = payout
                best_strike = settle
        return round(best_strike, 2)

    def find_support_resistance(self, chain: dict[str, Any]) -> dict[str, list[float]]:
        """
        Support from PE OI concentration, resistance from CE OI concentration.
        """
        strikes = [row for row in chain.get("strikes", []) if isinstance(row, dict)]
        pe_rank = sorted(
            ((self._to_float((row.get("pe") or {}).get("oi")), self._to_float(row.get("strike_price"))) for row in strikes),
            key=lambda x: x[0],
            reverse=True,
        )
        ce_rank = sorted(
            ((self._to_float((row.get("ce") or {}).get("oi")), self._to_float(row.get("strike_price"))) for row in strikes),
            key=lambda x: x[0],
            reverse=True,
        )
        support = [round(s, 2) for oi, s in pe_rank if oi > 0][:2]
        resistance = [round(s, 2) for oi, s in ce_rank if oi > 0][:2]
        return {"support": support, "resistance": resistance}

    def get_pcr(self, chain: dict[str, Any]) -> dict[str, Any]:
        """
        Compute put-call ratios and directional signal.
        """
        ce_oi = 0.0
        pe_oi = 0.0
        ce_vol = 0.0
        pe_vol = 0.0
        ce_oi_change = 0.0
        pe_oi_change = 0.0
        for row in chain.get("strikes", []) if isinstance(chain.get("strikes"), list) else []:
            if not isinstance(row, dict):
                continue
            ce = row.get("ce") if isinstance(row.get("ce"), dict) else {}
            pe = row.get("pe") if isinstance(row.get("pe"), dict) else {}
            ce_oi += max(self._to_float(ce.get("oi")), 0.0)
            pe_oi += max(self._to_float(pe.get("oi")), 0.0)
            ce_vol += max(self._to_float(ce.get("volume")), 0.0)
            pe_vol += max(self._to_float(pe.get("volume")), 0.0)
            ce_oi_change += self._to_float(ce.get("oi_change"))
            pe_oi_change += self._to_float(pe.get("oi_change"))

        pcr_oi = (pe_oi / ce_oi) if ce_oi > 0 else 0.0
        pcr_volume = (pe_vol / ce_vol) if ce_vol > 0 else 0.0
        pcr_oi_change = (pe_oi_change / ce_oi_change) if ce_oi_change not in (0.0, -0.0) else 0.0
        if pcr_oi > 1.0:
            signal = "Bullish"
        elif pcr_oi < 0.7:
            signal = "Bearish"
        else:
            signal = "Neutral"
        return {
            "pcr_oi": round(pcr_oi, 4),
            "pcr_volume": round(pcr_volume, 4),
            "pcr_oi_change": round(pcr_oi_change, 4),
            "signal": signal,
        }


_oi_analyzer = OIAnalyzer()


def get_oi_analyzer() -> OIAnalyzer:
    return _oi_analyzer
