from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.models.core import InsiderTrade

router = APIRouter(prefix="/api/insider", tags=["insider"])

# Display names for common NSE symbols; trades themselves only ever come from the
# insider_trades table (populated by real filings ingestion). No sample rows are seeded.
_KNOWN_NAMES: dict[str, str] = {
    "RELIANCE": "Reliance Industries",
    "TCS": "Tata Consultancy Services",
    "INFY": "Infosys",
    "HDFCBANK": "HDFC Bank",
    "ICICIBANK": "ICICI Bank",
    "BHARTIARTL": "Bharti Airtel",
    "LT": "Larsen & Toubro",
    "SUNPHARMA": "Sun Pharmaceutical",
    "TITAN": "Titan Company",
    "MARUTI": "Maruti Suzuki",
}

# Rows written by the old auto-seeder (fabricated insiders/prices) must never be served as real.
_FABRICATED_SOURCES = ("SEEDED",)
_INR_SOURCES = {"NSE", "BSE", "SEBI"}
_USD_SOURCES = {"SEC", "FINNHUB", "FMP", "EDGAR"}


def _today_utc() -> datetime:
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def _symbol_name(symbol: str) -> str:
    return _KNOWN_NAMES.get(symbol, symbol)


def _currency_for(symbol: str, source: str | None) -> str | None:
    src = str(source or "").strip().upper()
    sym = str(symbol or "").strip().upper()
    if src in _INR_SOURCES or sym.endswith((".NS", ".BO")) or sym in _KNOWN_NAMES:
        return "INR"
    if src in _USD_SOURCES:
        return "USD"
    return None


def _trade_payload(trade: InsiderTrade) -> dict[str, Any]:
    date_value = trade.date.date().isoformat() if trade.date else None
    return {
        "date": date_value,
        "symbol": trade.symbol,
        "name": _symbol_name(trade.symbol),
        "insider_name": trade.insider_name,
        "designation": trade.insider_title,
        "type": str(trade.transaction_type or "").lower(),
        "quantity": trade.shares,
        "price": trade.price,
        "value": trade.value,
        "post_holding_pct": getattr(trade, "post_holding_pct", None),
        "currency": _currency_for(trade.symbol, trade.source),
        "source": trade.source,
    }


def _load_filtered_trades(
    db: Session,
    *,
    days: int,
    min_value: float = 0.0,
    trade_type: str | None = None,
    symbol: str | None = None,
    limit: int | None = None,
) -> list[InsiderTrade]:
    start_date = _today_utc() - timedelta(days=max(days, 1))
    query = db.query(InsiderTrade).filter(
        InsiderTrade.date >= start_date,
        InsiderTrade.source.notin_(_FABRICATED_SOURCES),
    )
    if min_value > 0:
        query = query.filter(InsiderTrade.value >= min_value)
    if trade_type:
        query = query.filter(func.lower(InsiderTrade.transaction_type) == trade_type.lower())
    if symbol:
        query = query.filter(InsiderTrade.symbol == symbol.upper())
    query = query.order_by(InsiderTrade.date.desc(), InsiderTrade.id.desc())
    if limit is not None:
        query = query.limit(limit)
    return list(query.all())


@router.get("/recent")
def get_recent_insider_trades(
    days: int = Query(30, ge=1, le=3650),
    min_value: float = Query(1_000_000, ge=0),
    type: str | None = Query(None, pattern="^(buy|sell)$"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    trades = _load_filtered_trades(db, days=days, min_value=min_value, trade_type=type, limit=limit)
    return {"trades": [_trade_payload(trade) for trade in trades]}


@router.get("/stock/{symbol}")
def get_insider_stock_detail(
    symbol: str,
    days: int = Query(365, ge=1, le=3650),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    trades = _load_filtered_trades(db, days=days, symbol=symbol, limit=500)
    total_buys = sum(float(trade.value or 0.0) for trade in trades if str(trade.transaction_type).lower() == "buy")
    total_sells = sum(float(trade.value or 0.0) for trade in trades if str(trade.transaction_type).lower() == "sell")
    insider_count = len({str(trade.insider_name).strip().lower() for trade in trades if trade.insider_name})
    return {
        "trades": [_trade_payload(trade) for trade in trades],
        "summary": {
            "total_buys": round(total_buys, 2),
            "total_sells": round(total_sells, 2),
            "net_value": round(total_buys - total_sells, 2),
            "insider_count": insider_count,
        },
    }


def _build_top_activity(db: Session, *, days: int, limit: int, trade_type: str) -> list[dict[str, Any]]:
    trades = _load_filtered_trades(db, days=days, trade_type=trade_type, limit=None)
    grouped: dict[str, dict[str, Any]] = {}
    for trade in trades:
        symbol = str(trade.symbol)
        bucket = grouped.setdefault(
            symbol,
            {
                "symbol": symbol,
                "name": _symbol_name(symbol),
                "currency": _currency_for(symbol, trade.source),
                "total_value": 0.0,
                "trade_count": 0,
                "avg_price_numerator": 0.0,
                "avg_price_denominator": 0.0,
                "latest_date": None,
            },
        )
        trade_value = float(trade.value or 0.0)
        quantity = float(trade.shares or 0.0)
        price = float(trade.price or 0.0)
        bucket["total_value"] += trade_value
        bucket["trade_count"] += 1
        bucket["avg_price_numerator"] += price * quantity
        bucket["avg_price_denominator"] += quantity
        bucket["latest_date"] = max(bucket["latest_date"], trade.date.date().isoformat()) if bucket["latest_date"] else trade.date.date().isoformat()

    rows = sorted(grouped.values(), key=lambda item: (-float(item["total_value"]), str(item["symbol"])))
    payload: list[dict[str, Any]] = []
    for row in rows[:limit]:
        avg_price = (
            float(row["avg_price_numerator"]) / float(row["avg_price_denominator"])
            if float(row["avg_price_denominator"]) > 0
            else 0.0
        )
        payload.append(
            {
                "symbol": row["symbol"],
                "name": row["name"],
                "currency": row["currency"],
                "total_value": round(float(row["total_value"]), 2),
                "trade_count": int(row["trade_count"]),
                "avg_price": round(avg_price, 2),
                "latest_date": row["latest_date"],
            }
        )
    return payload


@router.get("/top-buyers")
def get_top_buyers(
    days: int = Query(90, ge=1, le=3650),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return {"buyers": _build_top_activity(db, days=days, limit=limit, trade_type="buy")}


@router.get("/top-sellers")
def get_top_sellers(
    days: int = Query(90, ge=1, le=3650),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return {"sellers": _build_top_activity(db, days=days, limit=limit, trade_type="sell")}


@router.get("/cluster-buys")
def get_cluster_buys(
    days: int = Query(30, ge=1, le=3650),
    min_insiders: int = Query(3, ge=2, le=20),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    trades = _load_filtered_trades(db, days=days, trade_type="buy", limit=None)
    grouped: dict[str, list[InsiderTrade]] = defaultdict(list)
    for trade in trades:
        grouped[str(trade.symbol)].append(trade)

    clusters: list[dict[str, Any]] = []
    for symbol, symbol_trades in grouped.items():
        insider_map: dict[str, dict[str, Any]] = {}
        for trade in symbol_trades:
            key = str(trade.insider_name).strip().lower()
            if not key:
                continue
            trade_value = float(trade.value or 0.0)
            existing = insider_map.get(key)
            if existing is None:
                insider_map[key] = {
                    "name": trade.insider_name,
                    "designation": trade.insider_title,
                    "value": trade_value,
                    "date": trade.date.date().isoformat(),
                }
            else:
                existing["value"] += trade_value
                existing["date"] = max(str(existing["date"]), trade.date.date().isoformat())
        if len(insider_map) < min_insiders:
            continue
        insider_rows = sorted(insider_map.values(), key=lambda item: (-float(item["value"]), str(item["name"])))
        clusters.append(
            {
                "symbol": symbol,
                "name": _symbol_name(symbol),
                "currency": _currency_for(symbol, symbol_trades[0].source if symbol_trades else None),
                "insider_count": len(insider_rows),
                "total_value": round(sum(float(item["value"]) for item in insider_rows), 2),
                "insiders": [
                    {
                        "name": item["name"],
                        "designation": item["designation"],
                        "value": round(float(item["value"]), 2),
                        "date": item["date"],
                    }
                    for item in insider_rows
                ],
            }
        )

    clusters.sort(key=lambda item: (-float(item["insider_count"]), -float(item["total_value"]), str(item["symbol"])))
    return {"clusters": clusters}
