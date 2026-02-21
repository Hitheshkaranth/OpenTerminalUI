from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from backend.api.routes.chart import _parse_yahoo_chart
from backend.models import PriceEodORM
from backend.services.corp_actions_service import cumulative_adjustment_factor, list_actions
from backend.services.data_version_service import get_active_data_version


@dataclass
class PricePoint:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


async def get_price_series(
    db: Session,
    fetcher: Any,
    symbol: str,
    adjusted: bool = True,
    start: str | None = None,
    end: str | None = None,
    data_version_id: str | None = None,
) -> tuple[str, list[PricePoint]]:
    version = get_active_data_version(db) if not data_version_id else None
    resolved_version_id = data_version_id or (version.id if version else "")
    q = db.query(PriceEodORM).filter(PriceEodORM.symbol == symbol.upper())
    if resolved_version_id:
        q = q.filter(PriceEodORM.data_version_id == resolved_version_id)
    if start:
        q = q.filter(PriceEodORM.trade_date >= start)
    if end:
        q = q.filter(PriceEodORM.trade_date <= end)
    rows = q.order_by(PriceEodORM.trade_date.asc()).all()
    if rows:
        points = [
            PricePoint(date=r.trade_date, open=float(r.open), high=float(r.high), low=float(r.low), close=float(r.close), volume=float(r.volume))
            for r in rows
        ]
    else:
        raw = await fetcher.fetch_history(symbol, range_str="5y", interval="1d")
        frame = _parse_yahoo_chart(raw if isinstance(raw, dict) else {})
        if frame.empty:
            return resolved_version_id, []
        frame = frame.sort_index()
        points = []
        for idx, row in frame.iterrows():
            dt = idx if isinstance(idx, datetime) else datetime.fromtimestamp(float(idx), tz=timezone.utc)
            day = dt.strftime("%Y-%m-%d")
            if start and day < start:
                continue
            if end and day > end:
                continue
            points.append(
                PricePoint(
                    date=day,
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=float(row.get("Volume", 0.0) or 0.0),
                )
            )
    if not adjusted or not points:
        return resolved_version_id, points
    actions = list_actions(db, symbol, resolved_version_id)
    adjusted_points: list[PricePoint] = []
    for p in points:
        factor = cumulative_adjustment_factor(actions, p.date)
        if factor <= 0:
            factor = 1.0
        adjusted_points.append(
            PricePoint(
                date=p.date,
                open=p.open / factor,
                high=p.high / factor,
                low=p.low / factor,
                close=p.close / factor,
                volume=p.volume,
            )
        )
    return resolved_version_id, adjusted_points


def to_dataframe(points: list[PricePoint]) -> pd.DataFrame:
    if not points:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    data = [
        {"date": p.date, "open": p.open, "high": p.high, "low": p.low, "close": p.close, "volume": p.volume}
        for p in points
    ]
    return pd.DataFrame(data).set_index("date")
