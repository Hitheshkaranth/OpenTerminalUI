from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from backend.models import FundamentalsPitORM, UniverseMembershipORM
from backend.services.data_version_service import get_active_data_version


@dataclass(frozen=True)
class PitFundamentalRecord:
    symbol: str
    metric: str
    value: float
    fiscal_period: str
    as_of_release_date: date
    release_date_estimated: bool
    source: str
    market: str


def _date_to_str(value: date | str | None) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    if value in (None, ""):
        return None
    text = str(value).strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _to_float(value: Any) -> float | None:
    try:
        out = float(value)
        if out != out:
            return None
        return out
    except (TypeError, ValueError):
        return None


def _market_for_symbol(symbol: str) -> str:
    upper = symbol.upper()
    if upper.endswith(".NS") or upper.endswith(".BO"):
        return "IN"
    return "US"


def conservative_release_date(fiscal_period_end: date, period_type: str = "annual") -> date:
    lag_days = 120 if period_type.lower().startswith("annual") else 60
    return fiscal_period_end + timedelta(days=lag_days)


def get_fundamentals(
    db: Session,
    symbol: str,
    as_of: date,
    data_version_id: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    version = get_active_data_version(db) if not data_version_id else None
    resolved_version_id = data_version_id or (version.id if version else "")
    as_of_str = _date_to_str(as_of)
    rows = (
        db.query(FundamentalsPitORM)
        .filter(
            FundamentalsPitORM.symbol == symbol.upper(),
            FundamentalsPitORM.as_of_date <= as_of_str,
            FundamentalsPitORM.data_version_id == resolved_version_id,
        )
        .order_by(
            FundamentalsPitORM.metric.asc(),
            FundamentalsPitORM.fiscal_period.desc(),
            FundamentalsPitORM.as_of_date.desc(),
        )
        .all()
    )
    latest_by_metric: dict[str, FundamentalsPitORM] = {}
    for row in rows:
        latest_by_metric.setdefault(row.metric, row)
    return resolved_version_id, [
        {
            "symbol": row.symbol,
            "metric": row.metric,
            "value": float(row.value),
            "fiscal_period": row.fiscal_period or "",
            "as_of_release_date": row.as_of_date,
            "release_date_estimated": bool(row.release_date_estimated),
            "source": row.source or "",
            "market": row.market or "",
        }
        for row in latest_by_metric.values()
    ]


def get_fundamentals_asof(
    db: Session,
    symbol: str,
    as_of: str,
    data_version_id: str | None = None,
) -> tuple[str, dict[str, float]]:
    parsed = _parse_date(as_of) or datetime.now(timezone.utc).date()
    resolved_version_id, rows = get_fundamentals(db, symbol=symbol, as_of=parsed, data_version_id=data_version_id)
    return resolved_version_id, {str(row["metric"]): float(row["value"]) for row in rows}


def upsert_pit_records(
    db: Session,
    records: list[PitFundamentalRecord],
    data_version_id: str | None = None,
) -> tuple[str, int]:
    if not records:
        version = get_active_data_version(db) if not data_version_id else None
        return data_version_id or (version.id if version else ""), 0

    version = get_active_data_version(db) if not data_version_id else None
    resolved_version_id = data_version_id or (version.id if version else "")
    changed = 0
    # The session does not autoflush, so rows added earlier in this batch are invisible to the
    # query below; track them so duplicate keys (e.g. netIncome in both FMP income and
    # cash-flow statements) update one row instead of violating the unique constraint.
    pending: dict[tuple[str, str, str], FundamentalsPitORM] = {}
    for record in records:
        release_str = record.as_of_release_date.isoformat()
        pending_key = (record.symbol.upper(), record.metric, release_str)
        existing = pending.get(pending_key) or (
            db.query(FundamentalsPitORM)
            .filter(
                FundamentalsPitORM.symbol == record.symbol.upper(),
                FundamentalsPitORM.metric == record.metric,
                FundamentalsPitORM.as_of_date == release_str,
                FundamentalsPitORM.data_version_id == resolved_version_id,
            )
            .first()
        )
        if existing is None:
            existing = FundamentalsPitORM(
                symbol=record.symbol.upper(),
                metric=record.metric,
                as_of_date=release_str,
                data_version_id=resolved_version_id,
                created_at=datetime.now(timezone.utc),
            )
            db.add(existing)
        pending[pending_key] = existing
        existing.value = record.value
        existing.fiscal_period = record.fiscal_period
        existing.release_date_estimated = record.release_date_estimated
        existing.source = record.source
        existing.market = record.market
        existing.effective_from = release_str
        changed += 1
    db.commit()
    return resolved_version_id, changed


def _records_from_fmp_rows(symbol: str, rows: list[dict[str, Any]], source: str, market: str) -> list[PitFundamentalRecord]:
    metric_map = {
        "revenue": "revenue",
        "totalRevenue": "revenue",
        "netIncome": "net_income",
        "operatingIncome": "operating_income",
        "ebitda": "ebitda",
        "eps": "eps",
        "epsdiluted": "eps_diluted",
        "totalAssets": "total_assets",
        "totalLiabilities": "total_liabilities",
        "totalStockholdersEquity": "shareholders_equity",
        "freeCashFlow": "free_cash_flow",
        "operatingCashFlow": "operating_cash_flow",
        "capitalExpenditure": "capital_expenditure",
    }
    out: list[PitFundamentalRecord] = []
    for row in rows:
        fiscal_end = _parse_date(row.get("date") or row.get("calendarYear"))
        if fiscal_end is None:
            continue
        accepted = _parse_date(row.get("acceptedDate") or row.get("fillingDate") or row.get("filingDate"))
        release_date = accepted or conservative_release_date(fiscal_end, str(row.get("period") or "annual"))
        estimated = accepted is None
        fiscal_period = str(row.get("period") or fiscal_end.isoformat())
        for raw_key, metric in metric_map.items():
            value = _to_float(row.get(raw_key))
            if value is None:
                continue
            out.append(
                PitFundamentalRecord(
                    symbol=symbol.upper(),
                    metric=metric,
                    value=value,
                    fiscal_period=fiscal_period,
                    as_of_release_date=release_date,
                    release_date_estimated=estimated,
                    source=source,
                    market=market,
                )
            )
    return out


def _records_from_yahoo_timeseries(symbol: str, payload: dict[str, Any], market: str) -> list[PitFundamentalRecord]:
    out: list[PitFundamentalRecord] = []
    for key, series in payload.items():
        if not isinstance(series, dict):
            continue
        values = series.get("value")
        if not isinstance(values, list):
            continue
        metric = key
        period_type = "annual" if key.lower().startswith("annual") else "quarterly"
        if metric.startswith("annual"):
            metric = metric.removeprefix("annual")
        elif metric.startswith("quarterly"):
            metric = metric.removeprefix("quarterly")
        metric = "".join([f"_{ch.lower()}" if ch.isupper() else ch for ch in metric]).strip("_")
        for item in values:
            if not isinstance(item, dict):
                continue
            value = _to_float(item.get("reportedValue", {}).get("raw") if isinstance(item.get("reportedValue"), dict) else item.get("reportedValue"))
            fiscal_end = _parse_date(item.get("asOfDate") or item.get("period"))
            if value is None or fiscal_end is None:
                continue
            out.append(
                PitFundamentalRecord(
                    symbol=symbol.upper(),
                    metric=metric,
                    value=value,
                    fiscal_period=fiscal_end.isoformat(),
                    as_of_release_date=conservative_release_date(fiscal_end, period_type),
                    release_date_estimated=True,
                    source="yahoo",
                    market=market,
                )
            )
    return out


async def fetch_and_store_pit_fundamentals(
    db: Session,
    fetcher: Any,
    symbol: str,
    data_version_id: str | None = None,
) -> tuple[str, int]:
    records: list[PitFundamentalRecord] = []
    if hasattr(fetcher, "fetch_pit_fundamentals_records"):
        raw = await fetcher.fetch_pit_fundamentals_records(symbol)
        records = [
            PitFundamentalRecord(
                symbol=str(item["symbol"]).upper(),
                metric=str(item["metric"]),
                value=float(item["value"]),
                fiscal_period=str(item.get("fiscal_period") or ""),
                as_of_release_date=_parse_date(item.get("as_of_release_date")) or datetime.now(timezone.utc).date(),
                release_date_estimated=bool(item.get("release_date_estimated")),
                source=str(item.get("source") or ""),
                market=str(item.get("market") or _market_for_symbol(symbol)),
            )
            for item in raw
            if isinstance(item, dict) and _to_float(item.get("value")) is not None
        ]
    return upsert_pit_records(db, records, data_version_id=data_version_id)


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
