from __future__ import annotations

from datetime import datetime, timezone

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


def _is_too_recent(signal: AgentSignal, horizon_days: int) -> bool:
    if signal.created_at is None:
        return False
    try:
        created = datetime.fromisoformat(signal.created_at)
    except (ValueError, TypeError):
        return False
    age = datetime.now(timezone.utc) - created
    return age.days < horizon_days


async def evaluate_signals(db: Session, user_id: str, horizon_days: int = 10) -> dict:
    evaluated = 0
    skipped = 0

    signals = (
        db.query(AgentSignal)
        .filter(
            AgentSignal.user_id == user_id,
            AgentSignal.correct.is_(None),
        )
        .all()
    )

    for sig in signals:
        if _is_too_recent(sig, horizon_days):
            skipped += 1
            continue

        price_at = sig.price_at_signal
        if price_at is None or price_at == 0:
            skipped += 1
            continue

        symbol = sig.symbol
        try:
            chart_provider = await get_chart_provider()
            bars = await chart_provider.get_ohlcv(symbol, interval="1d", period="3mo")
            if not bars:
                skipped += 1
                continue
            now_price = bars[-1].close
            if now_price is None or now_price == 0:
                skipped += 1
                continue

            realized_return_pct = (now_price / price_at - 1) * 100

            signal_dir = sig.signal
            if signal_dir == "bullish":
                correct = realized_return_pct > 0
            elif signal_dir == "bearish":
                correct = realized_return_pct < 0
            else:
                correct = abs(realized_return_pct) < 2

            sig.evaluated_at = datetime.now(timezone.utc).isoformat()
            sig.horizon_days = horizon_days
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