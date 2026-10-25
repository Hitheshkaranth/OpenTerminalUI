from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import secrets
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError
from backend.research_dossiers.models import ResearchDossier, DossierRevision, now
from backend.research_dossiers.schemas import DossierCreate, Evidence


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def owned(db: Session, user_id: str, dossier_id: str) -> ResearchDossier:
    row = db.query(ResearchDossier).filter_by(id=dossier_id, user_id=user_id).first()
    if row is None:
        raise HTTPException(404, "Research dossier not found")
    return row


def output(row: ResearchDossier) -> dict:
    return {**deepcopy(row.payload), "id": row.id, "revision": row.revision,
            "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat(),
            "is_shared": bool(row.share_hash)}


def commit(db: Session):
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(409, "Dossier changed. Reload before saving.")


def validate_links(db: Session, user_id: str, payload: dict):
    from backend.models.agent_memory import AgentRun
    ids = payload.get("linked_run_ids", [])
    if ids:
        count = db.query(AgentRun).filter(AgentRun.user_id == user_id, AgentRun.id.in_(set(ids))).count()
        if count != len(set(ids)):
            raise HTTPException(422, "One or more research runs are unavailable")
    if payload.get("portfolio_id"):
        from backend.models import VirtualPortfolio
        if not db.query(VirtualPortfolio).filter_by(id=payload["portfolio_id"], user_id=user_id).first():
            raise HTTPException(422, "Portfolio is unavailable")


def record_revision(db: Session, row: ResearchDossier, changes: list):
    db.add(DossierRevision(dossier_id=row.id, revision=row.revision,
                           snapshot=deepcopy(row.payload), changes=changes))


def create(db: Session, user_id: str, payload: DossierCreate) -> dict:
    data = payload.model_dump(mode="json")
    data["symbol"] = data["symbol"].upper()
    validate_links(db, user_id, data)
    row = ResearchDossier(user_id=user_id, symbol=data["symbol"], payload=data, revision=1,
                          created_at=now(), updated_at=now())
    db.add(row)
    db.flush()
    record_revision(db, row, [{"kind": "created"}])
    commit(db)
    return output(row)


def update(db: Session, row: ResearchDossier, patch: dict) -> dict:
    expected = patch.pop("expected_revision", None)
    if expected is not None and expected != row.revision:
        raise HTTPException(409, "Dossier changed. Reload before saving.")
    data = DossierCreate.model_validate({**row.payload, **patch}).model_dump(mode="json")
    data["symbol"] = data["symbol"].upper()
    validate_links(db, row.user_id, data)
    changes = [{"kind": "field_changed", "field": key, "before": row.payload.get(key), "after": value}
               for key, value in data.items() if row.payload.get(key) != value]
    if changes:
        row.payload = data
        row.symbol = data["symbol"]
        row.revision += 1
        row.updated_at = now()
        record_revision(db, row, changes)
        commit(db)
    return output(row)


def evidence_fingerprint(e: dict) -> str:
    # Observation time changes on every fetch, but does not make new evidence.
    return digest({k: v for k, v in e.items() if k not in ("observed_at",)})


def compare_evidence(previous: dict | None, current: dict, threshold: float) -> dict | None:
    if previous and evidence_fingerprint(previous) == evidence_fingerprint(current):
        return None
    reason = "New evidence for review"
    material = previous is None
    change_pct = None
    if previous:
        if previous.get("stance") != current.get("stance"):
            material, reason = True, "Evidence stance changed; review the thesis"
        elif current.get("metric") and current.get("metric") == previous.get("metric") and current.get("unit") == previous.get("unit"):
            a, b = previous.get("value"), current.get("value")
            if isinstance(a, (float, int)) and isinstance(b, (float, int)):
                change_pct = abs((b - a) / a) * 100 if a else (100.0 if b else 0.0)
                material = change_pct >= threshold and a != b
                reason = f"Metric changed by {change_pct:.2f}% (threshold {threshold:g}%)"
            else:
                material, reason = True, "Evidence content changed"
        else:
            material, reason = True, "Evidence content changed"
    return {"kind": "evidence_added" if previous is None else "evidence_changed", "evidence_id": current["id"],
            "before": previous, "after": current, "material": material, "change_pct": change_pct, "reason": reason}


def filing_candidates(db: Session, row: ResearchDossier) -> list[dict]:
    from backend.filings_rag.models import FilingDocumentORM, FilingChunkORM
    data = row.payload
    terms = " ".join([data.get("thesis", ""), *data.get("invalidation_conditions", [])]).lower().split()
    stop = {"that", "this", "with", "from", "will", "have", "their", "than", "when", "company"}
    terms = {w.strip(".,:;()") for w in terms if len(w) > 3 and w not in stop}
    q = db.query(FilingDocumentORM).filter(FilingDocumentORM.symbol == row.symbol)
    if data.get("market"):
        q = q.filter(FilingDocumentORM.market == data["market"])
    docs = q.order_by(FilingDocumentORM.created_at.desc()).limit(50).all()
    items = []
    for doc in docs:
        # Monitor filings imported since the dossier was created, not the historical archive.
        if doc.created_at and doc.created_at.replace(tzinfo=None) < row.created_at.replace(tzinfo=None, microsecond=0):
            continue
        chunks = db.query(FilingChunkORM).filter_by(document_id=doc.id).order_by(FilingChunkORM.ordinal).all()
        ranked = sorted(chunks, key=lambda c: sum(t in c.text.lower() for t in terms), reverse=True)
        if not ranked:
            continue
        chunk = ranked[0]
        matches = [t for t in terms if t in chunk.text.lower()]
        if terms and not matches:
            continue
        try:
            published = datetime.fromisoformat(doc.filed_at.replace("Z", "+00:00")) if doc.filed_at else None
        except ValueError:
            published = None
        items.append(Evidence(id=f"filing:{doc.id}:{doc.sha256[:12]}",
            claim=f"New filing available: {doc.title}. Keyword overlap requires analyst review; no contradiction is inferred.",
            stance="neutral", source_title=doc.title, source_url=doc.source_url if (doc.source_url or "").startswith(("https://", "http://")) else None,
            quote=chunk.text[:20000], published_at=published, observed_at=now(), document_id=doc.id,
            page=chunk.page_start).model_dump(mode="json"))
    return items


def monitor(db: Session, row: ResearchDossier, evidence: list[dict] | None = None) -> dict:
    from backend.models.notification import Notification
    incoming = evidence if evidence is not None else filing_candidates(db, row)
    known = {e["id"]: e for e in row.payload.get("evidence", [])}
    # Latest observation separate from user-curated evidence, which monitoring never overwrites.
    state = deepcopy(row.monitor_state or {})
    observed = state.get("observed", {})
    changes = []
    for item in incoming:
        previous = observed.get(item["id"], known.get(item["id"]))
        change = compare_evidence(previous, item, row.payload.get("materiality_threshold", 5.0))
        if change:
            changes.append(change)
            observed[item["id"]] = item
    state["observed"] = observed
    state["last_checked_at"] = now().isoformat()
    row.monitor_state = state
    material = [c for c in changes if c["material"]]
    if changes:
        row.revision += 1
        row.updated_at = now()
        record_revision(db, row, changes)
    if material:
        db.add(Notification(user_id=row.user_id, type="research", priority="medium", ticker=row.symbol,
            title=f"{row.symbol}: {len(material)} research change(s) to review"[:200],
            body="; ".join(c["reason"] for c in material)[:4000], action_url=f"/equity/research-dossiers?id={row.id}"))
    commit(db)
    return {"changes": changes, "revision": row.revision, "dossier": output(row), "checked_at": state["last_checked_at"]}


def export_snapshot(db: Session, row: ResearchDossier) -> dict:
    from backend.models.agent_memory import AgentRun
    runs = []
    for run in db.query(AgentRun).filter(AgentRun.user_id == row.user_id, AgentRun.id.in_(row.payload.get("linked_run_ids", []))).all():
        entry = {"id": run.id, "mode": run.mode, "prompt": run.prompt, "final": run.final,
                 "status": run.status, "created_at": run.created_at.isoformat(), "grounding": None}
        try:
            entry["grounding"] = json.loads(run.grounding_json or "null")
        except ValueError:
            pass
        # Durable agent runtime may supply persisted events/config; preserve them when available.
        for key in ("request_json", "events_json", "context_json", "snapshot_json"):
            val = getattr(run, key, None)
            if val:
                try:
                    entry[key.removesuffix("_json")] = json.loads(val) if isinstance(val, str) else val
                except ValueError:
                    entry[key] = val
        from backend.agent.execution import export_run
        entry["runtime"] = export_run(run.id)
        runs.append(entry)
    from backend.research_dossiers.models import ResearchExperiment
    experiments = [{"id": experiment.id, "sha256": experiment.sha256, "snapshot": experiment.snapshot}
                   for experiment in db.query(ResearchExperiment).filter_by(user_id=row.user_id, dossier_id=row.id).all()]
    snapshot = {"schema_version": 1, "kind": "openterminal.research-dossier", "dossier": output(row), "runs": runs, "experiments": experiments,
                "monitoring": deepcopy(row.monitor_state or {}),
                "reproducibility": "Stored evidence and captured runs. External provider data may change; model output is not guaranteed deterministic."}
    return {**snapshot, "sha256": digest(snapshot)}


def share(db: Session, row: ResearchDossier) -> dict:
    token = secrets.token_urlsafe(32)
    row.share_hash = hashlib.sha256(token.encode()).hexdigest()
    snapshot = output(row)
    for field in ("portfolio_id", "linked_run_ids", "is_shared"):
        snapshot.pop(field, None)
    row.shared_snapshot = snapshot
    commit(db)
    return {"token": token, "url": f"/api/research/dossiers/shared/{token}", "revision": row.revision,
            "note": "Read-only snapshot. Later edits remain private until sharing again; sharing again revokes the old link."}
