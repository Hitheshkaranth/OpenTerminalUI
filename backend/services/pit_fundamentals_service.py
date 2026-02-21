from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from backend.models import FundamentalsPitORM, UniverseMembershipORM
from backend.services.data_version_service import get_active_data_version


def get_fundamentals_asof(
    db: Session,
    symbol: str,
    as_of: str,
    data_version_id: str | None = None,
) -> tuple[str, dict[str, float]]:
    version = get_active_data_version(db) if not data_version_id else None
    resolved_version_id = data_version_id or (version.id if version else "")
    rows = (
        db.query(FundamentalsPitORM)
        .filter(
            FundamentalsPitORM.symbol == symbol.upper(),
            FundamentalsPitORM.as_of_date <= as_of,
            FundamentalsPitORM.data_version_id == resolved_version_id,
        )
        .order_by(FundamentalsPitORM.metric.asc(), FundamentalsPitORM.as_of_date.desc())
        .all()
    )
    by_metric: dict[str, float] = {}
    for row in rows:
        if row.metric in by_metric:
            continue
        by_metric[row.metric] = float(row.value)
    return resolved_version_id, by_metric


def get_universe_members(
    db: Session,
    universe_id: str,
    as_of: str | None = None,
    data_version_id: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    version = get_active_data_version(db) if not data_version_id else None
    resolved_version_id = data_version_id or (version.id if version else "")
    query = db.query(UniverseMembershipORM).filter(
        UniverseMembershipORM.universe_id == universe_id,
        UniverseMembershipORM.data_version_id == resolved_version_id,
    )
    if as_of:
        query = query.filter(
            UniverseMembershipORM.start_date <= as_of,
            (UniverseMembershipORM.end_date.is_(None)) | (UniverseMembershipORM.end_date >= as_of),
        )
    rows = query.order_by(UniverseMembershipORM.symbol.asc(), UniverseMembershipORM.start_date.asc()).all()
    out = [
        {
            "symbol": row.symbol,
            "start_date": row.start_date,
            "end_date": row.end_date,
        }
        for row in rows
    ]
    return resolved_version_id, out
