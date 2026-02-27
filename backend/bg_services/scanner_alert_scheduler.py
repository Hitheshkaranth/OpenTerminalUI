from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from backend.alerts.scanner_rules import process_scanner_tick
from backend.api.deps import fetch_stock_snapshot_coalesced
from backend.models import ScanAlertRuleORM
from backend.services.marketdata_hub import MarketDataHub
from backend.shared.db import SessionLocal


class ScannerAlertSchedulerService:
    def __init__(self) -> None:
        self._running = False
        self._task: Any = None
        self._hub: MarketDataHub | None = None
        self._last_run_at: str | None = None
        self._last_status: str = "idle"
        self._last_scanned_symbols: int = 0

    async def start(self, hub: MarketDataHub, interval_seconds: int = 900) -> None:
        if self._running:
            return
        self._running = True
        self._hub = hub

        async def _runner() -> None:
            while self._running:
                try:
                    await self.run_once()
                    self._last_status = "ok"
                except Exception:
                    self._last_status = "error"
                await asyncio.sleep(max(60, int(interval_seconds)))

        self._task = asyncio.create_task(_runner(), name="scanner-alert-scheduler")

    async def stop(self) -> None:
        self._running = False
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()

    async def run_once(self) -> None:
        if self._hub is None:
            return
        db = SessionLocal()
        try:
            rules = (
                db.query(ScanAlertRuleORM)
                .filter(ScanAlertRuleORM.enabled.is_(True))
                .all()
            )
            symbols = sorted({str(r.symbol or "").upper() for r in rules if str(r.symbol or "").strip()})
        finally:
            db.close()

        scanned = 0
        for symbol in symbols:
            snap = await fetch_stock_snapshot_coalesced(symbol)
            if not snap:
                continue
            ltp = snap.get("current_price")
            if ltp is None:
                continue
            tick = {
                "symbol": symbol,
                "ltp": float(ltp),
            }
            db2 = SessionLocal()
            try:
                await process_scanner_tick(db2, self._hub, tick)
            finally:
                db2.close()
            scanned += 1

        self._last_run_at = datetime.utcnow().isoformat()
        self._last_scanned_symbols = scanned

    def status_snapshot(self) -> dict[str, Any]:
        return {
            "last_run_at": self._last_run_at,
            "last_status": self._last_status,
            "last_scanned_symbols": self._last_scanned_symbols,
            "running": self._running,
        }


_service = ScannerAlertSchedulerService()


def get_scanner_alert_scheduler_service() -> ScannerAlertSchedulerService:
    return _service
