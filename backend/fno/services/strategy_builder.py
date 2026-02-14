from __future__ import annotations

from typing import Any

from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher


class StrategyBuilder:
    """Builds and analyzes multi-leg option strategies."""

    PRESETS: dict[str, dict[str, Any]] = {
        "bull_call_spread": {
            "legs": 2,
            "template": [
                {"type": "CE", "action": "buy", "strike_offset": 0},
                {"type": "CE", "action": "sell", "strike_offset": +1},
            ],
        },
        "bear_put_spread": {
            "legs": 2,
            "template": [
                {"type": "PE", "action": "buy", "strike_offset": 0},
                {"type": "PE", "action": "sell", "strike_offset": -1},
            ],
        },
        "long_straddle": {
            "legs": 2,
            "template": [
                {"type": "CE", "action": "buy", "strike_offset": 0},
                {"type": "PE", "action": "buy", "strike_offset": 0},
            ],
        },
        "short_straddle": {
            "legs": 2,
            "template": [
                {"type": "CE", "action": "sell", "strike_offset": 0},
                {"type": "PE", "action": "sell", "strike_offset": 0},
            ],
        },
        "long_strangle": {
            "legs": 2,
            "template": [
                {"type": "PE", "action": "buy", "strike_offset": -1},
                {"type": "CE", "action": "buy", "strike_offset": +1},
            ],
        },
        "short_strangle": {
            "legs": 2,
            "template": [
                {"type": "PE", "action": "sell", "strike_offset": -1},
                {"type": "CE", "action": "sell", "strike_offset": +1},
            ],
        },
        "iron_condor": {
            "legs": 4,
            "template": [
                {"type": "PE", "action": "buy", "strike_offset": -2},
                {"type": "PE", "action": "sell", "strike_offset": -1},
                {"type": "CE", "action": "sell", "strike_offset": +1},
                {"type": "CE", "action": "buy", "strike_offset": +2},
            ],
        },
        "iron_butterfly": {
            "legs": 4,
            "template": [
                {"type": "PE", "action": "buy", "strike_offset": -1},
                {"type": "PE", "action": "sell", "strike_offset": 0},
                {"type": "CE", "action": "sell", "strike_offset": 0},
                {"type": "CE", "action": "buy", "strike_offset": +1},
            ],
        },
    }

    def _to_float(self, value: Any, default: float = 0.0) -> float:
        try:
            out = float(value)
            if out != out:
                return default
            return out
        except (TypeError, ValueError):
            return default

    def _to_int(self, value: Any, default: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default

    def _leg_qty(self, leg: dict[str, Any]) -> int:
        lots = max(self._to_int(leg.get("lots"), 1), 1)
        lot_size = max(self._to_int(leg.get("lot_size"), 1), 1)
        return lots * lot_size

    def _leg_pnl(self, leg: dict[str, Any], spot: float) -> float:
        strike = self._to_float(leg.get("strike"), 0.0)
        premium = self._to_float(leg.get("premium"), 0.0)
        option_type = str(leg.get("type") or "").strip().upper()
        action = str(leg.get("action") or "").strip().lower()
        qty = self._leg_qty(leg)

        intrinsic = 0.0
        if option_type == "CE":
            intrinsic = max(spot - strike, 0.0)
        elif option_type == "PE":
            intrinsic = max(strike - spot, 0.0)
        if action == "buy":
            return (intrinsic - premium) * qty
        return (premium - intrinsic) * qty

    def _net_premium(self, legs: list[dict[str, Any]]) -> float:
        total = 0.0
        for leg in legs:
            premium = self._to_float(leg.get("premium"), 0.0)
            qty = self._leg_qty(leg)
            action = str(leg.get("action") or "").strip().lower()
            total += premium * qty if action == "sell" else -premium * qty
        return total

    def _spot_grid(self, legs: list[dict[str, Any]], spot_range: tuple[float, float] | None) -> list[float]:
        if spot_range is not None:
            lo, hi = spot_range
            lo_f = self._to_float(lo, 0.0)
            hi_f = self._to_float(hi, 0.0)
        else:
            strikes = [self._to_float(l.get("strike"), 0.0) for l in legs]
            strikes = [s for s in strikes if s > 0]
            center = (sum(strikes) / len(strikes)) if strikes else 100.0
            lo_f = center * 0.9
            hi_f = center * 1.1
        if hi_f <= lo_f:
            hi_f = lo_f + 100.0
        step = max(10.0, round((hi_f - lo_f) / 100.0, 2))
        values: list[float] = []
        x = lo_f
        while x <= hi_f + 1e-9:
            values.append(round(x, 2))
            x += step
        return values

    def _breakevens(self, payoff: list[dict[str, float]]) -> list[float]:
        points: list[float] = []
        for i in range(1, len(payoff)):
            p0 = payoff[i - 1]["pnl"]
            p1 = payoff[i]["pnl"]
            if p0 == 0:
                points.append(payoff[i - 1]["spot"])
            if p0 * p1 < 0:
                s0 = payoff[i - 1]["spot"]
                s1 = payoff[i]["spot"]
                # Linear interpolation between sampled points.
                x = s0 + (0 - p0) * (s1 - s0) / (p1 - p0)
                points.append(round(x, 2))
        dedup = []
        for p in points:
            if not dedup or abs(dedup[-1] - p) > 1e-6:
                dedup.append(p)
        return dedup

    def detect_strategy(self, legs: list[dict[str, Any]]) -> str:
        """
        Auto-detect common strategy names from leg configuration.
        """
        if not legs:
            return "Custom"
        norm = []
        for leg in legs:
            norm.append(
                {
                    "type": str(leg.get("type") or "").upper(),
                    "action": str(leg.get("action") or "").lower(),
                    "strike": self._to_float(leg.get("strike"), 0.0),
                }
            )

        if len(norm) == 2:
            a, b = norm
            if a["type"] == b["type"] == "CE" and a["action"] == "buy" and b["action"] == "sell":
                return "Bull Call Spread"
            if a["type"] == b["type"] == "PE" and a["action"] == "buy" and b["action"] == "sell":
                return "Bear Put Spread"
            if {x["type"] for x in norm} == {"CE", "PE"} and {x["action"] for x in norm} == {"buy"}:
                if abs(a["strike"] - b["strike"]) < 1e-9:
                    return "Long Straddle"
                return "Long Strangle"
            if {x["type"] for x in norm} == {"CE", "PE"} and {x["action"] for x in norm} == {"sell"}:
                if abs(a["strike"] - b["strike"]) < 1e-9:
                    return "Short Straddle"
                return "Short Strangle"

        if len(norm) == 4:
            c_buys = sum(1 for x in norm if x["type"] == "CE" and x["action"] == "buy")
            c_sells = sum(1 for x in norm if x["type"] == "CE" and x["action"] == "sell")
            p_buys = sum(1 for x in norm if x["type"] == "PE" and x["action"] == "buy")
            p_sells = sum(1 for x in norm if x["type"] == "PE" and x["action"] == "sell")
            if c_buys == 1 and c_sells == 1 and p_buys == 1 and p_sells == 1:
                sold = sorted([x["strike"] for x in norm if x["action"] == "sell"])
                if len(sold) == 2 and abs(sold[0] - sold[1]) < 1e-9:
                    return "Iron Butterfly"
                return "Iron Condor"

        return "Custom"

    async def build_from_preset(
        self,
        preset_name: str,
        symbol: str,
        expiry: str,
        atm_strike: float,
        strike_gap: float,
    ) -> list[dict[str, Any]]:
        """Build legs from a preset template using current market data."""
        key = str(preset_name or "").strip().lower()
        spec = self.PRESETS.get(key)
        if not spec:
            return []

        chain = await get_option_chain_fetcher().get_option_chain(symbol, expiry=expiry, strike_range=50)
        rows = chain.get("strikes") if isinstance(chain.get("strikes"), list) else []
        strikes = sorted({self._to_float(r.get("strike_price"), 0.0) for r in rows if isinstance(r, dict)})
        if not strikes:
            return []
        center = atm_strike if atm_strike > 0 else self._to_float(chain.get("atm_strike"), strikes[len(strikes) // 2])
        gap = strike_gap if strike_gap > 0 else max(1.0, (strikes[min(1, len(strikes) - 1)] - strikes[0]) if len(strikes) > 1 else 50.0)

        legs: list[dict[str, Any]] = []
        for leg_tpl in spec.get("template", []):
            offset = self._to_float(leg_tpl.get("strike_offset"), 0.0)
            target = center + offset * gap
            strike = min(strikes, key=lambda x: abs(x - target))
            row = next((r for r in rows if isinstance(r, dict) and abs(self._to_float(r.get("strike_price")) - strike) < 1e-9), None)
            opt_type = str(leg_tpl.get("type") or "CE").upper()
            leg_data = (row.get("ce") if opt_type == "CE" else row.get("pe")) if isinstance(row, dict) else {}
            premium = self._to_float((leg_data or {}).get("ltp"), 0.0)
            lot_size = 50
            legs.append(
                {
                    "type": opt_type,
                    "strike": strike,
                    "action": str(leg_tpl.get("action") or "buy").lower(),
                    "premium": premium,
                    "lots": 1,
                    "lot_size": lot_size,
                    "expiry": expiry or chain.get("expiry_date") or "",
                }
            )
        return legs

    def compute_payoff(self, legs: list[dict[str, Any]], spot_range: tuple[float, float] | None = None) -> dict[str, Any]:
        """
        Compute P&L payoff for a multi-leg strategy.
        """
        cleaned = [dict(leg) for leg in legs if isinstance(leg, dict)]
        grid = self._spot_grid(cleaned, spot_range)
        series = []
        for spot in grid:
            pnl = sum(self._leg_pnl(leg, spot) for leg in cleaned)
            series.append({"spot": spot, "pnl": round(pnl, 2)})

        pnls = [p["pnl"] for p in series] if series else [0.0]
        max_profit_val = max(pnls)
        max_loss_val = min(pnls)

        net_call_qty = 0
        for leg in cleaned:
            if str(leg.get("type") or "").upper() != "CE":
                continue
            qty = self._leg_qty(leg)
            action = str(leg.get("action") or "").lower()
            net_call_qty += qty if action == "buy" else -qty

        max_profit: float | str = round(max_profit_val, 2)
        max_loss: float | str = round(max_loss_val, 2)
        if net_call_qty > 0:
            max_profit = "unlimited"
        if net_call_qty < 0:
            max_loss = "unlimited"

        finite_profit = max_profit_val if isinstance(max_profit, (int, float)) else None
        finite_loss = abs(max_loss_val) if isinstance(max_loss, (int, float)) else None
        risk_reward = 0.0
        if finite_profit is not None and finite_loss is not None and finite_loss > 0:
            risk_reward = round(finite_profit / finite_loss, 4)

        margin_approx = sum(max(self._to_float(leg.get("strike"), 0.0), 1.0) * self._leg_qty(leg) * 0.15 for leg in cleaned if str(leg.get("action") or "").lower() == "sell")

        return {
            "legs": cleaned,
            "payoff_at_expiry": series,
            "max_profit": max_profit,
            "max_loss": max_loss,
            "breakeven_points": self._breakevens(series),
            "risk_reward_ratio": risk_reward,
            "net_premium": round(self._net_premium(cleaned), 2),
            "total_margin_approx": round(margin_approx, 2),
            "strategy_name": self.detect_strategy(cleaned),
        }


_strategy_builder = StrategyBuilder()


def get_strategy_builder() -> StrategyBuilder:
    return _strategy_builder
