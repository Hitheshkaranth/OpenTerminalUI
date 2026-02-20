from __future__ import annotations

from backend.shared.transaction_costs import TransactionCostModel


def test_cost_calculation_known_values():
    model = TransactionCostModel(
        brokerage_bps=1.0,
        exchange_fee_bps=0.5,
        stt_buy_bps=0.0,
        stt_sell_bps=10.0,
        stamp_duty_buy_bps=1.5,
        stamp_duty_sell_bps=0.0,
        gst_rate=0.18,
        slippage_bps=2.0,
    )

    buy = model.calculate_leg_cost(100_000.0, "BUY")
    sell = model.calculate_leg_cost(100_000.0, "SELL")

    assert round(buy.brokerage, 2) == 10.00
    assert round(buy.exchange_fee, 2) == 5.00
    assert round(buy.stamp_duty, 2) == 15.00
    assert round(buy.stt, 2) == 0.00
    assert round(buy.gst, 2) == 2.70
    assert round(buy.slippage, 2) == 20.00
    assert round(buy.total, 2) == 52.70

    assert round(sell.stt, 2) == 100.00
    assert round(sell.total, 2) == 137.70

    assert round(model.round_trip_cost(100_000.0), 2) == 190.40


def test_apply_execution_price_slippage_direction():
    model = TransactionCostModel(slippage_bps=5.0)
    assert round(model.apply_execution_price(100.0, "BUY"), 4) == 100.05
    assert round(model.apply_execution_price(100.0, "SELL"), 4) == 99.95


def test_estimate_for_fills():
    model = TransactionCostModel(slippage_bps=0.0, brokerage_bps=1.0, exchange_fee_bps=0.0)
    out = model.estimate_for_fills(
        [
            {"side": "BUY", "quantity": 10, "price": 100.0},
            {"side": "SELL", "quantity": 10, "price": 102.0},
        ]
    )
    assert out["total_notional"] == 2020.0
    assert out["total_cost"] > 0.0
    assert out["effective_bps"] > 0.0
