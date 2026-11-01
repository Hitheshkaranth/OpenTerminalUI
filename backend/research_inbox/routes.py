from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.research_inbox import service
from backend.research_inbox.models import ResearchReviewState
from backend.research_inbox.impact import portfolio_impact
from backend.models.core import PortfolioORM

router = APIRouter(prefix="/api/research/inbox", tags=["research-review"])


class ReviewAction(BaseModel):
    status: Literal["needs_review", "reviewed", "snoozed"]
    snoozed_until: datetime | None = None

    @model_validator(mode="after")
    def valid_snooze(self):
        if self.status == "snoozed":
            if not self.snoozed_until or self.snoozed_until.tzinfo is None or self.snoozed_until <= datetime.now(timezone.utc):
                raise ValueError("Choose a future snooze time with a timezone")
        return self


@router.get("")
def inbox(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return service.events(db, user.id)


@router.patch("/events/{event_id}")
def review(event_id: str, payload: ReviewAction, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not any(i["id"] == event_id for i in service.events(db, user.id)["items"]):
        raise HTTPException(404, "Research event not found")
    state = db.get(ResearchReviewState, (user.id, event_id))
    if state is None:
        state = ResearchReviewState(user_id=user.id, event_id=event_id)
        db.add(state)
    state.status = payload.status
    state.snoozed_until = payload.snoozed_until if payload.status == "snoozed" else None
    state.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": event_id, "status": state.status, "snoozed_until": service.iso(state.snoozed_until)}


@router.get("/portfolios")
def portfolios(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"items": [{"id": p.id, "name": p.name, "currency": p.currency} for p in db.query(PortfolioORM).filter_by(user_id=user.id).all()]}


@router.get("/portfolios/{portfolio_id}/impact")
async def impact(portfolio_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return await portfolio_impact(db, user.id, portfolio_id)
