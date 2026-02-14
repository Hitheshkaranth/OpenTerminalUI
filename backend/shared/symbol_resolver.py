from __future__ import annotations

import csv
from pathlib import Path
from typing import Any


class SymbolResolver:
    """Resolves NSE ticker to company name, sector, and F&O eligibility."""

    def __init__(self, csv_path: str = "data/nse_equity_symbols_eq.csv") -> None:
        self._data = self._load(csv_path)

    def _load(self, csv_path: str) -> dict[str, dict[str, str]]:
        path = Path(csv_path)
        out: dict[str, dict[str, str]] = {}
        if not path.exists():
            return out
        try:
            with path.open("r", encoding="utf-8") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    symbol = str(row.get("SYMBOL") or row.get("symbol") or "").strip().upper()
                    if not symbol:
                        continue
                    out[symbol] = {k.strip().lower(): str(v).strip() for k, v in row.items() if k}
        except Exception:
            return {}
        return out

    def _row(self, ticker: str) -> dict[str, str]:
        return self._data.get((ticker or "").strip().upper(), {})

    def get_company_name(self, ticker: str) -> str:
        row = self._row(ticker)
        return row.get("name of company") or row.get("company_name") or row.get("company") or ""

    def get_sector(self, ticker: str) -> str:
        row = self._row(ticker)
        return row.get("industry") or row.get("sector") or ""

    def is_fno_eligible(self, ticker: str) -> bool:
        row = self._row(ticker)
        keys = ("fno", "f&o", "fo_eligible", "derivatives")
        for key in keys:
            val = row.get(key)
            if val and val.strip().lower() in {"y", "yes", "true", "1"}:
                return True
        # Conservative default for now until official lot metadata is wired.
        return False

    def get_fno_lot_size(self, ticker: str) -> int:
        row = self._row(ticker)
        for key in ("lot_size", "lotsize", "market_lot"):
            val = row.get(key)
            if not val:
                continue
            try:
                return int(float(val))
            except (TypeError, ValueError):
                continue
        return 0
