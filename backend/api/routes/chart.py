from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import cache_instance, get_chart_provider, get_unified_fetcher
from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.core.models import ChartResponse, IndicatorPoint, IndicatorResponse, OhlcvPoint
from backend.core.technicals import compute_indicator
from backend.models import ChartDrawing, ChartTemplate, User

try:
    from backend.adapters.registry import get_adapter_registry
except Exception:  # pragma: no cover - adapter module may be absent in lightweight test envs
    get_adapter_registry = None

router = APIRouter()


class ChartDrawingCreate(BaseModel):
    tool_type: str
    coordinates: dict[str, Any] = Field(default_factory=dict)
    style: dict[str, Any] = Field(default_factory=dict)


class ChartDrawingUpdate(BaseModel):
    coordinates: dict[str, Any] | None = None
    style: dict[str, Any] | None = None


class ChartTemplateCreate(BaseModel):
    name: str
    layout_config: dict[str, Any] = Field(default_factory=dict)

def _synthetic_history(ticker: str, interval: str, range_val: str) -> pd.DataFrame:
    # Deterministic synthetic series for UI continuity when upstream market data is unavailable.
    seed = abs(hash(f"{ticker}:{interval}:{range_val}")) % (2**32)
    rng = random.Random(seed)
    interval_map = {
        "1m": ("minutes", 1, 360),
        "5m": ("minutes", 5, 360),
        "15m": ("minutes", 15, 360),
        "30m": ("minutes", 30, 360),
        "1h": ("hours", 1, 360),
        "4h": ("hours", 4, 360),
        "1d": ("days", 1, 365),
        "1wk": ("days", 7, 260),
        "1mo": ("days", 30, 120),
    }
    unit, step, points = interval_map.get(interval, ("days", 1, 365))
    now = datetime.now(timezone.utc)
    dt_list: list[datetime] = []
    price = 1000.0 + rng.uniform(-150, 150)
    rows: list[dict[str, float]] = []
    for i in range(points):
        dt = now - timedelta(**{unit: step * (points - i)})
        drift = 0.3 * math.sin(i / 18.0) + rng.uniform(-1.8, 1.8)
        open_p = price
        close_p = max(50.0, open_p + drift)
        high_p = max(open_p, close_p) + abs(rng.uniform(0.4, 3.6))
        low_p = min(open_p, close_p) - abs(rng.uniform(0.4, 3.6))
        volume = max(1000.0, 1_000_000 + rng.uniform(-250_000, 250_000))
        rows.append({"Open": open_p, "High": high_p, "Low": low_p, "Close": close_p, "Volume": volume})
        dt_list.append(dt)
        price = close_p
    df = pd.DataFrame(rows, index=pd.DatetimeIndex(dt_list))
    return df

def _parse_yahoo_chart(data: Dict[str, Any]) -> pd.DataFrame:
    # Parses the raw Yahoo Chart API response into a DataFrame
    # Expected structure: {"chart": {"result": [{"timestamp": [...], "indicators": {"quote": [...]}}]}}
    try:
        chart_result = (data.get("chart") or {}).get("result")
        if not chart_result or not isinstance(chart_result, list):
            return pd.DataFrame()

        res = chart_result[0]
        timestamps = res.get("timestamp")
        if not timestamps:
            return pd.DataFrame()

        quote = (res.get("indicators") or {}).get("quote")
        if not quote or not isinstance(quote, list):
            return pd.DataFrame()

        q = quote[0]

        # Zip and create dict
        # Filter out None values in OHLC
        opens = q.get("open") or []
        highs = q.get("high") or []
        lows = q.get("low") or []
        closes = q.get("close") or []
        volumes = q.get("volume") or []

        # Validation
        length = len(timestamps)
        if not (len(opens) == length and len(highs) == length and len(lows) == length and len(closes) == length):
            # Try to slice to min length? Or just fail?
            # Usually strict alignment is required
            return pd.DataFrame()

        rows = []
        utc_dates = []
        for i in range(length):
            ts = timestamps[i]
            o, h, l, c, v = opens[i], highs[i], lows[i], closes[i], volumes[i]

            if None in (o, h, l, c):
                continue

            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            rows.append({
                "Open": float(o),
                "High": float(h),
                "Low": float(l),
                "Close": float(c),
                "Volume": float(v) if v is not None else 0.0
            })
            utc_dates.append(dt)

        if not rows:
            return pd.DataFrame()

        df = pd.DataFrame(rows, index=pd.DatetimeIndex(utc_dates))
        return df

    except Exception:
        return pd.DataFrame()


@router.get("/chart/{ticker}")
async def get_chart(
    ticker: str,
    market: str | None = Query(default=None),
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
    period: Optional[str] = Query(default=None),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    normalized: bool = Query(default=False),
    limit: int | None = Query(default=None, ge=1, le=5000),
    cursor: int | None = Query(default=None),
) -> Any:
    # Direct function calls in unit tests bypass FastAPI dependency parsing and can leave
    # `Query(...)` sentinel objects in parameters.
    if not isinstance(market, str):
        market = None
    if not isinstance(interval, str):
        interval = "1d"
    if not isinstance(range, str):
        range = "1y"
    if not isinstance(period, str):
        period = None
    if not isinstance(start, str):
        start = None
    if not isinstance(end, str):
        end = None
    if not isinstance(normalized, bool):
        normalized = False

    # Unified OHLCV branch for the new chart workstation endpoint contract.
    # Keep the legacy ChartResponse branch below intact for pagination/backfill consumers.
    if normalized or period is not None or start is not None or end is not None:
        provider = await get_chart_provider()
        start_dt = None
        end_dt = None
        try:
            if start:
                s = start[:-1] + "+00:00" if start.endswith("Z") else start
                start_dt = datetime.fromisoformat(s)
            if end:
                e = end[:-1] + "+00:00" if end.endswith("Z") else end
                end_dt = datetime.fromisoformat(e)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid ISO date: {exc}") from exc

        bars = await provider.get_ohlcv(
            ticker,
            interval=interval,
            period=period or range or "6mo",
            start=start_dt,
            end=end_dt,
            market_hint=market,
        )
        return {
            "symbol": ticker.upper(),
            "interval": interval,
            "count": len(bars),
            "market_hint": (market or "").upper(),
            "data": [
                {
                    "t": int((b.timestamp if b.timestamp.tzinfo else b.timestamp.replace(tzinfo=timezone.utc)).timestamp() * 1000),
                    "o": float(b.open),
                    "h": float(b.high),
                    "l": float(b.low),
                    "c": float(b.close),
                    "v": float(b.volume),
                }
                for b in bars
            ],
        }

    if not market:
        market = "NSE"
    key = cache_instance.build_key("chart", ticker.upper(), {"i": interval, "r": range})
    cached = await cache_instance.get(key)
    if cached:
        payload = cached
    else:
        fetcher = await get_unified_fetcher()
        adapter_rows = []
        if get_adapter_registry is not None:
            try:
                registry = get_adapter_registry()
                end_d = date.today()
                start_d = end_d - timedelta(days=365)
                adapter_rows = await registry.get_adapter(market).get_history(ticker, interval, start_d, end_d)
            except Exception:
                adapter_rows = []
        if adapter_rows:
            hist = pd.DataFrame(
                [{"Open": r.o, "High": r.h, "Low": r.l, "Close": r.c, "Volume": r.v, "t": r.t} for r in adapter_rows]
            )
            hist.index = pd.DatetimeIndex([datetime.fromtimestamp(int(x), tz=timezone.utc) for x in hist["t"]])
            hist = hist.drop(columns=["t"])
            raw_data = {}
        else:
            # UnifiedFetcher.fetch_history prioritizes NSE > Yahoo > FMP
            raw_data = await fetcher.fetch_history(ticker, range_str=range, interval=interval)

            hist = pd.DataFrame()
            if raw_data and "chart" in raw_data:
                hist = _parse_yahoo_chart(raw_data)
            elif raw_data and "historical" in raw_data:  # FMP style currently unsupported in this parser
                pass

        warnings: list[Dict[str, str]] = []
        if hist.empty:
            hist = _synthetic_history(ticker=ticker, interval=interval, range_val=range)
            warnings.append(
                {
                    "code": "chart_data_fallback",
                    "message": "Live data unavailable; displaying synthetic fallback series.",
                }
            )
        if hist.empty:
            raise HTTPException(status_code=404, detail="No chart data available")

        data: list[OhlcvPoint] = []
        for idx, row in hist.iterrows():
            # idx is Timestamp
            ts_int = int(idx.timestamp())
            data.append(OhlcvPoint(
                t=ts_int,
                o=float(row["Open"]),
                h=float(row["High"]),
                l=float(row["Low"]),
                c=float(row["Close"]),
                v=float(row.get("Volume", 0) or 0)
            ))

        payload = {
            "ticker": ticker.upper(),
            "interval": interval,
            "currency": "INR",
            "data": [d.model_dump() for d in data],
            "meta": {"warnings": warnings},
        }
        await cache_instance.set(key, payload, ttl=300)

    all_points = [OhlcvPoint(**point) if not isinstance(point, OhlcvPoint) else point for point in payload.get("data", [])]
    # Keep deterministic oldest->newest ordering before slicing.
    all_points.sort(key=lambda p: p.t)

    filtered_points = [p for p in all_points if cursor is None or p.t < cursor]
    has_more = False
    next_cursor: int | None = None
    if limit is not None and len(filtered_points) > limit:
        has_more = True
        filtered_points = filtered_points[-limit:]
        if filtered_points:
            next_cursor = filtered_points[0].t

    return ChartResponse(
        ticker=str(payload.get("ticker") or ticker.upper()),
        interval=str(payload.get("interval") or interval),
        currency=str(payload.get("currency") or "INR"),
        data=filtered_points,
        meta={
            "warnings": (payload.get("meta") or {}).get("warnings", []),
            "pagination": {
                "cursor": next_cursor,
                "has_more": has_more,
                "limit": limit,
                "requested_cursor": cursor,
                "returned": len(filtered_points),
                "total": len(all_points),
            },
        },
    )


@router.get("/chart/{ticker}/indicators", response_model=IndicatorResponse)
async def get_indicator(
    ticker: str,
    type: str,
    interval: str = Query(default="1d"),
    range: str = Query(default="1y"),
    period: int | None = None,
    std_dev: float | None = None,
    fast: int | None = None,
    slow: int | None = None,
    signal: int | None = None,
) -> IndicatorResponse:
    # We don't cache indicators directly logic-heavy, but underlying data is cached by get_chart logic if we reused it
    # But here we fetching history again.

    fetcher = await get_unified_fetcher()
    raw_data = await fetcher.fetch_history(ticker, range_str=range, interval=interval)

    hist = pd.DataFrame()
    if raw_data and "chart" in raw_data:
        hist = _parse_yahoo_chart(raw_data)

    warnings: list[Dict[str, str]] = []
    if hist.empty:
        hist = _synthetic_history(ticker=ticker, interval=interval, range_val=range)
        warnings.append({
            "code": "indicator_data_fallback",
            "message": "Live data unavailable; indicator computed on synthetic fallback series.",
        })

    if hist.empty:
        raise HTTPException(status_code=404, detail="No chart data available")

    params: dict[str, int | float] = {}
    for key, val in {"period": period, "std_dev": std_dev, "fast": fast, "slow": slow, "signal": signal}.items():
        if val is not None:
            params[key] = val

    try:
        # compute_indicator is synchronous (pandas operations).
        # Ideally run in threadpool if heavy, but for simple indicators it's fast enough.
        indicator = compute_indicator(hist, type, params)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    points: list[IndicatorPoint] = []
    for idx, row in indicator.iterrows():
        # idx is Timestamp
        ts_int = int(idx.timestamp())
        values = {col: (float(v) if v == v else None) for col, v in row.items()}
        points.append(IndicatorPoint(t=ts_int, values=values))

    return IndicatorResponse(ticker=ticker.upper(), indicator=type, params=params, data=points, meta={"warnings": warnings})


@router.post("/chart-drawings/{symbol}")
def create_chart_drawing(
    symbol: str,
    payload: ChartDrawingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = ChartDrawing(
        user_id=current_user.id,
        symbol=symbol.strip().upper(),
        tool_type=payload.tool_type.strip().lower(),
        coordinates=dict(payload.coordinates),
        style=dict(payload.style),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "symbol": row.symbol, "tool_type": row.tool_type}


@router.get("/chart-drawings/{symbol}")
def list_chart_drawings(
    symbol: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = (
        db.query(ChartDrawing)
        .filter(ChartDrawing.user_id == current_user.id, ChartDrawing.symbol == symbol.strip().upper())
        .order_by(ChartDrawing.created_at.asc())
        .all()
    )
    return {
        "items": [
            {
                "id": row.id,
                "symbol": row.symbol,
                "tool_type": row.tool_type,
                "coordinates": row.coordinates if isinstance(row.coordinates, dict) else {},
                "style": row.style if isinstance(row.style, dict) else {},
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }


@router.put("/chart-drawings/{symbol}/{drawing_id}")
def update_chart_drawing(
    symbol: str,
    drawing_id: str,
    payload: ChartDrawingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = (
        db.query(ChartDrawing)
        .filter(
            ChartDrawing.id == drawing_id,
            ChartDrawing.user_id == current_user.id,
            ChartDrawing.symbol == symbol.strip().upper(),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Drawing not found")
    if payload.coordinates is not None:
        row.coordinates = dict(payload.coordinates)
    if payload.style is not None:
        row.style = dict(payload.style)
    db.commit()
    return {"status": "updated", "id": row.id}


@router.delete("/chart-drawings/{symbol}/{drawing_id}")
def delete_chart_drawing(
    symbol: str,
    drawing_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = (
        db.query(ChartDrawing)
        .filter(
            ChartDrawing.id == drawing_id,
            ChartDrawing.user_id == current_user.id,
            ChartDrawing.symbol == symbol.strip().upper(),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Drawing not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": drawing_id}


@router.post("/chart-templates")
def create_chart_template(
    payload: ChartTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = ChartTemplate(
        user_id=current_user.id,
        name=payload.name.strip(),
        layout_config=dict(payload.layout_config),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


@router.get("/chart-templates")
def list_chart_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    defaults = [
        {"id": "default-day-trading", "name": "Day Trading", "layout_config": {"panels": ["1min", "5min", "15min"]}},
        {"id": "default-swing", "name": "Swing", "layout_config": {"panels": ["1d", "1wk"]}},
        {"id": "default-scalping", "name": "Scalping", "layout_config": {"panels": ["tick", "1min"]}},
    ]
    rows = (
        db.query(ChartTemplate)
        .filter(ChartTemplate.user_id == current_user.id)
        .order_by(ChartTemplate.created_at.desc())
        .all()
    )
    items = defaults + [
        {
            "id": row.id,
            "name": row.name,
            "layout_config": row.layout_config if isinstance(row.layout_config, dict) else {},
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]
    return {"items": items}


@router.delete("/chart-templates/{template_id}")
def delete_chart_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(ChartTemplate).filter(ChartTemplate.id == template_id, ChartTemplate.user_id == current_user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": template_id}
