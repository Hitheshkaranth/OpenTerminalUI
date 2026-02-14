from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.fno.services.pcr_tracker import get_pcr_tracker

logger = logging.getLogger(__name__)


def _now_ist() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)


class PCRSnapshotService:
    """Daily PCR snapshots after market close for key F&O symbols."""

    def __init__(self) -> None:
        self._scheduler: Any = None
        self._lock = asyncio.Lock()
        self._last_snapshot_date: str | None = None
        self._last_status: str = "never"

    def status_snapshot(self) -> dict[str, str | None]:
        return {"last_pcr_snapshot_date": self._last_snapshot_date, "last_pcr_snapshot_status": self._last_status}

    async def start(self) -> None:
        if self._scheduler and self._scheduler.running:
            return
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler  # type: ignore
            from apscheduler.triggers.interval import IntervalTrigger  # type: ignore
        except Exception as exc:
            logger.warning("PCR snapshot service disabled: APScheduler unavailable (%s)", exc)
            self._last_status = "scheduler_unavailable"
            return

        scheduler = AsyncIOScheduler(timezone="UTC")
        scheduler.add_job(
            self._run_safe,
            trigger=IntervalTrigger(minutes=30),
            id="pcr-snapshot",
            max_instances=1,
            coalesce=True,
            replace_existing=True,
            next_run_time=datetime.now(timezone.utc),
        )
        scheduler.start()
        self._scheduler = scheduler
        logger.info("event=pcr_snapshot_scheduler_started")

    async def stop(self) -> None:
        if not self._scheduler:
            return
        self._scheduler.shutdown(wait=True)
        self._scheduler = None
        logger.info("event=pcr_snapshot_scheduler_stopped")

    async def _run_safe(self) -> None:
        async with self._lock:
            now = _now_ist()
            if now.weekday() >= 5:
                self._last_status = "skipped:weekend"
                return
            if (now.hour, now.minute) < (15, 30):
                self._last_status = "skipped:before_close"
                return
            snap_date = now.date().isoformat()
            if self._last_snapshot_date == snap_date:
                self._last_status = "skipped:already_done"
                return
            await self.snapshot_now()

    async def snapshot_now(self) -> None:
        tracker = get_pcr_tracker()
        now = _now_ist()
        snap_date = now.date().isoformat()
        ok = 0
        for symbol in tracker.snapshot_universe():
            try:
                await tracker.store_snapshot(symbol, snapshot_date=snap_date)
                ok += 1
            except Exception:
                continue
        self._last_snapshot_date = snap_date
        self._last_status = f"ok:{ok}"
        logger.info("event=pcr_snapshot_complete date=%s symbols=%s", snap_date, ok)


_pcr_snapshot_service = PCRSnapshotService()


def get_pcr_snapshot_service() -> PCRSnapshotService:
    return _pcr_snapshot_service
