from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.models.journal import JournalEntry
from backend.models.agent_memory import AgentNote
from backend.shared.market_classifier import market_classifier

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a trading coach. Given the facts of a completed trade, write ONE "
    "paragraph (at most 80 words) explaining what this trade teaches. "
    "Be direct, specific, and actionable. Do not exceed 80 words."
)


async def run_reflections(db: Session, user_id: str, provider: Any) -> dict:  # noqa: F821
    """Process closed journal entries and generate reflection notes.

    Returns {"created": n, "skipped": m}. Never raises on a single failure.
    """
    # Find closed journal entries that don't already have a reflection
    closed = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.user_id == user_id,
            JournalEntry.exit_price.isnot(None),
            JournalEntry.exit_date.isnot(None),
        )
        .all()
    )

    # Collect existing reflection content prefixes to detect duplicates
    existing = (
        db.query(AgentNote.content)
        .filter(
            AgentNote.user_id == user_id,
            AgentNote.kind == "reflection",
            AgentNote.content.startswith("[journal:"),
        )
        .all()
    )
    existing_prefixes = {row[0] for row in existing if row[0]}

    created = 0
    skipped = 0

    for entry in closed:
        prefix = f"[journal:{entry.id}] "
        if any(content.startswith(prefix) for content in existing_prefixes):
            skipped += 1
            continue

        try:
            prefix = f"[journal:{entry.id}] "
            result = await _reflect_one(db, user_id, entry, provider, prefix)
            if result:
                created += 1
                skipped += 0
            else:
                skipped += 1
        except Exception as exc:
            logger.warning("Reflection failed for entry %s: %s", entry.id, exc)
            skipped += 1

    return {"created": created, "skipped": skipped}


async def _reflect_one(db: Session, user_id: str, entry: JournalEntry, provider: Any, prefix: str) -> bool:  # noqa: F821
    entry_price = float(entry.entry_price or 0)
    exit_price = float(entry.exit_price or 0)
    direction = str(entry.direction or "long")

    if direction.lower() != "short":
        realized_pct = (exit_price - entry_price) / entry_price * 100 if entry_price else 0
    else:
        realized_pct = (entry_price - exit_price) / entry_price * 100 if entry_price else 0

    benchmark = None
    benchmark_ret = None
    try:
        sym = str(entry.symbol or "").strip().upper()
        cls_result = await market_classifier.classify(sym)
        bench_symbol = "^NSEI" if cls_result.country_code == "IN" else "SPY"

        from backend.providers.chart_data import get_chart_data_provider
        chart = await get_chart_data_provider()
        bars = await chart.get_ohlcv(
            bench_symbol, interval="1d",
            start=entry.entry_date if isinstance(entry.entry_date, datetime) else None,
            end=entry.exit_date if isinstance(entry.exit_date, datetime) else None,
        )
        if len(bars) >= 2:
            first_close = bars[0].close
            last_close = bars[-1].close
            if first_close > 0:
                benchmark_ret = (last_close - first_close) / first_close * 100
    except Exception:
        benchmark_ret = None

    facts = (
        f"Symbol: {entry.symbol}\n"
        f"Direction: {direction}\n"
        f"Entry: {entry_price}, Exit: {exit_price}\n"
        f"Realized P&L: {realized_pct:.2f}%\n"
    )
    if benchmark_ret is not None:
        facts += f"Benchmark return: {benchmark_ret:.2f}%\n"
    if entry.notes:
        facts += f"Notes: {entry.notes}\n"
    if entry.strategy:
        facts += f"Strategy: {entry.strategy}\n"
    if entry.pnl is not None:
        facts += f"P&L (from journal): {entry.pnl}\n"

    user_prompt = facts

    from backend.services.llm.base import LLMMessage, AssistantMessage
    messages = [
        LLMMessage(role="system", content=_SYSTEM_PROMPT),
        LLMMessage(role="user", content=user_prompt),
    ]

    try:
        response = await provider.complete(messages, max_tokens=256)
        reflection_text = (response.content or "").strip()
    except Exception:
        reflection_text = "Could not generate reflection."

    content = prefix + reflection_text
    note = AgentNote(
        user_id=user_id,
        symbol=str(entry.symbol or "").upper() if entry.symbol else None,
        kind="reflection",
        content=content,
        source="reflection",
    )
    db.add(note)
    db.flush()
    return True