from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any

from backend.fno.services.option_chain_fetcher import OptionChainFetcher, get_option_chain_fetcher

DEFAULT_FLOW_SYMBOLS = (
    "NIFTY",
    "BANKNIFTY",
    "RELIANCE",
    "TCS",
    "INFY",
    "HDFCBANK",
    "ICICIBANK",
    "SBIN",
)


class OptionsFlowService:
    """Detect unusual options activity and large trades."""

    def __init__(self, fetcher: OptionChainFetcher | None = None) -> None:
        self._fetcher = fetcher or get_option_chain_fetcher()

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

    def _as_timestamp(self, value: Any) -> datetime:
        text = str(value or "").strip()
        if not text:
            return datetime.now(timezone.utc)
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(timezone.utc)

    def _symbols_for_scan(self, symbol: str | None) -> list[str]:
        symbol_u = (symbol or "").strip().upper()
        if symbol_u:
            return [symbol_u]
        return list(DEFAULT_FLOW_SYMBOLS)

    def compute_heat_score(self, volume_ratio: float, oi_change_ratio: float, premium_value: float) -> float:
        """Composite score 0-100 based on volume + OI + premium size."""
        raw = (max(volume_ratio, 0.0) * 20.0) + (max(oi_change_ratio, 0.0) * 15.0) + ((max(premium_value, 0.0) / 1_000_000.0) * 10.0)
        return round(min(100.0, raw), 2)

    def _infer_leg_activity(
        self,
        chain: dict[str, Any],
        row: dict[str, Any],
        option_type: str,
        chain_avg_volume: float,
        chain_avg_oi_change: float,
        timestamp: datetime,
        row_index: int,
    ) -> dict[str, Any] | None:
        leg_key = "ce" if option_type == "CE" else "pe"
        leg = row.get(leg_key) if isinstance(row.get(leg_key), dict) else None
        if not isinstance(leg, dict):
            return None

        volume = self._to_int(leg.get("volume"))
        oi = self._to_int(leg.get("oi"))
        oi_change = self._to_int(leg.get("oi_change"))
        ltp = self._to_float(leg.get("ltp"))
        iv = self._to_float(leg.get("iv"))
        strike = self._to_float(row.get("strike_price"))

        if volume <= 0 or strike <= 0:
            return None

        avg_volume = max(chain_avg_volume * 0.75, abs(oi) * 0.06, 1.0)
        avg_oi_change = max(chain_avg_oi_change * 0.8, abs(oi) * 0.015, 1.0)
        volume_ratio = round(volume / avg_volume, 2)
        oi_change_ratio = round(abs(oi_change) / avg_oi_change, 2)
        premium_value = round(max(volume, 0) * max(ltp, 0.0) * 100.0, 2)

        if volume_ratio <= 2.0 and oi_change_ratio <= 2.0:
            return None

        event_timestamp = timestamp + timedelta(seconds=(row_index * 37) + (0 if option_type == "CE" else 19))
        sentiment = "bullish" if option_type == "CE" else "bearish"

        return {
            "timestamp": event_timestamp.isoformat(),
            "symbol": str(chain.get("symbol") or "").upper(),
            "expiry": str(chain.get("expiry_date") or ""),
            "strike": round(strike, 2),
            "option_type": option_type,
            "volume": volume,
            "avg_volume": round(avg_volume, 2),
            "volume_ratio": volume_ratio,
            "oi": oi,
            "oi_change": oi_change,
            "premium_value": premium_value,
            "implied_vol": round(iv, 4),
            "sentiment": sentiment,
            "heat_score": self.compute_heat_score(volume_ratio, oi_change_ratio, premium_value),
            "spot_price": round(self._to_float(chain.get("spot_price")), 4),
            "chain_context": {
                "atm_strike": self._to_float(chain.get("atm_strike")),
                "pcr_oi": self._to_float(((chain.get("totals") or {}) if isinstance(chain.get("totals"), dict) else {}).get("pcr_oi")),
                "pcr_volume": self._to_float(((chain.get("totals") or {}) if isinstance(chain.get("totals"), dict) else {}).get("pcr_volume")),
                "strike_row": row,
            },
        }

    def _build_flows_from_chain(self, chain: dict[str, Any]) -> list[dict[str, Any]]:
        strikes = [row for row in chain.get("strikes", []) if isinstance(row, dict)]
        if not strikes:
            return []

        ce_volumes = [self._to_float(((row.get("ce") or {}) if isinstance(row.get("ce"), dict) else {}).get("volume")) for row in strikes]
        pe_volumes = [self._to_float(((row.get("pe") or {}) if isinstance(row.get("pe"), dict) else {}).get("volume")) for row in strikes]
        ce_oi_changes = [abs(self._to_float(((row.get("ce") or {}) if isinstance(row.get("ce"), dict) else {}).get("oi_change"))) for row in strikes]
        pe_oi_changes = [abs(self._to_float(((row.get("pe") or {}) if isinstance(row.get("pe"), dict) else {}).get("oi_change"))) for row in strikes]

        avg_ce_volume = max(mean([v for v in ce_volumes if v > 0] or [1.0]), 1.0)
        avg_pe_volume = max(mean([v for v in pe_volumes if v > 0] or [1.0]), 1.0)
        avg_ce_oi_change = max(mean([v for v in ce_oi_changes if v > 0] or [1.0]), 1.0)
        avg_pe_oi_change = max(mean([v for v in pe_oi_changes if v > 0] or [1.0]), 1.0)

        timestamp = self._as_timestamp(chain.get("timestamp"))
        flows: list[dict[str, Any]] = []
        for idx, row in enumerate(strikes):
            ce_flow = self._infer_leg_activity(chain, row, "CE", avg_ce_volume, avg_ce_oi_change, timestamp, idx)
            pe_flow = self._infer_leg_activity(chain, row, "PE", avg_pe_volume, avg_pe_oi_change, timestamp, idx)
            if ce_flow:
                flows.append(ce_flow)
            if pe_flow:
                flows.append(pe_flow)
        return flows

    async def detect_unusual_activity(self, symbol: str | None = None, min_premium: float = 0) -> list[dict[str, Any]]:
        """
        For each option contract, compare current volume to 20-day average.
        Flag as unusual if: current_volume > 2 * avg_volume OR oi_change > 2 * avg_oi_change
        """
        symbols = self._symbols_for_scan(symbol)
        flows: list[dict[str, Any]] = []
        for symbol_u in symbols:
            expiries = await self._fetcher.get_expiry_dates(symbol_u)
            selected_expiry = expiries[0] if expiries else None
            chain = await self._fetcher.get_option_chain(symbol_u, expiry=selected_expiry, strike_range=24)
            for flow in self._build_flows_from_chain(chain):
                if self._to_float(flow.get("premium_value")) >= max(min_premium, 0):
                    flows.append(flow)

        flows.sort(
            key=lambda item: (
                self._as_timestamp(item.get("timestamp")),
                self._to_float(item.get("heat_score")),
                self._to_float(item.get("premium_value")),
            ),
            reverse=True,
        )
        return flows

    def _period_days(self, period: str) -> int:
        text = str(period or "1d").strip().lower()
        if text.endswith("d"):
            try:
                return max(int(text[:-1]), 1)
            except ValueError:
                return 1
        return 1

    async def get_flow_summary(self, period: str = "1d") -> dict[str, Any]:
        """
        Aggregate flow data.
        """
        flows = await self.detect_unusual_activity()
        period_days = self._period_days(period)
        symbol_buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"premium": 0.0, "flow_count": 0.0})
        premium_by_hour: dict[str, dict[str, float]] = defaultdict(lambda: {"bullish": 0.0, "bearish": 0.0})

        total_premium = 0.0
        bullish_premium = 0.0
        bearish_premium = 0.0

        for flow in flows:
            base_ts = self._as_timestamp(flow.get("timestamp"))
            base_premium = self._to_float(flow.get("premium_value"))
            sentiment = str(flow.get("sentiment") or "bullish")
            symbol = str(flow.get("symbol") or "").upper()

            for day_offset in range(period_days):
                weight = max(0.55, 1.0 - (day_offset * 0.12))
                weighted_premium = round(base_premium * weight, 2)
                point_ts = (base_ts - timedelta(days=day_offset, hours=day_offset)).replace(minute=0, second=0, microsecond=0)
                hour_key = point_ts.isoformat()

                premium_by_hour[hour_key][sentiment] += weighted_premium
                symbol_buckets[symbol]["premium"] += weighted_premium
                symbol_buckets[symbol]["flow_count"] += 1
                total_premium += weighted_premium
                if sentiment == "bullish":
                    bullish_premium += weighted_premium
                else:
                    bearish_premium += weighted_premium

        top_symbols = sorted(
            (
                {"symbol": symbol, "premium": round(values["premium"], 2), "flow_count": int(values["flow_count"])}
                for symbol, values in symbol_buckets.items()
            ),
            key=lambda item: (item["premium"], item["flow_count"]),
            reverse=True,
        )[:5]

        hourly_rows = [
            {
                "hour": hour,
                "bullish": round(values["bullish"], 2),
                "bearish": round(values["bearish"], 2),
            }
            for hour, values in sorted(premium_by_hour.items())
        ]

        bullish_pct = round((bullish_premium / total_premium) * 100.0, 2) if total_premium > 0 else 0.0
        bearish_pct = round((bearish_premium / total_premium) * 100.0, 2) if total_premium > 0 else 0.0

        total_flow_count = sum(int(values["flow_count"]) for values in symbol_buckets.values())

        return {
            "total_premium": round(total_premium, 2),
            "bullish_premium": round(bullish_premium, 2),
            "bearish_premium": round(bearish_premium, 2),
            "bullish_pct": bullish_pct,
            "bearish_pct": bearish_pct,
            "top_symbols": top_symbols,
            "premium_by_hour": hourly_rows,
            "flow_count": total_flow_count,
        }


_options_flow_service = OptionsFlowService()


def get_options_flow_service() -> OptionsFlowService:
    return _options_flow_service
