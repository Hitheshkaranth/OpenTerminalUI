from __future__ import annotations

from typing import Iterable

from sqlalchemy.orm import Session

from backend.models import CorpActionORM


def list_actions(db: Session, symbol: str, data_version_id: str | None = None) -> list[CorpActionORM]:
    query = db.query(CorpActionORM).filter(CorpActionORM.symbol == symbol.upper())
    if data_version_id:
        query = query.filter((CorpActionORM.data_version_id == data_version_id) | (CorpActionORM.data_version_id.is_(None)))
    return query.order_by(CorpActionORM.action_date.asc()).all()


def cumulative_adjustment_factor(actions: Iterable[CorpActionORM], trade_date: str) -> float:
    factor = 1.0
    for action in actions:
        # back-adjust historical bars prior to corporate action date
        if (action.action_date or "") > trade_date:
            try:
                f = float(action.factor or 1.0)
            except (TypeError, ValueError):
                f = 1.0
            if f > 0:
                factor *= f
    return factor
