"""Transaction cost model for backtests and execution simulation."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class CostBreakdown:
    side: str
    notional: float
    brokerage: float
    exchange_fee: float
    stt: float
    stamp_duty: float
    gst: float
    slippage: float
    total: float
    bps_effective: float


@dataclass(frozen=True)
class TransactionCostModel:
    """Rule-based transaction cost model with India-friendly defaults."""

    brokerage_bps: float = 1.5
    exchange_fee_bps: float = 0.35
    stt_buy_bps: float = 0.0
    stt_sell_bps: float = 10.0
    stamp_duty_buy_bps: float = 1.5
    stamp_duty_sell_bps: float = 0.0
    gst_rate: float = 0.18
    slippage_bps: float = 2.0
    min_charge_per_order: float = 0.0

    @staticmethod
    def _bps(notional: float, bps: float) -> float:
        return max(notional, 0.0) * max(bps, 0.0) / 10000.0

    def calculate_leg_cost(self, notional: float, side: str) -> CostBreakdown:
        side_upper = side.strip().upper()
        if side_upper not in {"BUY", "SELL"}:
            raise ValueError(f"Unknown side: {side}")
        n = max(float(notional), 0.0)

        brokerage = self._bps(n, self.brokerage_bps)
        exchange_fee = self._bps(n, self.exchange_fee_bps)
        stt = self._bps(n, self.stt_buy_bps if side_upper == "BUY" else self.stt_sell_bps)
        stamp = self._bps(
            n, self.stamp_duty_buy_bps if side_upper == "BUY" else self.stamp_duty_sell_bps
        )
        slippage = self._bps(n, self.slippage_bps)
        gst = (brokerage + exchange_fee) * max(self.gst_rate, 0.0)

        total = brokerage + exchange_fee + stt + stamp + slippage + gst
        if total < self.min_charge_per_order:
            total = self.min_charge_per_order
        eff_bps = (total / n * 10000.0) if n > 0 else 0.0

        return CostBreakdown(
            side=side_upper,
            notional=n,
            brokerage=brokerage,
            exchange_fee=exchange_fee,
            stt=stt,
            stamp_duty=stamp,
            gst=gst,
            slippage=slippage,
            total=total,
            bps_effective=eff_bps,
        )

    def round_trip_cost(self, entry_notional: float, exit_notional: float | None = None) -> float:
        exit_n = float(entry_notional if exit_notional is None else exit_notional)
        buy = self.calculate_leg_cost(entry_notional, "BUY")
        sell = self.calculate_leg_cost(exit_n, "SELL")
        return buy.total + sell.total

    def apply_execution_price(self, price: float, side: str) -> float:
        p = float(price)
        slip = max(self.slippage_bps, 0.0) / 10000.0
        side_upper = side.strip().upper()
        if side_upper == "BUY":
            return p * (1.0 + slip)
        if side_upper == "SELL":
            return p * (1.0 - slip)
        raise ValueError(f"Unknown side: {side}")

    def estimate_for_fills(self, fills: Iterable[dict[str, float | str]]) -> dict[str, float]:
        total_notional = 0.0
        total_cost = 0.0
        for fill in fills:
            qty = float(fill.get("quantity", 0.0))
            price = float(fill.get("price", 0.0))
            side = str(fill.get("side", "BUY"))
            notional = abs(qty) * price
            total_notional += notional
            total_cost += self.calculate_leg_cost(notional, side).total
        impact_bps = (total_cost / total_notional * 10000.0) if total_notional > 0 else 0.0
        return {
            "total_notional": total_notional,
            "total_cost": total_cost,
            "effective_bps": impact_bps,
        }
