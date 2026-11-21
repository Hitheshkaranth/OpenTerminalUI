from __future__ import annotations

import logging
from typing import Any

from backend.api.deps import fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.db.models import Holding

logger = logging.getLogger(__name__)


class PluginContextImpl:
    def __init__(self, db_factory, permissions: set[str], user_id: str | None = None) -> None:
        self.permissions = permissions
        self._db_factory = db_factory
        # Owner whose holdings read_portfolio exposes. Plugins are loaded globally (no
        # requesting user), so this is usually None and read_portfolio returns nothing.
        self.user_id = user_id

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
        if not self.user_id:
            return {"items": []}
        db = self._db_factory()
        try:
            rows = db.query(Holding).filter(Holding.user_id == self.user_id).all()
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
        logger.info("[plugin] %s", message)
