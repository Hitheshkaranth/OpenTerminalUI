from __future__ import annotations

from backend.execution_sim.simulator import apply_execution_costs, parse_execution_profile


def test_execution_costs_positive_and_repeatable() -> None:
    profile = parse_execution_profile(
        {
            "commission_fixed": 2,
            "commission_bps": 5,
            "slippage_bps": 3,
            "spread_bps": 1,
            "market_impact_bps": 2,
            "borrow_bps_annual": 100,
        }
    )
    one = apply_execution_costs(notional=100000, side="short", profile=profile, atr_pct=0.01, hold_days=10)
    two = apply_execution_costs(notional=100000, side="short", profile=profile, atr_pct=0.01, hold_days=10)
    assert one == two
    assert one["total_cost"] > 0
    assert one["borrow"] > 0
