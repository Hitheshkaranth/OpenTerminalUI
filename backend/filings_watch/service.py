from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from backend.filings_rag.models import FilingAnalysisORM, FilingKnowledgeORM
from backend.filings_watch.models import FilingsWatchEventORM, FilingsWatchSettingsORM

logger = logging.getLogger(__name__)

ENV_ENABLED_KEY = "FILINGS_WATCH_ENABLED"

NEW_DOCUMENT = "new_document"
ADVERSE_REGULATORY = "adverse_regulatory"
GUIDANCE_CUT = "guidance_cut"
STANCE_CHANGE = "stance_change"
ALL_KINDS = (NEW_DOCUMENT, ADVERSE_REGULATORY, GUIDANCE_CUT, STANCE_CHANGE)

_HIGH_PRIORITY_KINDS = {ADVERSE_REGULATORY, GUIDANCE_CUT}
_DEFAULT_NOTIFY_ON = [NEW_DOCUMENT, ADVERSE_REGULATORY, GUIDANCE_CUT, STANCE_CHANGE]

_event_semaphore = asyncio.Semaphore(2)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def enabled_by_env() -> bool:
    """The whole feature is inert unless FILINGS_WATCH_ENABLED != '0'."""
    return os.environ.get(ENV_ENABLED_KEY, "1").strip() != "0"


def clamp_hour(value: Any) -> int:
    try:
        hour = int(value)
    except (TypeError, ValueError):
        return 13
    return ((hour % 24) + 24) % 24


def clamp_limit(value: Any) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return 5
    return max(1, min(10, limit))


def normalise_settings(raw: dict | None) -> dict[str, Any]:
    """Shape an arbitrary stored payload into the documented settings object."""
    raw = raw or {}
    notify = [k for k in (raw.get("notify_on") or []) if k in ALL_KINDS]
    return {
        "enabled": bool(raw.get("enabled", False)),
        "symbols_source": "custom" if str(raw.get("symbols_source") or "") == "custom" else "watchlists",
        "custom_symbols": [str(s).strip().upper() for s in (raw.get("custom_symbols") or []) if str(s).strip()],
        "run_hour_utc": clamp_hour(raw.get("run_hour_utc")),
        "notify_on": notify or list(_DEFAULT_NOTIFY_ON),
        "sources": [str(s).strip().lower() for s in (raw.get("sources") or ["sec", "nse"]) if str(s).strip()],
        "import_limit": clamp_limit(raw.get("import_limit")),
    }


def settings_enabled(raw: dict | None) -> bool:
    return bool((raw or {}).get("enabled", False))


def action_url_for(symbol: str) -> str:
    return f"/equity/security/{symbol.strip().upper()}?tab=filings"


# --------------------------------------------------------------------------- #
# Symbol collection
# --------------------------------------------------------------------------- #
def collect_symbols(db: Session, user_id: str, settings: dict[str, Any]) -> list[str]:
    if settings.get("symbols_source") == "custom":
        return sorted({s for s in (settings.get("custom_symbols") or []) if s})

    from backend.db.models import WatchlistORM

    symbols: set[str] = set()
    watchlists = db.query(WatchlistORM).filter(WatchlistORM.user_id == user_id).all()
    for wl in watchlists:
        for ticker in (wl.symbols_json or []):
            upper = str(ticker).strip().upper()
            if upper:
                symbols.add(upper)
    return sorted(symbols)


# --------------------------------------------------------------------------- #
# Import (agent A's fetch route path) + store
# --------------------------------------------------------------------------- #
async def _load_import_candidates(db: Session, symbol: str, sources: list[str], limit: int) -> list[dict]:
    """Return the import candidates the POST /documents/fetch route uses.

    Prefers a unified ``sources.fetch_documents`` helper; otherwise falls back to
    the per-source collectors (``sec_documents`` / ``nse_documents``) the route
    itself dispatches on.
    """
    from backend.filings_rag import sources

    fetch = getattr(sources, "fetch_documents", None)
    if callable(fetch):
        try:
            result = fetch(db, symbol=symbol, sources=sources, limit=limit)
        except Exception as exc:  # noqa: BLE001
            logger.warning("filings-watch: fetch_documents failed for %s: %s", symbol, exc)
            return []
        if isinstance(result, dict):
            result = result.get("imported", [])
        return result or []

    candidates: list[dict] = []
    selected = [s for s in sources if s in ("sec", "nse")] or ["sec", "nse"]
    for kind in selected:
        fn = getattr(sources, f"{kind}_documents", None)
        if not callable(fn):
            continue
        try:
            items = fn(db, symbol, limit=limit) or []
        except Exception as exc:  # noqa: BLE001
            logger.warning("filings-watch: %s_documents failed for %s: %s", kind, symbol, exc)
            continue
        candidates.extend(items or [])
    return candidates


def _decode_candidate(data: bytes, content_type: str | None) -> str:
    ct = str(content_type or "").lower()
    if ct.startswith("text/") or {"json", "html", "xml"} & {c.strip() for c in ct.split("/")}:
        return bytes(data).decode("utf-8", errors="replace")
    try:
        from backend.filings_rag import parse

        return parse.extract_text(bytes(data), content_type=ct)
    except Exception:  # noqa: BLE001
        return ""


def _candidate_to_pages(candidate: dict) -> list[str] | None:
    pages = candidate.get("pages")
    if isinstance(pages, list) and any(str(p).strip() for p in pages):
        return [str(p) for p in pages if str(p).strip()]
    data = candidate.get("data")
    if isinstance(data, (bytes, bytearray)) and data:
        text = _decode_candidate(data, candidate.get("content_type"))
        if text.strip():
            return [text]
    return None


async def _import_symbol(db: Session, symbol: str, sources: list[str], limit: int) -> list[dict]:
    async with _event_semaphore:
        candidates = await _load_import_candidates(db, symbol, sources, limit)

    stored: list[dict] = []
    seen_ids: set[int] = set()
    from backend.filings_rag import store

    for candidate in candidates:
        pages = _candidate_to_pages(candidate)
        if pages is None:
            continue
        title = str(candidate.get("title") or "").strip() or "(untitled filing)"
        try:
            doc = store.add_document(
                db,
                symbol=symbol,
                market=str(candidate.get("market", "") or ""),
                doc_type=str(candidate.get("doc_type", "other") or "other"),
                title=title[:300],
                period=candidate.get("period"),
                source=str(candidate.get("source", "upload") or "upload"),
                source_url=candidate.get("source_url"),
                filed_at=candidate.get("filed_at"),
                pages=pages,
            )
        except ValueError:
            db.rollback()
            continue
        doc_id = doc.get("id")
        if doc_id is not None and doc_id in seen_ids:
            continue
        seen_ids.add(doc_id)
        stored.append(doc)
    return stored


# --------------------------------------------------------------------------- #
# Analysis + knowledge comparison
# --------------------------------------------------------------------------- #
async def _safe_analyze(db: Session, symbol: str) -> dict | None:
    try:
        from backend.filings_rag.analyze import analyze

        return await analyze(db, symbol, use_llm=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("filings-watch: analyze failed for %s: %s", symbol, exc)
        return None


def _is_regulatory_driver(driver: dict) -> bool:
    did = str(driver.get("id") or "").lower()
    label = str(driver.get("label") or "").lower()
    return any(hint in did or hint in label for hint in ("regulatory", "adverse regulatory"))


def _driver_findings(analysis: dict | None, driver_id: str) -> set[str]:
    if not analysis:
        return set()
    for driver in analysis.get("headwinds") or []:
        if str(driver.get("id") or "") == driver_id:
            return {str(f.get("claim", "")).strip() for f in (driver.get("findings") or []) if str(f.get("claim", "")).strip()}
    return set()


def _latest_analysis(db: Session, symbol: str) -> dict | None:
    row = db.query(FilingAnalysisORM).filter(FilingAnalysisORM.symbol == symbol.strip().upper()).order_by(FilingAnalysisORM.created_at.desc(), FilingAnalysisORM.id.desc()).first()
    return row.payload if row and row.payload else None


def _latest_two_knowledge(db: Session, symbol: str) -> tuple[dict | None, dict | None]:
    """(current, previous) knowledge payloads, newest first.

    Replaces a helper that returned a payload dict and then took that dict back as an ORM
    row (``older_than.created_at``), which crashed whenever two snapshots existed.
    """
    rows = (
        db.query(FilingKnowledgeORM)
        .filter(FilingKnowledgeORM.symbol == symbol.strip().upper())
        .order_by(FilingKnowledgeORM.created_at.desc(), FilingKnowledgeORM.id.desc())
        .limit(2)
        .all()
    )
    payloads = [r.payload if r.payload else None for r in rows] + [None, None]
    return payloads[0], payloads[1]


def _guidance_status(knowledge: dict | None) -> dict[str, str]:
    if not knowledge:
        return {}
    out: dict[str, str] = {}
    for item in knowledge.get("guidance") or []:
        if isinstance(item, dict):
            metric = str(item.get("metric", "").strip())
            if metric:
                out[metric] = str(item.get("status", "").strip())
    return out


def _guidance_detail(item: Any) -> str | None:
    if not isinstance(item, dict):
        return None
    metric = str(item.get("metric", "").strip())
    statement = str(item.get("statement", "").strip())
    target = item.get("target")
    parts = [p for p in (metric, statement, f"target {target}" if target else None) if p]
    return " · ".join(parts) or None


def _base_event(user_id: str, symbol: str, kind: str, title: str, detail: str | None) -> dict[str, Any]:
    return {
        "user_id": str(user_id or "1"),
        "symbol": symbol,
        "kind": kind,
        "title": (title or "")[:300],
        "detail": (detail or None),
        "action_url": action_url_for(symbol),
        "at": _now(),
    }


async def _symbol_events(
    db: Session,
    user_id: str,
    symbol: str,
    imported: list[dict],
    settings: dict[str, Any],
) -> list[dict]:
    notify_on = set(settings.get("notify_on") or _DEFAULT_NOTIFY_ON)
    events: list[dict] = []

    for doc in imported:
        if NEW_DOCUMENT not in notify_on:
            continue
        title = str(doc.get("title") or "").strip() or "(untitled filing)"
        doc_type = str(doc.get("doc_type") or "").strip()
        period = str(doc.get("period") or "").strip()
        detail = " · ".join(p for p in (doc_type, period) if p)
        events.append(_base_event(user_id, symbol, NEW_DOCUMENT, f"New filing: {title}", detail or None))

    if not imported:
        return events

    # Read the previous analysis BEFORE re-analysing: analyze() persists its result, so reading
    # "latest" afterwards returned the new analysis itself and no change could ever be detected.
    prev_analysis = _latest_analysis(db, symbol)
    new_analysis = await _safe_analyze(db, symbol)
    if new_analysis is None:
        return events

    if GUIDANCE_CUT in notify_on:
        # New transcripts/results only show up in guidance after the knowledge base is rebuilt.
        try:
            from backend.filings_rag.knowledge import build_knowledge

            await build_knowledge(db, symbol, use_llm=True)
        except Exception:  # noqa: BLE001 - guidance alerts are best effort
            logger.warning("filings-watch: knowledge rebuild failed for %s", symbol, exc_info=True)

    if STANCE_CHANGE in notify_on:
        new_stance = str(new_analysis.get("stance") or "")
        prev_stance = str(prev_analysis.get("stance") or "") if prev_analysis else ""
        if prev_analysis and new_stance and new_stance != prev_stance:
            scores = new_analysis.get("scores") or {}
            detail = " · ".join(
                f"{label} {scores.get(label)}"
                for label in ("net", "growth", "headwind")
                if scores.get(label) is not None
            )
            events.append(
                _base_event(
                    user_id,
                    symbol,
                    STANCE_CHANGE,
                    f"{symbol}: stance {prev_stance} → {new_stance}",
                    detail,
                )
            )

    if ADVERSE_REGULATORY in notify_on:
        prev_findings = {
            driver_id: _driver_findings(prev_analysis, driver_id)
            for driver_id in _regulatory_driver_ids(new_analysis)
        }
        for driver in new_analysis.get("headwinds") or []:
            if not _is_regulatory_driver(driver):
                continue
            driver_id = str(driver.get("id") or "")
            current = _driver_findings(new_analysis, driver_id)
            if current == prev_findings.get(driver_id, set()):
                continue
            claims = current - prev_findings.get(driver_id, set())
            sample = next(
                (
                    f.get("claim")
                    for f in (driver.get("findings") or [])
                    if str(f.get("claim", "")).strip() in set(claims)
                ),
                driver.get("summary"),
            )
            events.append(
                _base_event(
                    user_id,
                    symbol,
                    ADVERSE_REGULATORY,
                    f"{symbol}: adverse regulatory action ({driver.get('label') or driver_id})",
                    str(sample).strip() if isinstance(sample, str) and sample.strip() else (driver.get("summary") or None),
                )
            )

    if GUIDANCE_CUT in notify_on:
        current, older = _latest_two_knowledge(db, symbol)
        current_status = _guidance_status(current)
        prev_status = _guidance_status(older)
        for metric, status_ in current_status.items():
            if status_ != "lowered" or prev_status.get(metric) == "lowered":
                continue
            item = next(
                (
                    g
                    for g in (current.get("guidance") or [])
                    if isinstance(g, dict) and str(g.get("metric", "")).strip() == metric and g.get("status") == "lowered"
                ),
                None,
            )
            events.append(
                _base_event(
                    user_id,
                    symbol,
                    GUIDANCE_CUT,
                    f"{symbol}: guidance cut ({metric})",
                    _guidance_detail(item),
                )
            )

    return [e for e in events if e["kind"] in notify_on]


def _regulatory_driver_ids(analysis: dict) -> list[str]:
    return [str(d.get("id") or "") for d in (analysis.get("headwinds") or []) if _is_regulatory_driver(d)]


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #
def _publish_event(db: Session, event: dict[str, Any]) -> None:
    db.add(
        FilingsWatchEventORM(
            user_id=str(event["user_id"]),
            symbol=str(event["symbol"]),
            kind=event["kind"],
            title=event["title"][:300],
            detail=event["detail"],
            action_url=event["action_url"],
            at=event["at"],
        )
    )
    try:
        from backend.models.notification import Notification

        db.add(
            Notification(
                user_id=str(event["user_id"]),
                type="filings",
                priority="high" if event["kind"] in _HIGH_PRIORITY_KINDS else "medium",
                title=event["title"][:200],
                body=event["detail"],
                ticker=str(event["symbol"]).upper() or None,
                action_url=event["action_url"],
                read=0,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("filings-watch: failed to persist event for %s %s", event["symbol"], event["kind"], exc_info=True)


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #
async def run_once(db: Session) -> list[dict]:
    """Run one scheduled pass over every enabled watchlist and return the events.

    Returns an empty list without doing anything when FILINGS_WATCH_ENABLED == '0'.
    """
    if not enabled_by_env():
        logger.info("filings-watch: disabled via env; skipping run")
        return []

    events_out: list[dict] = []
    for row in db.query(FilingsWatchSettingsORM).all():
        if not settings_enabled(row.settings):
            continue
        user_id = str(row.user_id or "1")
        settings = normalise_settings(row.settings)
        symbols = collect_symbols(db, user_id, settings)
        if not symbols:
            continue

        for symbol in symbols:
            imported = await _import_symbol(db, symbol, settings.get("sources") or ["sec", "nse"], settings.get("import_limit", 5))
            symbol_events = await _symbol_events(db, user_id, symbol, imported, settings)
            for event in symbol_events:
                _publish_event(db, event)
                events_out.append(
                    {k: event[k] for k in ("at", "symbol", "kind", "title", "detail", "action_url")}
                )
    return events_out


async def _run_with_session() -> list[dict]:
    from backend.shared.db import SessionLocal

    db = SessionLocal()
    try:
        return await run_once(db)
    finally:
        db.close()


async def trigger_run() -> Any:
    """Schedule a background run. Returns the task, or None when disabled."""
    if not enabled_by_env():
        logger.info("filings-watch: disabled via env; ignoring run request")
        return None
    try:
        return asyncio.ensure_future(_run_with_session())
    except Exception:
        logger.warning("filings-watch: failed to schedule run", exc_info=True)
        return None


def effective_run_hour() -> int:
    from backend.shared.db import SessionLocal

    try:
        db = SessionLocal()
        try:
            row = db.query(FilingsWatchSettingsORM).first()
            return clamp_hour(row.settings.get("run_hour_utc")) if row else 13
        finally:
            db.close()
    except Exception:
        return 13