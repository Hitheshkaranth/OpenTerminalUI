from __future__ import annotations

import ast
import asyncio
import os
from datetime import datetime, timedelta, timezone
import math
from typing import Any
from uuid import uuid4
from fastapi import HTTPException
import pandas as pd
from sqlalchemy.orm import Session
from backend.models import UserScreenORM
from backend.screener.parser import parse_query
from backend.screener.engine import _load_universe_symbols
from backend.services.materialized_store import load_screener_df
from .models import ScreenSchedule, ScreenChange, utcnow
from .schemas import ScheduleInput

# Only measurements actually stored in the snapshot are eligible. No imputed or synthetic metrics.
FIELDS = {"price": "current_price", "market_cap": "market_cap", "pe": "pe", "pb": "pb_calc", "ps": "ps_calc",
          "ev_ebitda": "ev_ebitda", "roe": "roe_pct", "roa": "roa_pct", "opm": "op_margin_pct",
          "net_margin": "net_margin_pct", "revenue_growth": "rev_growth_pct", "eps_growth": "eps_growth_pct",
          "beta": "beta", "piotroski_f_score": "piotroski_f_score", "altman_z_score": "altman_z_score"}


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def screen_owned(db: Session, user_id: str, screen_id: str):
    row = db.query(UserScreenORM).filter_by(id=screen_id, user_id=user_id).first()
    if row is None:
        raise HTTPException(404, "Saved screen not found")
    return row


def owned(db: Session, user_id: str, schedule_id: str):
    row = db.query(ScreenSchedule).filter_by(id=schedule_id, user_id=user_id).first()
    if row is None:
        raise HTTPException(404, "Screen schedule not found")
    screen_owned(db, user_id, row.screen_id)
    return row


def compile_rules(query: str):
    parsed = parse_query(query)
    if not parsed.filter_expr:
        raise ValueError("Add at least one numerical fundamental condition before scheduling.")
    tree = ast.parse(parsed.filter_expr, mode="eval")
    if not isinstance(tree.body, (ast.Compare, ast.BoolOp)):
        raise ValueError("A scheduled screen must compare an observed metric to a number.")
    allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Name, ast.Load,
               ast.Constant, ast.UnaryOp, ast.USub, ast.UAdd, ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.Eq, ast.NotEq)
    for node in ast.walk(tree):
        if not isinstance(node, allowed):
            raise ValueError("Scheduled screens support numerical comparisons joined by AND or OR.")
        if isinstance(node, ast.BoolOp) and any(not isinstance(value, (ast.Compare, ast.BoolOp)) for value in node.values):
            raise ValueError("Every AND/OR clause must be a numerical comparison.")
        if isinstance(node, ast.Name) and node.id not in FIELDS:
            raise ValueError(f"{node.id} has no supported observed snapshot field for scheduled evaluation.")
        if isinstance(node, ast.Constant) and (type(node.value) not in (float, int) or not math.isfinite(node.value)):
            raise ValueError("Scheduled comparison values must be finite numbers.")
        if isinstance(node, ast.Compare) and (not isinstance(node.left, ast.Name) or len(node.ops) != 1 or
            not isinstance(node.comparators[0], (ast.Constant, ast.UnaryOp))):
            raise ValueError("Use field-to-number comparisons for scheduled screens.")
    names = sorted({node.id for node in ast.walk(tree) if isinstance(node, ast.Name)})
    if not names:
        raise ValueError("A scheduled screen must compare an observed metric.")
    rules = [ast.unparse(node) for node in ast.walk(tree) if isinstance(node, ast.Compare)]
    return parsed, names, rules


def evaluate(query: str, symbols: list[str], frame: pd.DataFrame, max_age_hours: int, at: datetime | None = None) -> dict:
    at = at or utcnow()
    parsed, fields, rules = compile_rules(query)
    records = {str(r.get("ticker", "")).upper(): r for r in frame.to_dict("records")}
    states, missing, stale, unknown = {}, [], [], []
    for symbol in symbols:
        row = records.get(symbol)
        if row is None:
            missing.append(symbol)
            continue
        if has_synthetic_provenance(row):
            unknown.append(symbol)
            continue
        try:
            observed = aware(datetime.fromisoformat(str(row.get("updated_at")).replace("Z", "+00:00")))
            if observed > at or at - observed > timedelta(hours=max_age_hours):
                stale.append(symbol)
                continue
        except (ValueError, TypeError):
            unknown.append(symbol)
            continue
        values = {}
        for field in fields:
            value = row.get(FIELDS[field])
            try:
                number = float(value)
                if math.isfinite(number):
                    values[field] = number
            except (ValueError, TypeError):
                pass
        if len(values) != len(fields):
            unknown.append(symbol)
            continue
        matched = not pd.DataFrame([values]).query(parsed.filter_expr, engine="python").empty
        states[symbol] = {"symbol": symbol, "values": values, "matched": matched,
                          "observed_at": observed.isoformat(), "source": "Cached provider snapshot; provenance not independently verified"}
    coverage = {"requested": len(symbols), "evaluated": len(states), "missing": missing, "stale": stale, "unknown": unknown}
    return {"states": states, "matches": [s for s in states.values() if s["matched"]], "coverage": coverage,
            "rules": rules, "query": query, "checked_at": at.isoformat(),
            "policy": "Membership evaluates all conditions, ignoring display sort and LIMIT. Missing or stale observations never imply an exit."}


def preview(db: Session, user_id: str, payload: ScheduleInput):
    screen = screen_owned(db, user_id, payload.screen_id)
    symbols = _load_universe_symbols(payload.universe, payload.market)
    result = evaluate(screen.query, symbols, load_screener_df(symbols), payload.max_age_hours)
    return {**result, "name": screen.name, "universe": payload.universe, "frequency": payload.frequency,
            "delivery": "In-app research inbox", "next_run_at": utcnow().isoformat(),
            "data_policy": "Runs refresh a rotating batch of up to 60 provider snapshots by default, then evaluate the universe. Freshness is cache observation time, not filing publication time. Large universes may need several runs to refresh fully."}


def save(db: Session, user_id: str, payload: ScheduleInput):
    screen = screen_owned(db, user_id, payload.screen_id)
    compile_rules(screen.query)
    row = db.query(ScreenSchedule).filter_by(user_id=user_id, screen_id=screen.id).first()
    config = {"universe": payload.universe, "market": payload.market, "max_age_hours": payload.max_age_hours}
    if row is None:
        row = ScreenSchedule(user_id=user_id, screen_id=screen.id)
        db.add(row)
    elif row.config != config:
        row.snapshot = {}
    row.config, row.enabled, row.frequency, row.next_run_at = config, payload.enabled, payload.frequency, utcnow()
    db.commit()
    db.refresh(row)
    return output(db, row)


def output(db: Session, row: ScreenSchedule):
    screen = screen_owned(db, row.user_id, row.screen_id)
    changes = db.query(ScreenChange).filter_by(schedule_id=row.id, user_id=row.user_id).order_by(ScreenChange.observed_at.desc()).limit(200).all()
    return {"id": row.id, "screen_id": row.screen_id, "name": screen.name, "query": screen.query,
            **row.config, "enabled": row.enabled, "frequency": row.frequency,
            "next_run_at": aware(row.next_run_at).isoformat(),
            "last_run_at": aware(row.last_run_at).isoformat() if row.last_run_at else None,
            "matches": row.snapshot.get("matches", []), "coverage": row.snapshot.get("coverage"),
            "changes": [change_output(c) for c in changes], "error": row.error,
            "baseline": row.snapshot.get("baseline", False), "refresh": row.snapshot.get("refresh")}


def change_output(row: ScreenChange):
    return {"id": row.id, "schedule_id": row.schedule_id, "symbol": row.symbol, "kind": row.kind,
            "observed_at": aware(row.observed_at).isoformat(), **row.payload}


def record_run(db: Session, row: ScreenSchedule, result: dict):
    previous = row.snapshot.get("states", {}) if row.snapshot.get("query") == result["query"] else {}
    first = not previous
    run_id = str(uuid4())
    for symbol, current in result["states"].items():
        before = previous.get(symbol)
        if before is not None and before["matched"] != current["matched"]:
            changed_rules = [rule for rule in result["rules"] if
                pd.DataFrame([before["values"]]).query(rule, engine="python").empty !=
                pd.DataFrame([current["values"]]).query(rule, engine="python").empty]
            db.add(ScreenChange(user_id=row.user_id, schedule_id=row.id, symbol=symbol,
                kind="entered" if current["matched"] else "exited",
                payload={"run_id": run_id, "before": before["values"], "after": current["values"], "rules": changed_rules, "all_rules": result["rules"],
                         "source": current["source"], "data_observed_at": current["observed_at"],
                         "previous_observed_at": before["observed_at"], "query": result["query"]}))
    # Preserve last known state through an outage, but never show it as a current match.
    states = {**previous, **result["states"]}
    row.snapshot = {**result, "states": states, "baseline": first}
    row.last_run_at = utcnow()
    row.next_run_at = row.last_run_at + timedelta(days=7 if row.frequency == "weekly" else 1)
    row.lease_until = None
    row.error = None
    db.commit()
    return output(db, row)


def has_synthetic_provenance(snapshot: dict) -> bool:
    """Inspect explicit data-quality metadata, including nested provider envelopes."""
    flags = {"synthetic", "is_synthetic", "mock", "is_mock", "simulated", "is_simulated", "demo"}
    def flagged(value, key=""):
        if key.lower() in flags and (value is True or value == 1 or isinstance(value, str) and value.lower() in {"true", "1", "yes"}):
            return True
        if isinstance(value, dict):
            return any(flagged(v, str(k)) for k, v in value.items())
        if isinstance(value, list):
            return any(flagged(v) for v in value)
        return isinstance(value, str) and any(marker in value.lower() for marker in ("synthetic", "mock", "simulated"))
    return any(flagged(snapshot.get(key), key) for key in flags | {"provenance", "data_status", "source", "provider", "quality", "data_source", "data_sources", "details", "meta"})


def provenance_summary(snapshot: dict) -> dict:
    provenance = snapshot.get("provenance") if isinstance(snapshot.get("provenance"), dict) else {}
    details = snapshot.get("details") if isinstance(snapshot.get("details"), dict) else {}
    return {"source": str(provenance.get("source") or snapshot.get("source") or details.get("price_source") or "unreported")[:160],
            "quality": str(provenance.get("quality") or snapshot.get("data_status") or "unreported")[:80],
            "verification": "Provider-reported metadata only; field-level fundamental provenance is not independently verified"}


async def refresh_observations(symbols: list[str], cursor: int = 0) -> dict:
    """Refresh a bounded, rotating batch, including existing/stale snapshots.

    Direct provider fetch bypasses the coalescing cache so an old cache entry is
    not stamped as newly observed. Timed-out/failed fetches leave old timestamps.
    """
    from backend.api.deps import get_unified_fetcher
    from backend.services.materialized_store import upsert_screener_rows
    if not symbols:
        return {"attempted": 0, "refreshed": 0, "failed": [], "next_cursor": 0}
    cap = max(1, min(int(os.getenv("SCREEN_MONITOR_REFRESH_CAP", "60")), 1500))
    ordered = symbols[cursor:] + symbols[:cursor]
    selected = ordered[:cap]
    fetcher = await get_unified_fetcher()
    semaphore = asyncio.Semaphore(8)
    rejected = []
    provenance = {}
    async def fetch(symbol):
        async with semaphore:
            try:
                snap = await fetcher.fetch_stock_snapshot(symbol)
                if not isinstance(snap, dict) or not snap:
                    return None
                if has_synthetic_provenance(snap):
                    rejected.append(symbol)
                    return None
                # Finite measurements are provider-reported, not independently verified.
                fields = ["pe", "roe_pct", "roa_pct", "op_margin_pct", "net_margin_pct", "rev_growth_pct", "eps_growth_pct", "market_cap"]
                if not any(isinstance(snap.get(k), (float, int)) and math.isfinite(snap[k]) for k in fields):
                    return None
                provenance[symbol] = provenance_summary(snap)
                return {**snap, "ticker": symbol, "pb_calc": snap.get("pb"), "ps_calc": snap.get("ps")}
            except asyncio.CancelledError:
                raise
            except Exception:
                return None
    tasks = {asyncio.create_task(fetch(symbol)): symbol for symbol in selected}
    done, pending = await asyncio.wait(tasks, timeout=max(1, float(os.getenv("SCREEN_MONITOR_REFRESH_TIMEOUT", "20"))))
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    rows = [task.result() for task in done if not task.cancelled() and task.exception() is None and task.result() is not None]
    if rows:
        upsert_screener_rows(rows)
    refreshed = {r["ticker"] for r in rows}
    return {"attempted": len(selected), "refreshed": len(rows), "failed": [s for s in selected if s not in refreshed],
            "next_cursor": (cursor + len(selected)) % len(symbols), "rejected_synthetic": rejected, "provenance": provenance}


async def run(db: Session, row: ScreenSchedule):
    screen = screen_owned(db, row.user_id, row.screen_id)
    compile_rules(screen.query)
    symbols = _load_universe_symbols(row.config["universe"], row.config["market"])
    refresh = await refresh_observations(symbols, int(row.snapshot.get("refresh", {}).get("next_cursor", 0)))
    frame = load_screener_df(symbols)
    if not frame.empty and refresh.get("rejected_synthetic"):
        frame.loc[frame["ticker"].isin(refresh["rejected_synthetic"]), "data_status"] = "synthetic refresh rejected"
    result = evaluate(screen.query, symbols, frame, row.config["max_age_hours"])
    result["refresh"] = refresh
    return record_run(db, row, result)
