from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import math
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
            if not math.isfinite(out):
                return default
            return out
        except (TypeError, ValueError):
            return default

    def _to_int(self, value: Any, default: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError, OverflowError):
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
        # Volume is contracts; latest price is not executed turnover. Only use
        # an explicit provider turnover, never an assumed contract multiplier.
        reported_premium = leg.get("premium_turnover")
        premium_value = self._to_float(reported_premium, -1.0)
        premium_value = round(premium_value, 2) if premium_value >= 0 else None

        if volume_ratio <= 2.0 and oi_change_ratio <= 2.0:
            return None

        event_timestamp = timestamp
        sentiment = "neutral"

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
            "currency": chain.get("currency") or ("INR" if str(chain.get("symbol", "")).upper() in DEFAULT_FLOW_SYMBOLS else None),
            "activity_basis": "cross_sectional_snapshot",
            "implied_vol": round(iv, 4),
            "sentiment": sentiment,
            "heat_score": self.compute_heat_score(volume_ratio, oi_change_ratio, 0.0),
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

    async def detect_unusual_activity(self, symbol: str | None = None, min_premium: float = 0, expiry: str | None = None) -> list[dict[str, Any]]:
        """
        Compare activity against the current chain cross-section, not historical volume.
        Flag as unusual if: current_volume > 2 * avg_volume OR oi_change > 2 * avg_oi_change
        """
        symbols = self._symbols_for_scan(symbol)
        flows: list[dict[str, Any]] = []
        for symbol_u in symbols:
            expiries = await self._fetcher.get_expiry_dates(symbol_u)
            selected_expiry = expiry or (expiries[0] if expiries else None)
            chain = await self._fetcher.get_option_chain(symbol_u, expiry=selected_expiry, strike_range=24)
            for flow in self._build_flows_from_chain(chain):
                if min_premium <= 0 or (flow.get("premium_value") is not None and self._to_float(flow.get("premium_value")) >= min_premium):
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

    async def get_flow_summary(self, period: str = "1d", symbol: str | None = None,
                               min_premium: float = 0, option_type: str | None = None,
                               expiry: str | None = None) -> dict[str, Any]:
        flows = await self.detect_unusual_activity(symbol=symbol, min_premium=min_premium, expiry=expiry)
        flows = [f for f in flows if (not option_type or f["option_type"] == option_type)
                 and (not expiry or f["expiry"] == expiry)]
        currencies = {f.get("currency") for f in flows if f.get("premium_value") is not None}
        complete = bool(flows) and all(f.get("premium_value") is not None for f in flows) and len(currencies) == 1 and None not in currencies
        calls = sum(f["option_type"] == "CE" for f in flows)
        puts = len(flows) - calls
        total = sum(f["premium_value"] for f in flows) if complete else None
        call_premium = sum(f["premium_value"] for f in flows if f["option_type"] == "CE") if complete else None
        buckets: dict[str, int] = defaultdict(int)
        for flow in flows:
            buckets[flow["symbol"]] += 1
        return {
            "total_premium": total, "bullish_premium": call_premium,
            "bearish_premium": total - call_premium if complete else None,
            "bullish_pct": round(calls / len(flows) * 100, 2) if flows else 0,
            "bearish_pct": round(puts / len(flows) * 100, 2) if flows else 0,
            "top_symbols": [{"symbol": name, "premium": None, "flow_count": count}
                            for name, count in sorted(buckets.items(), key=lambda x: x[1], reverse=True)[:5]],
            "premium_by_hour": [], "flow_count": len(flows),
            "currency": next(iter(currencies)) if complete else None,
            "history_available": False, "requested_period": period,
            "activity_basis": "cross_sectional_snapshot", "sentiment_basis": "option_type_only",
            "as_of": max((f["timestamp"] for f in flows), default=None),
            "notice": "Current chain snapshot only. Call/put counts do not indicate trade direction. Historical flow and execution-level premium are unavailable.",
        }


_options_flow_service = OptionsFlowService()


def get_options_flow_service() -> OptionsFlowService:
    return _options_flow_service
