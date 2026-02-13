#!/usr/bin/env python3
"""Compatibility entrypoint for demo runner."""

from trade_screens.demo import *  # noqa: F401,F403
from trade_screens.demo import run_demo


if __name__ == "__main__":
    import sys

    tickers = sys.argv[1:] if len(sys.argv) > 1 else ['HAL', 'BEL', 'RELIANCE', 'TATAPOWER', 'INFY']
    output_path, filename = run_demo(tickers)
    print(f"\n  DEMO COMPLETE: {filename}")
