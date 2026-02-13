#!/usr/bin/env python3
"""Compatibility entrypoint for the GUI app."""

from trade_screens.gui import *  # noqa: F401,F403
from trade_screens.gui import main


if __name__ == "__main__":
    main()
