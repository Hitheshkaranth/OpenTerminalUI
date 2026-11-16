from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math

from sqlalchemy import Integer, func, select
from sqlalchemy.orm import Session

from backend.models.agent_signals import AgentSignal
from backend.api.deps import get_chart_provider


def store_signals(db: Session, user_id: str, run_id: str, rows: list[dict]) -> None:
    for row in rows:
        db.add(AgentSignal(
            user_id=user_id,
            run_id=run_id,
            symbol=row["symbol"],
            persona=row["persona"],
            signal=row["signal"],
            confidence=row["confidence"],
            reason=row["reason"],
            price_at_signal=row.get("price_at_signal"),
        ))
    db.commit()


def list_signals(
    db: Session,
    user_id: str,
    symbol: str | None = None,
    persona: str | None = None,
    limit: int = 100,
) -> list[dict]:
    stmt = select(AgentSignal).where(AgentSignal.user_id == user_id)
    if symbol:
        stmt = stmt.where(AgentSignal.symbol == symbol)
    if persona:
        stmt = stmt.where(AgentSignal.persona == persona)
    stmt = stmt.order_by(AgentSignal.created_at.desc()).limit(limit)
    rows = db.execute(stmt).scalars().all()
    return [
        {
            "id": r.id,
            "symbol": r.symbol,
            "persona": r.persona,
            "signal": r.signal,
            "confidence": r.confidence,
            "reason": r.reason,
            "price_at_signal": r.price_at_signal,
            "created_at": r.created_at,
            "evaluated_at": r.evaluated_at,
            "horizon_days": r.horizon_days,
            "realized_return_pct": r.realized_return_pct,
            "benchmark_return_pct": r.benchmark_return_pct,
            "correct": r.correct,
        }
        for r in rows
    ]


def persona_weights(db: Session, user_id: str) -> dict[str, float]:
    results = (
        db.query(
            AgentSignal.persona,
            func.count(AgentSignal.id).label("total"),
            func.sum(func.cast(AgentSignal.correct == True, Integer)).label("accurate"),  # noqa: E712
        )
        .filter(AgentSignal.user_id == user_id, AgentSignal.correct.isnot(None))
        .group_by(AgentSignal.persona)
        .all()
    )
    acc_map: dict[str, float | None] = {}
    for persona_name, total, accurate in results:
        if total and total > 0:
            acc_map[persona_name] = (accurate or 0) / total
    # Count total evaluations per persona
    counts = (
        db.query(AgentSignal.persona, func.count(AgentSignal.id))
        .filter(AgentSignal.user_id == user_id, AgentSignal.correct.isnot(None))
        .group_by(AgentSignal.persona)
        .all()
    )
    count_map: dict[str, int] = {p: c for p, c in counts}

    # Check if overall evaluations < 5
    total_evals = sum(count_map.values())
    if total_evals < 5:
        return {p: 0.5 for p in count_map}

    weights: dict[str, float] = {}
    for persona_name, acc in acc_map.items():
        if acc is not None:
            weights[persona_name] = max(0.25, acc)
        else:
            weights[persona_name] = 0.5
    return weights


def _utc_datetime(value: object) -> datetime:
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if not isinstance(value, datetime):
        raise ValueError("A dated timestamp is required")
    # Historical naive timestamps in this table and the chart provider represent UTC.
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _horizon(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 365:
        raise ValueError("horizon_days must be an integer from 1 to 365")
    return value


def _positive_price(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("A positive finite price is required")
    price = float(value)
    if not math.isfinite(price) or price <= 0:
        raise ValueError("A positive finite price is required")
    return price


def _is_too_recent(signal: AgentSignal, horizon_days: int) -> bool:
    """Malformed creation dates fail closed rather than becoming mature signals."""
    try:
        return _utc_datetime(signal.created_at) + timedelta(days=_horizon(horizon_days)) > datetime.now(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return True


async def evaluate_signals(db: Session, user_id: str, horizon_days: int = 10) -> dict:
    """Settle against the first completed daily session at the stated horizon.

    Horizons are calendar days in UTC. Allow up to seven subsequent calendar
    days for weekends/holidays; never substitute a recent quote for a missing
    historical observation. Current UTC-day bars are conservatively excluded
    because this provider does not expose exchange session completion flags.
    """
    _horizon(horizon_days)
    evaluated = 0
    skipped = 0
    now = datetime.now(timezone.utc)
    completed_before = now.replace(hour=0, minute=0, second=0, microsecond=0)

    signals = (
        db.query(AgentSignal)
        .filter(
            AgentSignal.user_id == user_id,
            AgentSignal.correct.is_(None),
        )
        .all()
    )

    for sig in signals:
        try:
            horizon = _horizon(sig.horizon_days if sig.horizon_days is not None else horizon_days)
            target = _utc_datetime(sig.created_at) + timedelta(days=horizon)
            if target > now:
                skipped += 1
                continue
            start = target.replace(hour=0, minute=0, second=0, microsecond=0)
            end = min(start + timedelta(days=8), completed_before)
            if end <= start:
                skipped += 1
                continue
            price_at = _positive_price(sig.price_at_signal)
            chart_provider = await get_chart_provider()
            bars = await chart_provider.get_ohlcv(sig.symbol, interval="1d", start=start, end=end)
            candidates = []
            for bar in bars or []:
                try:
                    timestamp = _utc_datetime(bar.timestamp)
                    if start <= timestamp < end:
                        candidates.append((timestamp, bar))
                except (ValueError, TypeError, AttributeError, OverflowError):
                    continue
            if not candidates:
                skipped += 1
                continue
            # Invalid prices at the target observation must not silently move
            # settlement to a later, more favorable trading day.
            candidates.sort(key=lambda item: item[0])
            now_price = _positive_price(candidates[0][1].close)
            first_timestamp = candidates[0][0]
            for timestamp, duplicate in candidates[1:]:
                if timestamp != first_timestamp:
                    break
                if _positive_price(duplicate.close) != now_price:
                    raise ValueError("Conflicting closes for the horizon observation")
            realized_return_pct = (now_price / price_at - 1) * 100
            if not math.isfinite(realized_return_pct):
                raise ValueError("Realized return is not finite")

            signal_dir = sig.signal
            if signal_dir == "bullish":
                correct = realized_return_pct > 0
            elif signal_dir == "bearish":
                correct = realized_return_pct < 0
            else:
                correct = abs(realized_return_pct) < 2

            sig.evaluated_at = now.isoformat()
            sig.horizon_days = horizon
            sig.realized_return_pct = round(realized_return_pct, 4)
            sig.correct = correct
            evaluated += 1
        except Exception:
            skipped += 1
            continue

    db.commit()
    return {"evaluated": evaluated, "skipped": skipped}


def scorecard(db: Session, user_id: str) -> dict:
    signals = (
        db.query(AgentSignal)
        .filter(AgentSignal.user_id == user_id, AgentSignal.correct.isnot(None))
        .all()
    )

    persona_stats: dict[str, dict] = {}
    for sig in signals:
        if sig.correct is None:
            continue
        p = sig.persona
        if p not in persona_stats:
            persona_stats[p] = {"evaluated": 0, "accurate": 0, "return_sum": 0.0}
        persona_stats[p]["evaluated"] += 1
        if sig.correct:
            persona_stats[p]["accurate"] += 1
        if sig.realized_return_pct is not None:
            persona_stats[p]["return_sum"] += sig.realized_return_pct

    # Always list every persona so the UI can render the strip before any evaluation.
    from backend.agent.ensemble.personas import PERSONAS

    labels = {pp.id: pp.label for pp in PERSONAS}
    for pid in labels:
        persona_stats.setdefault(pid, {"evaluated": 0, "accurate": 0, "return_sum": 0.0})

    personas_out: list[dict] = []
    for p, stats in persona_stats.items():
        acc = round(stats["accurate"] / stats["evaluated"], 4) if stats["evaluated"] > 0 else None
        avg_ret = round(stats["return_sum"] / stats["evaluated"], 4) if stats["evaluated"] > 0 else None
        personas_out.append({
            "id": p,
            "label": labels.get(p, p),
            "evaluated": stats["evaluated"],
            "accuracy": acc,
            "avg_return_pct": avg_ret,
        })

    return {
        "personas": personas_out,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
