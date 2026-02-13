#!/usr/bin/env python3
"""Compatibility entrypoint for the analyzer CLI."""

from trade_screens.analyzer import *  # noqa: F401,F403
from trade_screens.analyzer import main


if __name__ == "__main__":
    output_path, filename = main()
    print(f"\n{'='*60}")
    print("  ANALYSIS COMPLETE")
    print(f"  File: {filename}")
    print(f"{'='*60}\n")
