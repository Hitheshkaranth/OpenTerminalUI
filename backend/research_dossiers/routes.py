from __future__ import annotations

import hashlib
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.research_dossiers import service
from backend.research_dossiers.models import ResearchDossier, DossierRevision
from backend.research_dossiers.schemas import DossierCreate, DossierUpdate, MonitorRequest

router = APIRouter(prefix="/api/research/dossiers", tags=["research-dossiers"])


@router.get("")
def list_dossiers(symbol: str | None = None, limit: int = Query(100, ge=1, le=500),
                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(ResearchDossier).filter_by(user_id=user.id)
    if symbol:
        q = q.filter(ResearchDossier.symbol == symbol.strip().upper())
    return {"items": [service.output(r) for r in q.order_by(ResearchDossier.updated_at.desc()).limit(limit).all()]}


@router.post("", status_code=201)
def create_dossier(payload: DossierCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return service.create(db, user.id, payload)


# This route is intentionally public: an unguessable, revocable token grants snapshot-only read access.
@router.get("/shared/{token}")
def shared_dossier(token: str, db: Session = Depends(get_db)):
    row = db.query(ResearchDossier).filter_by(share_hash=hashlib.sha256(token.encode()).hexdigest()).first()
    if not row or not row.shared_snapshot:
        raise HTTPException(404, "Shared research not found")
    return {"dossier": row.shared_snapshot, "read_only": True}


@router.get("/{dossier_id}")
def get_dossier(dossier_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return service.output(service.owned(db, user.id, dossier_id))


@router.patch("/{dossier_id}")
def patch_dossier(dossier_id: str, payload: DossierUpdate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        return service.update(db, service.owned(db, user.id, dossier_id), payload.model_dump(mode="json", exclude_unset=True))
    except ValidationError as exc:
        raise HTTPException(422, str(exc))


@router.delete("/{dossier_id}")
def delete_dossier(dossier_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = service.owned(db, user.id, dossier_id)
    db.query(DossierRevision).filter_by(dossier_id=row.id).delete()
    db.delete(row)
    service.commit(db)
    return {"ok": True}


@router.get("/{dossier_id}/revisions")
def list_revisions(dossier_id: str, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db), user=Depends(get_current_user)):
    service.owned(db, user.id, dossier_id)
    rows = db.query(DossierRevision).filter_by(dossier_id=dossier_id).order_by(DossierRevision.revision.desc()).limit(limit).all()
    return {"items": [{"revision": r.revision, "snapshot": r.snapshot, "changes": r.changes,
                        "created_at": r.created_at.isoformat()} for r in rows]}


@router.post("/{dossier_id}/monitor")
def check_dossier(dossier_id: str, payload: MonitorRequest | None = None,
                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = service.owned(db, user.id, dossier_id)
    evidence = [e.model_dump(mode="json") for e in payload.evidence] if payload and payload.evidence is not None else None
    return service.monitor(db, row, evidence)


@router.get("/{dossier_id}/export")
def export_dossier(dossier_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return service.export_snapshot(db, service.owned(db, user.id, dossier_id))


@router.post("/{dossier_id}/share")
def share_dossier(dossier_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return service.share(db, service.owned(db, user.id, dossier_id))


@router.delete("/{dossier_id}/share")
def revoke_share(dossier_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = service.owned(db, user.id, dossier_id)
    row.share_hash = row.shared_snapshot = None
    service.commit(db)
    return {"ok": True}


@router.get("/{dossier_id}/search")
def search_evidence(dossier_id: str, q: str = Query(min_length=1, max_length=2000),
                    as_of: str | None = None, filed_after: str | None = None, period: str | None = None,
                    hybrid: bool = True, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from backend.filings_rag.retrieve import search
    row = service.owned(db, user.id, dossier_id)
    try:
        items = search(db, row.symbol, q, as_of=as_of, filed_after=filed_after,
                       periods=[period] if period else None, hybrid=hybrid)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return {"items": items, "as_of": as_of, "historical_date_policy": "Unknown filing dates excluded when a date filter is used"}


@router.get("/{dossier_id}/passages/{chunk_id}")
def get_passage(dossier_id: str, chunk_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from backend.filings_rag.store import get_chunks
    row = service.owned(db, user.id, dossier_id)
    item = next((c for c in get_chunks(db, row.symbol) if c["id"] == chunk_id), None)
    if not item:
        raise HTTPException(404, "Passage not found")
    return item
