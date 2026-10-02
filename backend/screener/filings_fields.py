from __future__ import annotations

from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from backend.business_metrics.models import BusinessMetricORM
from backend.filings_rag.models import FilingAnalysisORM

# New screener fields sourced from filings intelligence (see .swarm/fi_v1/CONTRACT.md).
# Each key is the DataFrame column merged into a screen run by backend/screener/engine.py.
FILINGS_CATEGORY = "Filings Intelligence"

GROWTH_SCORE = "filings_growth_score"
HEADWIND_SCORE = "filings_headwind_score"
NET_SCORE = "filings_net_score"
STANCE = "filings_stance"
ADVERSE_FLAG = "adverse_regulatory_flag"
ORDER_BOOK = "order_book_value"
IMPLIED_GROWTH = "implied_growth_pct"

NUMERIC_KEYS = (
    GROWTH_SCORE,
    HEADWIND_SCORE,
    NET_SCORE,
    ADVERSE_FLAG,
    ORDER_BOOK,
    IMPLIED_GROWTH,
)
STRING_KEYS = (STANCE,)
ALL_KEYS = NUMERIC_KEYS + STRING_KEYS


def _to_number(value: Any) -> float | None:
    """Coerce a payload value to a float, or None when it is missing/blank.

    Never returns a sentinel 0 — a genuinely absent score stays None so the
    screener can exclude (not match) symbols without filings analysis.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        num = float(value)
        return None if num != num else num
    if isinstance(value, str):
        text_value = value.strip()
        if not text_value:
            return None
        try:
            num = float(text_value)
        except ValueError:
            return None
        return None if num != num else num
    return None


def _scores(payload: dict) -> dict[str, float | None]:
    scores = payload.get("scores")
    if not isinstance(scores, dict):
        scores = {}
    return {
        GROWTH_SCORE: _to_number(scores.get("growth")),
        HEADWIND_SCORE: _to_number(scores.get("headwind")),
        NET_SCORE: _to_number(scores.get("net")),
    }


def _stance(payload: dict) -> str | None:
    stance = payload.get("stance")
    return str(stance) if isinstance(stance, str) and stance.strip() else None


def _adverse_regulatory_flag(payload: dict) -> int:
    """1 when a headwind driver whose id mentions 'regulatory' has any finding."""
    for driver in list(payload.get("growth") or []) + list(payload.get("headwinds") or []):
        if not isinstance(driver, dict):
            continue
        driver_id = str(driver.get("id") or "").lower()
        if "regulatory" not in driver_id:
            continue
        kind = str(driver.get("kind") or "").lower()
        findings = driver.get("findings")
        if kind == "headwind" and findings:
            return 1
    return 0


def _build_fields(db: Session, symbol: str, payload: dict) -> dict[str, Any]:
    fields = _scores(payload)
    stance = _stance(payload)
    if stance is not None:
        fields[STANCE] = stance
    fields[ADVERSE_FLAG] = _adverse_regulatory_flag(payload)

    order_book = _latest_order_book(db, symbol)
    if order_book is not None:
        fields[ORDER_BOOK] = order_book

    implied_growth = _latest_implied_growth(db, symbol)
    if implied_growth is not None:
        fields[IMPLIED_GROWTH] = implied_growth

    return fields


def _latest_order_book(db: Session, symbol: str) -> float | None:
    try:
        inspector = inspect(db.bind)
        if not inspector.has_table(BusinessMetricORM.__tablename__):
            return None
        row = (
            db.query(BusinessMetricORM)
            .filter(
                BusinessMetricORM.symbol == symbol,
                BusinessMetricORM.kind == "kpi",
                BusinessMetricORM.category == "order_book",
            )
            .order_by(BusinessMetricORM.period.desc(), BusinessMetricORM.id.desc())
            .first()
        )
    except Exception:
        return None
    if row is None or row.value is None:
        return None
    return _to_number(row.value)


def _latest_implied_growth(db: Session, symbol: str) -> float | None:
    # Reverse DCF's implied growth normally needs a live price fetch per symbol.
    # Only surface it when it is already available cheaply in the materialized
    # screener snapshot (no network call). Absent => omit rather than fetch.
    try:
        from backend.services.materialized_store import TABLE_NAME

        inspector = inspect(db.bind)
        if not inspector.has_table(TABLE_NAME):
            return None
        columns = {column["name"] for column in inspector.get_columns(TABLE_NAME)}
        if IMPLIED_GROWTH not in columns:
            return None
        row = db.connection().execute(
            text(f"SELECT {IMPLIED_GROWTH} FROM {TABLE_NAME} WHERE ticker = :sym"),
            {"sym": str(symbol).upper()},
        ).first()
    except Exception:
        return None
    return _to_number(row[0]) if row else None


def _latest_key(row: FilingAnalysisORM) -> tuple:
    # Prefer the most recently created row, breaking ties by the newest id.
    return (row.created_at is not None, str(row.created_at or ""), int(row.id or 0))


def load_filings_fields(db: Session, symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Compute filings-intelligence screen fields for the given symbols.

    Reads the latest :class:`FilingAnalysisORM` payload per symbol (scores, stance,
    adverse-regulatory flag), the latest order-book KPI from ``business_metric_points``
    and, only when it is already available locally, ``implied_growth_pct``. Missing
    data is left as None (never 0). Best-effort: any DB problem yields an empty result
    so a screen run never crashes because filings data is unavailable.
    """
    result: dict[str, dict[str, Any]] = {}
    lookup_symbols = [str(s).strip().upper() for s in symbols if str(s).strip()]
    if not lookup_symbols:
        return result

    try:
        rows = db.query(FilingAnalysisORM).filter(
            FilingAnalysisORM.symbol.in_(lookup_symbols)
        ).all()
    except Exception:
        return result

    seen: dict[str, FilingAnalysisORM] = {}
    for row in rows:
        try:
            symbol = str(row.symbol).upper()
        except Exception:
            continue
        if symbol not in lookup_symbols:
            continue
        current = seen.get(symbol)
        if current is None or _latest_key(row) > _latest_key(current):
            seen[symbol] = row

    for symbol, row in seen.items():
        payload = row.payload
        if not isinstance(payload, dict):
            continue
        result[symbol] = _build_fields(db, symbol, payload)

    return result