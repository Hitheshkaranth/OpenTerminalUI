"""Opt-in dossier ingestion through the existing SEC/NSE filings-watch collectors."""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import asyncio
from backend.filings_watch import service as watch
from backend.filings_rag import store
from backend.research_dossiers.conditions import date_key


async def fetch_sources(db, row, *, force=False):
    if not row.payload.get("source_fetch_enabled"):
        return None
    state = deepcopy(row.monitor_state or {})
    previous = state.get("source_fetch", {})
    attempted = date_key(previous.get("attempted_at"))
    current_time = datetime.now(timezone.utc)
    if not force and attempted and current_time - attempted < timedelta(hours=24):
        return previous
    result = {"attempted_at": current_time.isoformat(), "imported": 0, "duplicates": 0,
              "source": "nse" if row.payload.get("market") == "IN" else "sec"}
    if not watch.enabled_by_env():
        result.update(status="disabled", message="Source fetching is disabled by the server. Saved filings are still evaluated.")
    else:
        try:
            # Avoid rewriting symbol identity in the filing index; the selected market determines the collector.
            candidates = await asyncio.wait_for(watch._load_import_candidates(db, row.symbol, [result["source"]], 5), timeout=90)
            failed = 0
            for candidate in candidates:
                try:
                    pages = watch._candidate_to_pages(candidate)
                    if not pages:
                        failed += 1
                        continue
                    store.add_document(db, symbol=row.symbol, market=row.payload.get("market") or candidate.get("market", ""),
                        doc_type=candidate.get("doc_type", "other"), title=str(candidate.get("title") or "Filing")[:300],
                        period=candidate.get("period"), source=candidate.get("source", result["source"]),
                        source_url=candidate.get("source_url"), filed_at=candidate.get("filed_at"), pages=pages)
                    result["imported"] += 1
                except ValueError as exc:
                    if str(exc).lower() == "duplicate":
                        result["duplicates"] += 1
                    else:
                        failed += 1
            result.update(status="partial" if failed else "checked" if candidates else "unconfirmed",
                message=f"Imported {result['imported']} filings; {result['duplicates']} already stored; {failed} unreadable." if candidates else "No documents returned. The provider may have no filings or be unavailable; coverage is unconfirmed.")
        except Exception:
            db.rollback()
            db.refresh(row)
            result.update(status="failed", message="Source fetch failed. Saved filings remain available; retry the source check.")
    # Collectors persist individual documents; retain the latest monitor state after those commits.
    state = deepcopy(row.monitor_state or {})
    state["source_fetch"] = result
    row.monitor_state = state
    db.commit()
    return result
