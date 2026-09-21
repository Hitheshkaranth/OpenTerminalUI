"""Agent proposal API routes (C14).

Importing this module at the top of a router file ensures the AgentProposal
table is registered with SQLAlchemy.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.agent.proposals import confirm_proposal as _confirm_proposal
from backend.agent.proposals import expire_stale, list_proposals, reject_proposal as _reject_proposal
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import User
from backend.models.agent_proposals import AgentProposal  # noqa: F401 — registers the table

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/proposals")
def list_agent_proposals(
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return proposals for the current user, optionally filtered by status."""
    items = list_proposals(db, current_user.id, status=status)
    return {"items": items}


@router.post("/proposals/{proposal_id}/confirm")
async def confirm_agent_proposal(
    proposal_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Confirm a pending proposal, executing the underlying action."""
    try:
        return await _confirm_proposal(db, current_user.id, proposal_id)
    except ValueError as exc:
        msg = str(exc)
        if msg == "not_found":
            raise HTTPException(status_code=404, detail="Proposal not found")
        if msg == "expired":
            # Refresh the proposal so the caller sees the updated status
            p = db.query(AgentProposal).filter(AgentProposal.id == proposal_id).first()
            if p and p.status == "expired":
                raise HTTPException(status_code=409, detail="Proposal expired", headers={"X-Proposal-Status": "expired"})
            raise HTTPException(status_code=409, detail="Proposal expired")
        raise HTTPException(status_code=409, detail="Proposal cannot be confirmed")


@router.post("/proposals/{proposal_id}/reject")
def reject_agent_proposal(
    proposal_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Reject a proposal."""
    try:
        return _reject_proposal(db, current_user.id, proposal_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Proposal not found")


# ---------------------------------------------------------------------------
# Internal helper: call expire_stale on startup
# ---------------------------------------------------------------------------

def init_router() -> None:
    """Run once when the router is mounted — expire any stale proposals."""
    from backend.api.deps import get_db as _get_db
    try:
        db = _get_db.__wrapped__()  # type: ignore[attr-defined]
    except Exception:
        # If SessionLocal fails (no DB yet), skip
        return
    try:
        expire_stale(db)
    except Exception:
        pass
    finally:
        db.close()