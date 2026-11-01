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
from backend.research_dossiers.conditions import evaluate_conditions, filing_metric_observations


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
            "condition_status": evaluate_conditions(row.payload, (row.monitor_state or {}).get("observed")),
            "source_fetch": deepcopy((row.monitor_state or {}).get("source_fetch")),
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
    for review in data.get("earnings_reviews", []):
        review["recorded_at"] = now().isoformat()
        review["reviewed_at"] = now().isoformat() if any(metric.get("actual") is not None for metric in review["metrics"]) else None
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
        prior_payload = row.payload
        row.payload = data
        if "evidence" in patch or "thesis_conditions" in patch:
            condition_changes = refresh_conditions(row, prior_payload)
            changes.extend(condition_changes)
            notify_changes(db, row, condition_changes)
        row.symbol = data["symbol"]
        row.revision += 1
        row.updated_at = now()
        record_revision(db, row, changes)
        commit(db)
    return output(row)


def refresh_conditions(row: ResearchDossier, prior_payload: dict | None = None) -> list[dict]:
    state = deepcopy(row.monitor_state or {})
    previous = state.get("conditions")
    if previous is None:
        previous = {item["condition_id"]: item for item in evaluate_conditions(prior_payload or {}, state.get("observed"))}
    evaluations = evaluate_conditions(row.payload, state.get("observed"))
    signature = lambda e: digest({**{k: e.get(k) for k in ("condition", "status", "value")},
        "evidence": evidence_fingerprint(e["evidence"]) if e.get("evidence") else None})
    changes = []
    for evaluation in evaluations:
        before = previous.get(evaluation["condition_id"])
        if (before is None and evaluation["status"] != "unknown") or (before is not None and signature(before) != signature(evaluation)):
            changes.append({"kind": "condition_changed", "condition_id": evaluation["condition_id"], "before": before,
                "after": evaluation, "material": True, "reason": evaluation["reason"]})
    state["conditions"] = {item["condition_id"]: item for item in evaluations}
    row.monitor_state = state
    return changes


def notify_changes(db: Session, row: ResearchDossier, changes: list):
    from backend.models.notification import Notification
    material = [item for item in changes if item.get("material")]
    if material:
        db.add(Notification(user_id=row.user_id, type="research", priority="medium", ticker=row.symbol,
            title=f"{row.symbol}: {len(material)} research change(s) to review"[:200],
            body="; ".join(item["reason"] for item in material)[:4000], action_url=f"/equity/research-dossiers?id={row.id}"))


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
        for condition in data.get("thesis_conditions", []):
            if condition.get("enabled", True):
                for source_chunk in chunks:
                    items.extend(filing_metric_observations(condition,
                        {"id": source_chunk.id, "text": source_chunk.text, "page_start": source_chunk.page_start},
                        {"id": doc.id, "title": doc.title, "period": doc.period, "filed_at": doc.filed_at, "source_url": doc.source_url}))
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
    evaluations = evaluate_conditions(row.payload, observed)
    previous_conditions = state.get("conditions", {})
    for evaluation in evaluations:
        previous = previous_conditions.get(evaluation["condition_id"])
        # A new unknown condition is coverage information, not a material alert.
        signature = lambda e: digest({**{k: e.get(k) for k in ("condition", "status", "value")},
            "evidence": evidence_fingerprint(e["evidence"]) if e.get("evidence") else None})
        if (previous is None and evaluation["status"] != "unknown") or (previous is not None and signature(previous) != signature(evaluation)):
            changes.append({"kind": "condition_changed", "condition_id": evaluation["condition_id"],
                "before": previous, "after": evaluation, "material": True, "reason": evaluation["reason"]})
    state["conditions"] = {e["condition_id"]: e for e in evaluations}
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


def save_earnings_review(db: Session, row: ResearchDossier, review: dict, expected_revision: int) -> dict:
    if expected_revision != row.revision:
        raise HTTPException(409, "Dossier changed. Reload before saving.")
    data = deepcopy(row.payload)
    reviews = data.setdefault("earnings_reviews", [])
    existing = next((item for item in reviews if item["id"] == review["id"]), None)
    if existing:
        frozen_fields = ("metric", "label", "unit", "expected", "guidance_low", "guidance_high", "guidance_source_url", "guidance_quote")
        baseline = lambda item: {key: item.get(key) for key in frozen_fields}
        if existing["period"] != review["period"] or [baseline(m) for m in existing["metrics"]] != [baseline(m) for m in review["metrics"]]:
            raise HTTPException(422, "Saved expectations and guidance are frozen. Create a new review to record a revised forecast.")
        if any(old.get("actual") is not None and new.get("actual") is None for old, new in zip(existing["metrics"], review["metrics"])):
            raise HTTPException(422, "A reported actual cannot be cleared. Save a sourced correction instead.")
        review["recorded_at"] = existing["recorded_at"]
        reviews[reviews.index(existing)] = review
    else:
        if len(reviews) >= 100:
            raise HTTPException(422, "A dossier supports at most 100 earnings reviews")
        review["recorded_at"] = now().isoformat()
        reviews.append(review)
    review["reviewed_at"] = now().isoformat() if any(m.get("actual") is not None for m in review["metrics"]) else None
    # Actuals become comparable observations while the original expectations stay frozen.
    evidence = {e["id"]: e for e in data.get("evidence", [])}
    for metric in review["metrics"]:
        if metric.get("actual") is None:
            continue
        evidence_id = f"earnings:{review['id']}:{metric['metric']}"
        if len(evidence_id) > 120:
            evidence_id = "earnings:" + digest(evidence_id)
        evidence[evidence_id] = Evidence(id=evidence_id, claim=f"{review['period']}: {metric['label']}",
            metric=metric["metric"], value=metric["actual"], unit=metric["unit"], period=review["period"],
            source_url=metric["source_url"], source_title=f"{row.symbol} {review['period']} results", quote=metric["quote"],
            published_at=metric["published_at"], observed_at=now()).model_dump(mode="json")
    data["evidence"] = list(evidence.values())
    data = DossierCreate.model_validate(data).model_dump(mode="json")
    prior_payload = row.payload
    row.payload = data
    row.revision += 1
    row.updated_at = now()
    changes = [{"kind": "earnings_review", "before": deepcopy(existing), "after": review,
        "material": bool(review["reviewed_at"]), "reason": f"{review['period']} earnings {'reviewed' if review['reviewed_at'] else 'expectations saved'}"}]
    changes.extend(refresh_conditions(row, prior_payload))
    record_revision(db, row, changes)
    notify_changes(db, row, changes)
    commit(db)
    return output(row)


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
