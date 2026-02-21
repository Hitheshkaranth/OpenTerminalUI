from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ExecutionProfile:
    commission_fixed: float = 0.0
    commission_bps: float = 0.0
    slippage_bps: float = 0.0
    spread_bps: float = 0.0
    atr_slippage_mult: float = 0.0
    volume_participation: float = 0.1
    market_impact_bps: float = 0.0
    borrow_bps_annual: float = 0.0


def parse_execution_profile(raw: dict[str, Any] | None) -> ExecutionProfile:
    data = raw or {}
    return ExecutionProfile(
        commission_fixed=float(data.get("commission_fixed") or 0.0),
        commission_bps=float(data.get("commission_bps") or 0.0),
        slippage_bps=float(data.get("slippage_bps") or 0.0),
        spread_bps=float(data.get("spread_bps") or 0.0),
        atr_slippage_mult=float(data.get("atr_slippage_mult") or 0.0),
        volume_participation=float(data.get("volume_participation") or 0.1),
        market_impact_bps=float(data.get("market_impact_bps") or 0.0),
        borrow_bps_annual=float(data.get("borrow_bps_annual") or 0.0),
    )


def apply_execution_costs(
    notional: float,
    side: str,
    profile: ExecutionProfile,
    atr_pct: float = 0.0,
    hold_days: float = 1.0,
) -> dict[str, float]:
    side_sign = 1.0 if str(side).lower() in {"buy", "long"} else -1.0
    commission = profile.commission_fixed + abs(notional) * (profile.commission_bps / 10000.0)
    slippage = abs(notional) * ((profile.slippage_bps + profile.spread_bps + profile.market_impact_bps) / 10000.0)
    atr_slippage = abs(notional) * max(0.0, atr_pct) * profile.atr_slippage_mult
    borrow = 0.0
    if side_sign < 0 and profile.borrow_bps_annual > 0:
        borrow = abs(notional) * (profile.borrow_bps_annual / 10000.0) * (max(hold_days, 0.0) / 252.0)
    total = commission + slippage + atr_slippage + borrow
    return {
        "commission": float(commission),
        "slippage": float(slippage + atr_slippage),
        "borrow": float(borrow),
        "total_cost": float(total),
    }
