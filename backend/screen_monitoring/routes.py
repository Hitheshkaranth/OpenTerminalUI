from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from . import service
from .models import ScreenSchedule, ScreenChange, utcnow
from .schemas import ScheduleInput, SchedulePatch

router = APIRouter(prefix="/api/screen-monitoring", tags=["screen-monitoring"])


@router.get("")
def list_schedules(db: Session = Depends(get_db), user=Depends(get_current_user)):
    from backend.models import UserScreenORM
    rows = db.query(ScreenSchedule).join(UserScreenORM, UserScreenORM.id == ScreenSchedule.screen_id).filter(
        ScreenSchedule.user_id == user.id, UserScreenORM.user_id == user.id).all()
    return {"items": [service.output(db, r) for r in rows]}


@router.post("/preview")
def preview(payload: ScheduleInput, db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        return service.preview(db, user.id, payload)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("", status_code=201)
def save(payload: ScheduleInput, db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        return service.save(db, user.id, payload)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.get("/{schedule_id}")
def get_schedule(schedule_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return service.output(db, service.owned(db, user.id, schedule_id))


@router.patch("/{schedule_id}")
def patch(schedule_id: str, payload: SchedulePatch, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = service.owned(db, user.id, schedule_id)
    if payload.enabled is not None:
        row.enabled = payload.enabled
    if payload.frequency is not None:
        row.frequency = payload.frequency
    row.next_run_at = utcnow()
    db.commit()
    return service.output(db, row)


@router.post("/{schedule_id}/run")
async def run(schedule_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from datetime import timedelta
    from sqlalchemy import or_
    from .service import aware
    row = service.owned(db, user.id, schedule_id)
    now = utcnow()
    claimed = db.query(ScreenSchedule).filter(ScreenSchedule.id == row.id, or_(ScreenSchedule.lease_until.is_(None), ScreenSchedule.lease_until < now)).update({"lease_until": now + timedelta(minutes=5)}, synchronize_session=False)
    db.commit()
    if not claimed:
        raise HTTPException(409, "This screen is already being checked. Refresh shortly.")
    db.refresh(row)
    try:
        return await service.run(db, row)
    except Exception as exc:
        db.rollback()
        row = service.owned(db, user.id, schedule_id)
        row.lease_until = None
        row.error = "Screen check failed; previous results are preserved. Retry the check."
        db.commit()
        if isinstance(exc, (ValueError, HTTPException)):
            raise HTTPException(422, str(exc))
        raise HTTPException(503, row.error)


@router.delete("/{schedule_id}")
def delete(schedule_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = service.owned(db, user.id, schedule_id)
    db.query(ScreenChange).filter_by(schedule_id=row.id, user_id=user.id).delete()
    db.delete(row)
    db.commit()
    return {"ok": True}
