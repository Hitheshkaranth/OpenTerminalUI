from __future__ import annotations

from typing import Any

from backend.api.deps import fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.db.models import Holding


class PluginContextImpl:
    def __init__(self, db_factory, permissions: set[str]) -> None:
        self.permissions = permissions
        self._db_factory = db_factory

    def _check(self, perm: str) -> None:
        if perm not in self.permissions:
            raise PermissionError(f"Plugin permission denied: {perm}")

    async def get_quote(self, symbol: str) -> dict[str, Any]:
        self._check("read_quotes")
        return await fetch_stock_snapshot_coalesced(symbol)

    async def get_history(self, symbol: str, range_str: str = "6mo", interval: str = "1d") -> dict[str, Any]:
        self._check("read_quotes")
        fetcher = await get_unified_fetcher()
        return await fetcher.fetch_history(symbol, range_str=range_str, interval=interval)

    async def create_alert(self, symbol: str, condition: str, value: float) -> dict[str, Any]:
        self._check("create_alerts")
        return {"symbol": symbol, "condition": condition, "threshold": value, "status": "created"}

    async def read_portfolio(self) -> dict[str, Any]:
        self._check("read_portfolio")
        db = self._db_factory()
        try:
            rows = db.query(Holding).all()
            return {
                "items": [
                    {
                        "id": x.id,
                        "ticker": x.ticker,
                        "quantity": x.quantity,
                        "avg_buy_price": x.avg_buy_price,
                        "buy_date": x.buy_date,
                    }
                    for x in rows
                ]
            }
        finally:
            db.close()

    def log(self, message: str) -> None:
        print(f"[plugin] {message}")
