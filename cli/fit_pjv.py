from __future__ import annotations

import argparse
import json

from models.pure_jump_vol.data import load_ohlcv_csv
from models.pure_jump_vol.fit import fit_pjv_parameters


def main() -> None:
    parser = argparse.ArgumentParser(description="Fit pure-jump Markov volatility model.")
    parser.add_argument("--csv", required=True, help="Path to OHLCV CSV (date,open,high,low,close,volume)")
    parser.add_argument("--particles", type=int, default=256)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-iter", type=int, default=50)
    parser.add_argument("--out", default="", help="Optional path to save fitted params JSON")
    args = parser.parse_args()

    frame = load_ohlcv_csv(args.csv)
    returns = frame["close"].pct_change().fillna(0.0)
    fitted = fit_pjv_parameters(
        returns=returns,
        n_particles=max(32, int(args.particles)),
        seed=int(args.seed),
        max_iter=max(5, int(args.max_iter)),
    )
    payload = json.dumps(fitted, indent=2)
    print(payload)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(payload)


if __name__ == "__main__":
    main()
