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

_SAMPLE_STOCKS: list[dict[str, Any]] = [
    {"symbol": "RELIANCE", "name": "Reliance Industries", "base_price": 2860.0},
    {"symbol": "TCS", "name": "Tata Consultancy Services", "base_price": 4135.0},
    {"symbol": "INFY", "name": "Infosys", "base_price": 1585.0},
    {"symbol": "HDFCBANK", "name": "HDFC Bank", "base_price": 1685.0},
    {"symbol": "ICICIBANK", "name": "ICICI Bank", "base_price": 1140.0},
    {"symbol": "BHARTIARTL", "name": "Bharti Airtel", "base_price": 1242.0},
    {"symbol": "LT", "name": "Larsen & Toubro", "base_price": 3680.0},
    {"symbol": "SUNPHARMA", "name": "Sun Pharmaceutical", "base_price": 1525.0},
    {"symbol": "TITAN", "name": "Titan Company", "base_price": 3480.0},
    {"symbol": "MARUTI", "name": "Maruti Suzuki", "base_price": 12120.0},
]

_SAMPLE_INSIDERS: list[dict[str, str]] = [
    {"name": "Mukesh D Ambani", "designation": "Chairman"},
    {"name": "N V Subramanian", "designation": "Managing Director"},
    {"name": "Vinit Sambre", "designation": "Whole-Time Director"},
    {"name": "Sandeep Batra", "designation": "Executive Director"},
    {"name": "Roshni Nadar", "designation": "Non-Executive Director"},
    {"name": "Keki M Mistry", "designation": "Independent Director"},
]


def _today_utc() -> datetime:
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def _symbol_name(symbol: str) -> str:
    for item in _SAMPLE_STOCKS:
        if item["symbol"] == symbol:
            return str(item["name"])
    return symbol


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
    }


def _seed_sample_data_if_empty(db: Session) -> None:
    count = db.query(func.count(InsiderTrade.id)).scalar() or 0
    if count > 0:
        return

    today = _today_utc()
    rows: list[InsiderTrade] = []
    for stock_index, stock in enumerate(_SAMPLE_STOCKS):
        for offset in range(6):
            insider = _SAMPLE_INSIDERS[(stock_index + offset) % len(_SAMPLE_INSIDERS)]
            is_cluster_buy = stock_index < 4 and offset < 3
            trade_type = "buy" if is_cluster_buy or (offset + stock_index) % 3 != 0 else "sell"
            trade_date = today - timedelta(days=stock_index * 3 + offset * 6 + (stock_index % 2))
            quantity = 1400 + stock_index * 320 + offset * 175
            price = round(float(stock["base_price"]) * (0.92 + (offset * 0.035)), 2)
            value = round(quantity * price, 2)
            rows.append(
                InsiderTrade(
                    symbol=str(stock["symbol"]),
                    insider_name=str(insider["name"]),
                    insider_title=str(insider["designation"]),
                    transaction_type=trade_type,
                    shares=quantity,
                    price=price,
                    value=value,
                    date=trade_date,
                    filing_date=trade_date + timedelta(days=1),
                    source="SEEDED",
                )
            )
    db.add_all(rows)
    db.commit()


def _load_filtered_trades(
    db: Session,
    *,
    days: int,
    min_value: float = 0.0,
    trade_type: str | None = None,
    symbol: str | None = None,
    limit: int | None = None,
) -> list[InsiderTrade]:
    _seed_sample_data_if_empty(db)
    start_date = _today_utc() - timedelta(days=max(days, 1))
    query = db.query(InsiderTrade).filter(InsiderTrade.date >= start_date)
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
