"""Persisted daily/weekly schedules with an atomic cross-worker lease."""
import asyncio
from datetime import timedelta
import logging
import os
from sqlalchemy import or_
from backend.shared.db import SessionLocal
from .models import ScreenSchedule, utcnow
from . import service

logger = logging.getLogger(__name__)
_task = None


async def check_due_screens():
    now = utcnow()
    with SessionLocal() as db:
        ids = [r.id for r in db.query(ScreenSchedule).filter(ScreenSchedule.enabled.is_(True), ScreenSchedule.next_run_at <= now).all()]
    checked = failed = 0
    for schedule_id in ids:
        with SessionLocal() as db:
            claimed = db.query(ScreenSchedule).filter(ScreenSchedule.id == schedule_id, ScreenSchedule.enabled.is_(True),
                ScreenSchedule.next_run_at <= now, or_(ScreenSchedule.lease_until.is_(None), ScreenSchedule.lease_until < now)).update(
                    {"lease_until": now + timedelta(minutes=5)}, synchronize_session=False)
            db.commit()
            if not claimed:
                continue
            row = db.get(ScreenSchedule, schedule_id)
            try:
                await service.run(db, row)
                checked += 1
            except Exception:
                db.rollback()
                row = db.get(ScreenSchedule, schedule_id)
                if row:
                    row.error = "Scheduled check failed. Previous results are preserved; retry in 15 minutes."
                    row.next_run_at = utcnow() + timedelta(minutes=15)
                    row.lease_until = None
                    db.commit()
                failed += 1
                logger.exception("Scheduled screen check failed for %s", schedule_id)
    return {"checked": checked, "failed": failed}


async def _loop():
    while True:
        try:
            await check_due_screens()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Screen monitoring scheduler failed")
        await asyncio.sleep(60)


async def start_screen_monitor():
    global _task
    if os.getenv("SCREEN_MONITOR_ENABLED", "1") != "0" and (_task is None or _task.done()):
        _task = asyncio.create_task(_loop())


async def stop_screen_monitor():
    global _task
    if _task:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
