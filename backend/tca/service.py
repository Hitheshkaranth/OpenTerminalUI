import hashlib
from backend.tca.schemas import TCAResponse, TCATradeStat, TCAAggregates

def generate_tca_report(window: str) -> TCAResponse:
    # Deterministic pseudo-random generation based on window string to allow stable testing
    seed_str = f"tca_seed_{window}"
    h = hashlib.md5(seed_str.encode()).hexdigest()
    base_slippage = (int(h[:4], 16) / 65535.0) * 5.0 # 0 to 5.0 expected slippage

    trades = []
    total_slippage = 0.0
    total_fees = 0.0

    # Generate 10 mocked trades
    for i in range(10):
        trade_id = f"trd_{h[i:i+8]}"
        expected = round(base_slippage + (i * 0.5), 2)
        realized = round(expected + (int(h[i+1:i+3], 16) / 255.0) * 2.0, 2) # Adding noise for realized

        trades.append(TCATradeStat(
            trade_id=trade_id,
            expected_slippage=expected,
            realized_slippage=realized
        ))

        total_slippage += realized
        total_fees += 1.5 # Fixed mocked fee

    return TCAResponse(
        per_trade_stats=trades,
        aggregates=TCAAggregates(
            total_slippage=round(total_slippage, 2),
            total_fees=round(total_fees, 2)
        )
    )
