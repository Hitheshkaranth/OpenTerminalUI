"""Monitor locally ingested filings; never calls a provider or model implicitly."""
from __future__ import annotations

import asyncio
import logging
import os
from backend.shared.db import SessionLocal
from backend.research_dossiers.models import ResearchDossier
from backend.research_dossiers.service import monitor

logger = logging.getLogger(__name__)
_task: asyncio.Task | None = None


def check_enabled_dossiers() -> dict:
    checked = failed = 0
    with SessionLocal() as db:
        ids = [r.id for r in db.query(ResearchDossier).all() if r.payload.get("monitoring_enabled")]
    for dossier_id in ids:
        with SessionLocal() as db:
            row = db.get(ResearchDossier, dossier_id)
            if row is None or not row.payload.get("monitoring_enabled"):
                continue
            try:
                monitor(db, row)
                checked += 1
            except Exception:
                db.rollback()
                failed += 1
                logger.exception("Dossier monitor failed for %s", dossier_id)
    return {"checked": checked, "failed": failed}


async def _loop():
    while True:
        await asyncio.sleep(900)
        try:
            await asyncio.to_thread(check_enabled_dossiers)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Dossier monitoring failed")


async def start_dossier_monitor():
    global _task
    if os.getenv("RESEARCH_DOSSIER_MONITOR_ENABLED", "1") == "0":
        return
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


async def stop_dossier_monitor():
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
