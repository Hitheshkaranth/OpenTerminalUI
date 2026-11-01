from __future__ import annotations
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from backend.research_dossiers.models import ResearchDossier, DossierRevision
from backend.research_inbox.models import ResearchReviewState


def utc(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def iso(value):
    return utc(value).isoformat() if utc(value) else None


def events(db: Session, user_id: str):
    """Read immutable change records; viewing the inbox never changes a thesis."""
    dossiers = db.query(ResearchDossier).filter_by(user_id=user_id).all()
    by_id = {d.id: d for d in dossiers}
    items = []
    revisions = db.query(DossierRevision).filter(DossierRevision.dossier_id.in_(by_id)).order_by(DossierRevision.created_at.desc()).all() if by_id else []
    for rev in revisions:
        changes = [c for c in rev.changes if c.get("material") and c.get("kind") in {"condition_changed", "evidence_added", "evidence_changed", "earnings_review"}]
        if not changes:
            continue
        d = by_id[rev.dossier_id]
        breached = any((c.get("after") or {}).get("status") == "breached" for c in changes)
        items.append({"id": f"dossier:{d.id}:{rev.revision}", "kind": "thesis" if any(c.get("kind") == "condition_changed" for c in changes) else "earnings" if any(c.get("kind") == "earnings_review" for c in changes) else "filing",
                      "symbol": d.symbol, "title": f"{d.symbol}: {len(changes)} research {'change' if len(changes) == 1 else 'changes'}",
                      "reason": changes[0].get("reason", "New evidence requires review"), "priority": "high" if breached else "normal",
                      "occurred_at": iso(rev.created_at), "source_url": f"/equity/research-dossiers?id={d.id}",
                      "dossier_id": d.id, "changes": changes, "upcoming": False})
    for d in dossiers:
        for review in d.payload.get("earnings_reviews", []):
            due = review.get("expected_report_date")
            if due and not review.get("reviewed_at"):
                items.append({"id": f"earnings:{d.id}:{review['id']}", "kind": "earnings", "symbol": d.symbol,
                              "title": f"{d.symbol}: {review.get('period', '')} earnings review", "reason": "Review your saved expectations against reported results",
                              "priority": "normal", "occurred_at": iso(due), "source_url": f"/equity/research-dossiers?id={d.id}",
                              "dossier_id": d.id, "changes": [], "upcoming": True})
    # Screen changes are independent immutable observations, owned by the same account.
    from backend.screen_monitoring.models import ScreenSchedule, ScreenChange
    schedules = db.query(ScreenSchedule).filter_by(user_id=user_id).all()
    from backend.models.core import UserScreenORM
    owned_screens = {s.id: s for s in db.query(UserScreenORM).filter_by(user_id=user_id).all()}
    schedules = [s for s in schedules if s.screen_id in owned_screens]
    schedule_map = {s.id: s for s in schedules}
    grouped = {}
    for change in db.query(ScreenChange).filter_by(user_id=user_id).order_by(ScreenChange.observed_at).all():
        schedule = schedule_map.get(change.schedule_id)
        if not schedule:
            continue
        event = screen_event(change, owned_screens[schedule.screen_id])
        run_id = (change.payload or {}).get("run_id")
        if not run_id:
            items.append(event)  # Keep pre-upgrade event identities and review state.
            continue
        key = f"screen-run:{schedule.id}:{run_id}"
        if key not in grouped:
            grouped[key] = {**event, "id": key, "symbols": [], "changes": [], "screen_name": owned_screens[schedule.screen_id].name}
        grouped[key]["symbols"].append(change.symbol)
        grouped[key]["changes"].extend(event["changes"])
    for event in grouped.values():
        symbols = list(dict.fromkeys(event.pop("symbols")))
        screen_name = event.pop("screen_name")
        entered = sum(c["kind"] == "entered" for c in event["changes"])
        exited = len(event["changes"]) - entered
        event["symbol"] = ", ".join(symbols[:3]) + (f" +{len(symbols)-3}" if len(symbols) > 3 else "")
        event["title"] = f"{screen_name}: {entered} entered, {exited} exited"
        event["reason"] = f"Review {len(symbols)} membership changes from the same screen check."
        items.append(event)
    states = {s.event_id: s for s in db.query(ResearchReviewState).filter_by(user_id=user_id).all()}
    now = datetime.now(timezone.utc)
    for item in items:
        state = states.get(item["id"])
        status = state.status if state else "needs_review"
        until = utc(state.snoozed_until) if state else None
        if status == "snoozed" and (until is None or until <= now):
            status = "needs_review"
        item["status"] = status
        item["snoozed_until"] = iso(until)
        item["bucket"] = "reviewed" if status == "reviewed" else "upcoming" if status == "snoozed" or (item["upcoming"] and (utc(item["occurred_at"]) or now) > now) else "needs_review"
    items.sort(key=lambda i: (i["priority"] == "high", i["occurred_at"] or ""), reverse=True)
    enabled = [d for d in dossiers if d.payload.get("monitoring_enabled")]
    checked = [d for d in enabled if d.monitor_state.get("last_checked_at")]
    recent = [d for d in checked if now - timedelta(minutes=30) <= utc(d.monitor_state["last_checked_at"]) <= now]
    active_schedules = [s for s in schedules if s.enabled]
    checked_schedules = [s for s in schedules if s.last_run_at]
    partial_schedules = [s for s in checked_schedules if s.snapshot.get("coverage", {}).get("evaluated", 0) < s.snapshot.get("coverage", {}).get("requested", 0)]
    return {"items": items, "coverage": {"dossiers": len(dossiers), "enabled": len(enabled), "checked": len(checked),
            "recently_checked": len(recent), "check_freshness_minutes": 30,
            "awaiting_check": len(enabled) - len(checked), "disabled": len(dossiers) - len(enabled),
            "last_checked_at": max((d.monitor_state["last_checked_at"] for d in checked), default=None),
            "scope": "Checks use saved observations and ingested filings. Source fetching runs only for dossiers where you explicitly enable it; source coverage is separate from condition evaluation.",
            "source_fetch_enabled": sum(bool(d.payload.get("source_fetch_enabled")) for d in dossiers),
            "source_fetch_issues": [{"dossier_id": d.id, "symbol": d.symbol, **d.monitor_state.get("source_fetch", {})} for d in dossiers if d.payload.get("source_fetch_enabled") and d.monitor_state.get("source_fetch", {}).get("status") not in {"checked"}],
            "screen_schedules": len(schedules), "screen_enabled": len(active_schedules),
            "screen_checked": len(checked_schedules),
            "screen_awaiting_check": sum(not s.last_run_at for s in active_schedules),
            "screen_failed": sum(bool(s.error) for s in schedules),
            "screen_partial": len(partial_schedules),
            "screen_overdue": sum(utc(s.next_run_at) < now - timedelta(minutes=15) for s in active_schedules),
            "screen_evaluated": sum(s.snapshot.get("coverage", {}).get("evaluated", 0) for s in checked_schedules),
            "screen_requested": sum(s.snapshot.get("coverage", {}).get("requested", 0) for s in checked_schedules)},
            "counts": {b: sum(i["bucket"] == b for i in items) for b in ("needs_review", "upcoming", "reviewed")}}



def screen_event(change, screen):
    from urllib.parse import quote
    data = change.payload or {}
    return {"id": f"screen:{change.id}", "kind": "screen", "symbol": change.symbol,
            "title": f"{change.symbol} {change.kind} {screen.name}",
            "reason": "; ".join(data.get("rules", [])) or "Review the values behind this membership change",
            "priority": "normal", "occurred_at": iso(change.observed_at),
            "source_url": f"/equity/screener?screen={quote(screen.id)}", "changes": [{**data, "kind": change.kind, "symbol": change.symbol}], "upcoming": False}
