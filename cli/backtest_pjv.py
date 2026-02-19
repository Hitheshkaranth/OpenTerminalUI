from __future__ import annotations

import argparse
import json

from models.pure_jump_vol.backtest import backtest_positions
from models.pure_jump_vol.data import load_ohlcv_csv
from models.pure_jump_vol.signals import generate_pjv_signals


def _load_params(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        obj = json.load(f)
    if isinstance(obj, dict) and "params" in obj and isinstance(obj["params"], dict):
        return obj["params"]
    if isinstance(obj, dict):
        return obj
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run vectorized backtest using PJV signals.")
    parser.add_argument("--csv", required=True)
    parser.add_argument("--params-json", default="")
    parser.add_argument("--tc-bps", type=float, default=10.0)
    parser.add_argument("--slippage-bps", type=float, default=5.0)
    parser.add_argument("--lag", type=int, default=1)
    args = parser.parse_args()

    frame = load_ohlcv_csv(args.csv)
    ctx = _load_params(args.params_json) if args.params_json else {}
    positions, _ = generate_pjv_signals(frame, ctx)
    result = backtest_positions(
        frame=frame,
        positions=positions,
        transaction_cost_bps=float(args.tc_bps),
        slippage_bps=float(args.slippage_bps),
        position_lag=int(args.lag),
    )
    print(json.dumps(result["metrics"], indent=2))


if __name__ == "__main__":
    main()
