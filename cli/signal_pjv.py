from __future__ import annotations

import argparse
import json

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
    parser = argparse.ArgumentParser(description="Generate PJV buy/sell signals.")
    parser.add_argument("--csv", required=True)
    parser.add_argument("--params-json", default="")
    parser.add_argument("--out", default="", help="Optional CSV path for signals")
    args = parser.parse_args()

    frame = load_ohlcv_csv(args.csv)
    ctx = _load_params(args.params_json) if args.params_json else {}
    signals, _ = generate_pjv_signals(frame, ctx)
    out_frame = frame.copy()
    out_frame["signal"] = signals.astype(int).values
    print(out_frame[["date", "close", "signal"]].tail(10).to_string(index=False))
    if args.out:
        out_frame.to_csv(args.out, index=False)


if __name__ == "__main__":
    main()
