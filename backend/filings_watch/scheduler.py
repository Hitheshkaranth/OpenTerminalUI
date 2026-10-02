from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.filings_watch import service

logger = logging.getLogger(__name__)

ENV_ENABLED_KEY = "FILINGS_WATCH_ENABLED"

_TASK: Any = None


def _enabled_by_env() -> bool:
    return os.environ.get(ENV_ENABLED_KEY, "1").strip() != "0"


async def _sleep_until_hour(hour: int) -> None:
    now = datetime.now(timezone.utc)
    target = now.replace(hour=int(hour) % 24, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    delay = max(0.0, (target - now).total_seconds())
    try:
        await asyncio.sleep(min(delay, 86_400))
    except asyncio.CancelledError:
        raise


async def _loop() -> None:
    while True:
        try:
            await _sleep_until_hour(service.effective_run_hour())
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("filings-watch: computing next run time failed")
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                raise
            continue

        try:
            await service.trigger_run()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("filings-watch: scheduled run failed")


async def start_filings_watch() -> None:
    """Started from backend/main.py lifespan. Never blocks or crashes startup."""
    global _TASK
    if _TASK is not None and not _TASK.done():
        return
    if not _enabled_by_env():
        logger.info("filings-watch disabled via env; scheduler not started")
        return
    try:
        _TASK = asyncio.ensure_future(_loop())
        logger.info("filings-watch scheduler started")
    except Exception:  # noqa: BLE001
        logger.exception("filings-watch: failed to start scheduler")
        _TASK = None


async def stop_filings_watch() -> None:
    global _TASK
    if _TASK is not None:
        _TASK.cancel()
        _TASK = None