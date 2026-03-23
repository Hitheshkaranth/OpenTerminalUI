from __future__ import annotations

import asyncio
import math
from calendar import month_abbr, monthrange
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Literal

from pydantic import BaseModel, Field

from backend.api.deps import cache_instance, get_unified_fetcher
from backend.api.routes.chart import _parse_yahoo_chart

CommodityCategory = Literal["energy", "metals", "agriculture"]
FetcherFactory = Callable[[], Awaitable[Any]]
NowFactory = Callable[[], datetime]


class CommodityQuote(BaseModel):
    symbol: str
    name: str
    category: CommodityCategory
    price: float
    change: float
    change_pct: float
    volume: int
    sparkline: list[float] = Field(default_factory=list)
    previous_close: float
    currency: str = "USD"
    source: str = "yahoo"


class CommodityCategoryQuotes(BaseModel):
    id: CommodityCategory
    label: str
    items: list[CommodityQuote] = Field(default_factory=list)


class CommodityQuotesResponse(BaseModel):
    as_of: datetime
    categories: list[CommodityCategoryQuotes] = Field(default_factory=list)


class CommodityFuturesPoint(BaseModel):
    contract: str
    contract_symbol: str | None = None
    months_out: int
    expiry: date
    price: float
    change_pct: float | None = None
    change: float | None = None
    open_interest: int
    volume: int
    source: str = "yahoo"


class CommodityFuturesChainResponse(BaseModel):
    symbol: str
    name: str
    as_of: datetime
    source: str = "yahoo"
    points: list[CommodityFuturesPoint] = Field(default_factory=list)


class CommoditySeasonalPoint(BaseModel):
    month: str
    month_index: int
    average_return_pct: float
    average_price: float | None = None
    observations: int


class CommoditySeasonalResponse(BaseModel):
    symbol: str
    name: str
    as_of: datetime
    years: int
    source: str = "yahoo"
    monthly: list[CommoditySeasonalPoint] = Field(default_factory=list)


@dataclass(frozen=True)
class CommodityDefinition:
    yahoo_symbol: str
    root_symbol: str
    name: str
    category: CommodityCategory
    fmp_symbol: str
    exchange_suffix: str
    curve_step: float
    currency: str = "USD"


@dataclass(frozen=True)
class _ContractRequest:
    contract: str
    contract_symbol: str
    months_out: int
    expiry: date


_CATEGORY_LABELS: dict[CommodityCategory, str] = {
    "energy": "Energy",
    "metals": "Metals",
    "agriculture": "Agriculture",
}

_MONTH_CODES = {
    1: "F",
    2: "G",
    3: "H",
    4: "J",
    5: "K",
    6: "M",
    7: "N",
    8: "Q",
    9: "U",
    10: "V",
    11: "X",
    12: "Z",
}

_COMMODITIES: tuple[CommodityDefinition, ...] = (
    CommodityDefinition("CL=F", "CL", "WTI Crude Oil", "energy", "CLUSD", ".NYM", 0.45),
    CommodityDefinition("NG=F", "NG", "Natural Gas", "energy", "NGUSD", ".NYM", 0.04),
    CommodityDefinition("RB=F", "RB", "RBOB Gasoline", "energy", "RBUSD", ".NYM", 0.03),
    CommodityDefinition("BZ=F", "BZ", "Brent Crude", "energy", "BZUSD", ".ICE", 0.38),
    CommodityDefinition("GC=F", "GC", "Gold", "metals", "GCUSD", ".CMX", 7.5),
    CommodityDefinition("SI=F", "SI", "Silver", "metals", "SIUSD", ".CMX", 0.18),
    CommodityDefinition("HG=F", "HG", "Copper", "metals", "HGUSD", ".CMX", 0.02),
    CommodityDefinition("PL=F", "PL", "Platinum", "metals", "PLUSD", ".NYM", 1.8),
    CommodityDefinition("ZC=F", "ZC", "Corn", "agriculture", "ZCUSD", ".CBT", 1.2),
    CommodityDefinition("ZW=F", "ZW", "Wheat", "agriculture", "ZWUSD", ".CBT", 1.4),
    CommodityDefinition("ZS=F", "ZS", "Soybeans", "agriculture", "ZSUSD", ".CBT", 2.1),
    CommodityDefinition("KC=F", "KC", "Coffee", "agriculture", "KCUSD", ".ICE", 0.9),
)

_DEFINITION_BY_SYMBOL: dict[str, CommodityDefinition] = {
    item.yahoo_symbol: item for item in _COMMODITIES
}
_DEFINITION_BY_ROOT: dict[str, CommodityDefinition] = {
    item.root_symbol: item for item in _COMMODITIES
}


def _month_end(value: date) -> date:
    return date(value.year, value.month, monthrange(value.year, value.month)[1])


def _add_months(value: date, months: int) -> date:
    year = value.year + (value.month - 1 + months) // 12
    month = (value.month - 1 + months) % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def _coerce_float(value: Any) -> float | None:
    if value in (None, "", "NA", "N/A", "-"):
        return None
    if isinstance(value, str):
        normalized = value.strip().replace(",", "").replace("%", "")
        if not normalized:
            return None
        value = normalized
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def _coerce_int(value: Any) -> int:
    numeric = _coerce_float(value)
    if numeric is None:
        return 0
    return max(0, int(round(numeric)))


def _restore_model(model_type: type[BaseModel], payload: Any) -> BaseModel | None:
    if isinstance(payload, model_type):
        return payload
    if isinstance(payload, dict):
        try:
            return model_type.model_validate(payload)
        except Exception:
            return None
    return None


class CommodityService:
    def __init__(
        self,
        cache_backend: Any = cache_instance,
        fetcher_factory: FetcherFactory = get_unified_fetcher,
        now_factory: NowFactory | None = None,
        *,
        quotes_ttl_seconds: int = 900,
        futures_ttl_seconds: int = 1800,
        seasonal_ttl_seconds: int = 43_200,
    ) -> None:
        self._cache = cache_backend
        self._fetcher_factory = fetcher_factory
        self._now_factory = now_factory or (lambda: datetime.now(timezone.utc))
        self._quotes_ttl_seconds = max(60, int(quotes_ttl_seconds))
        self._futures_ttl_seconds = max(300, int(futures_ttl_seconds))
        self._seasonal_ttl_seconds = max(3600, int(seasonal_ttl_seconds))

    def _now(self) -> datetime:
        value = self._now_factory()
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _cache_key(self, data_type: str, symbol: str, params: dict[str, Any] | None = None) -> str:
        return self._cache.build_key(data_type, symbol, params or {})

    def _commodity_for_symbol(self, symbol: str) -> CommodityDefinition:
        normalized = (symbol or "").strip().upper()
        if not normalized:
            raise ValueError("symbol is required")
        item = _DEFINITION_BY_SYMBOL.get(normalized) or _DEFINITION_BY_ROOT.get(normalized)
        if item is None:
            raise ValueError(f"Unsupported commodity symbol: {normalized}")
        return item

    def _quote_from_yahoo(self, item: CommodityDefinition, row: dict[str, Any]) -> CommodityQuote | None:
        price = _coerce_float(row.get("regularMarketPrice"))
        if price is None or price <= 0:
            return None
        previous_close = _coerce_float(row.get("regularMarketPreviousClose"))
        change = _coerce_float(row.get("regularMarketChange"))
        if previous_close is None and change is not None:
            previous_close = price - change
        if previous_close is None or previous_close <= 0:
            previous_close = price
        if change is None:
            change = price - previous_close
        change_pct = _coerce_float(row.get("regularMarketChangePercent"))
        if change_pct is None:
            change_pct = (change / previous_close) * 100.0 if previous_close else 0.0
        return CommodityQuote(
            symbol=item.yahoo_symbol,
            name=str(row.get("shortName") or row.get("longName") or item.name),
            category=item.category,
            price=round(price, 4),
            change=round(change, 4),
            change_pct=round(change_pct, 4),
            volume=_coerce_int(row.get("regularMarketVolume")),
            sparkline=self._build_sparkline(item.yahoo_symbol, price, previous_close),
            previous_close=round(previous_close, 4),
            currency=str(row.get("currency") or item.currency or "USD"),
            source="yahoo",
        )

    def _quote_from_fmp(self, item: CommodityDefinition, row: dict[str, Any]) -> CommodityQuote | None:
        price = _coerce_float(row.get("price"))
        if price is None or price <= 0:
            return None
        previous_close = _coerce_float(row.get("previousClose"))
        change = _coerce_float(row.get("change"))
        if previous_close is None and change is not None:
            previous_close = price - change
        if previous_close is None or previous_close <= 0:
            previous_close = price
        if change is None:
            change = price - previous_close
        change_pct = _coerce_float(row.get("changesPercentage"))
        if change_pct is None:
            change_pct = (change / previous_close) * 100.0 if previous_close else 0.0
        return CommodityQuote(
            symbol=item.yahoo_symbol,
            name=str(row.get("name") or item.name),
            category=item.category,
            price=round(price, 4),
            change=round(change, 4),
            change_pct=round(change_pct, 4),
            volume=_coerce_int(row.get("volume")),
            sparkline=self._build_sparkline(item.yahoo_symbol, price, previous_close),
            previous_close=round(previous_close, 4),
            currency=item.currency,
            source="fmp",
        )

    def _build_sparkline(self, symbol: str, price: float, previous_close: float) -> list[float]:
        if price <= 0:
            return []
        start = previous_close if previous_close > 0 else price
        amplitude = max(abs(price - start) * 0.12, price * 0.0025)
        seed = sum(ord(char) for char in symbol) % 11
        points: list[float] = []
        for index in range(7):
            progress = index / 6.0
            baseline = start + (price - start) * progress
            wiggle = math.sin(seed + index * 0.8) * amplitude
            if index in {0, 6}:
                wiggle = 0.0
            points.append(round(max(0.01, baseline + wiggle), 4))
        points[-1] = round(price, 4)
        return points

    async def _fetch_fmp_quote(self, fetcher: Any, item: CommodityDefinition) -> dict[str, Any]:
        fmp = getattr(fetcher, "fmp", None)
        if fmp is None:
            return {}
        getter = getattr(fmp, "_get", None)
        if callable(getter):
            payload = await getter(f"/quote/{item.fmp_symbol}")
            if isinstance(payload, list) and payload and isinstance(payload[0], dict):
                return payload[0]
            if isinstance(payload, dict):
                return payload
        getter = getattr(fmp, "get_quote", None)
        if callable(getter):
            payload = await getter(item.fmp_symbol)
            if isinstance(payload, list) and payload and isinstance(payload[0], dict):
                return payload[0]
            if isinstance(payload, dict):
                return payload
        return {}

    async def _fetch_fmp_history(self, fetcher: Any, item: CommodityDefinition) -> dict[str, Any]:
        fmp = getattr(fetcher, "fmp", None)
        if fmp is None:
            return {}
        getter = getattr(fmp, "_get", None)
        if callable(getter):
            payload = await getter(f"/historical-price-full/{item.fmp_symbol}")
            if isinstance(payload, dict):
                return payload
        getter = getattr(fmp, "get_historical_price_full", None)
        if callable(getter):
            payload = await getter(item.fmp_symbol)
            if isinstance(payload, dict):
                return payload
        return {}

    def _quotes_response_from_rows(self, rows: list[CommodityQuote]) -> CommodityQuotesResponse:
        groups: list[CommodityCategoryQuotes] = []
        for category in ("energy", "metals", "agriculture"):
            items = [row for row in rows if row.category == category]
            groups.append(
                CommodityCategoryQuotes(
                    id=category,
                    label=_CATEGORY_LABELS[category],
                    items=items,
                )
            )
        return CommodityQuotesResponse(as_of=self._now(), categories=groups)

    async def _fetch_live_quotes(self) -> CommodityQuotesResponse:
        fetcher = await self._fetcher_factory()
        yahoo_rows = await fetcher.yahoo.get_quotes([item.yahoo_symbol for item in _COMMODITIES])
        by_symbol = {
            str(row.get("symbol") or "").upper(): row
            for row in yahoo_rows
            if isinstance(row, dict)
        }

        quotes: list[CommodityQuote] = []
        missing: list[CommodityDefinition] = []
        for item in _COMMODITIES:
            quote = self._quote_from_yahoo(item, by_symbol.get(item.yahoo_symbol, {}))
            if quote is not None:
                quotes.append(quote)
            else:
                missing.append(item)

        if missing:
            fallback_rows = await asyncio.gather(
                *(self._fetch_fmp_quote(fetcher, item) for item in missing)
            )
            for item, payload in zip(missing, fallback_rows):
                quote = self._quote_from_fmp(item, payload if isinstance(payload, dict) else {})
                if quote is not None:
                    quotes.append(quote)

        if not quotes:
            raise RuntimeError("No commodity quotes available from Yahoo Finance or FMP")

        ordered_quotes = [
            next(quote for quote in quotes if quote.symbol == item.yahoo_symbol)
            for item in _COMMODITIES
            if any(quote.symbol == item.yahoo_symbol for quote in quotes)
        ]
        return self._quotes_response_from_rows(ordered_quotes)

    def _contract_schedule(self, item: CommodityDefinition, count: int = 6) -> list[_ContractRequest]:
        base_month = self._now().date().replace(day=1)
        schedule = [
            _ContractRequest(
                contract="Front",
                contract_symbol=item.yahoo_symbol,
                months_out=1,
                expiry=_month_end(_add_months(base_month, 1)),
            )
        ]
        for offset in range(1, count):
            delivery = _add_months(base_month, offset + 1)
            symbol = f"{item.root_symbol}{_MONTH_CODES[delivery.month]}{delivery.year % 100:02d}{item.exchange_suffix}"
            schedule.append(
                _ContractRequest(
                    contract=f"{month_abbr[delivery.month]} {delivery.year}",
                    contract_symbol=symbol,
                    months_out=offset + 1,
                    expiry=_month_end(delivery),
                )
            )
        return schedule

    def _chain_point_from_yahoo(
        self,
        request: _ContractRequest,
        row: dict[str, Any],
    ) -> CommodityFuturesPoint | None:
        price = _coerce_float(row.get("regularMarketPrice"))
        if price is None or price <= 0:
            return None
        previous_close = _coerce_float(row.get("regularMarketPreviousClose"))
        change = _coerce_float(row.get("regularMarketChange"))
        if previous_close is None and change is not None:
            previous_close = price - change
        if previous_close is None or previous_close <= 0:
            previous_close = price
        if change is None:
            change = price - previous_close
        change_pct = _coerce_float(row.get("regularMarketChangePercent"))
        if change_pct is None:
            change_pct = (change / previous_close) * 100.0 if previous_close else 0.0
        return CommodityFuturesPoint(
            contract=request.contract,
            contract_symbol=request.contract_symbol,
            months_out=request.months_out,
            expiry=request.expiry,
            price=round(price, 4),
            change=round(change, 4),
            change_pct=round(change_pct, 4),
            open_interest=_coerce_int(row.get("openInterest")),
            volume=_coerce_int(row.get("regularMarketVolume")),
            source="yahoo",
        )

    def _chain_point_from_fmp(
        self,
        request: _ContractRequest,
        row: dict[str, Any],
    ) -> CommodityFuturesPoint | None:
        price = _coerce_float(row.get("price"))
        if price is None or price <= 0:
            return None
        previous_close = _coerce_float(row.get("previousClose"))
        change = _coerce_float(row.get("change"))
        if previous_close is None and change is not None:
            previous_close = price - change
        if previous_close is None or previous_close <= 0:
            previous_close = price
        if change is None:
            change = price - previous_close
        change_pct = _coerce_float(row.get("changesPercentage"))
        if change_pct is None:
            change_pct = (change / previous_close) * 100.0 if previous_close else 0.0
        return CommodityFuturesPoint(
            contract=request.contract,
            contract_symbol=request.contract_symbol,
            months_out=request.months_out,
            expiry=request.expiry,
            price=round(price, 4),
            change=round(change, 4),
            change_pct=round(change_pct, 4),
            open_interest=0,
            volume=_coerce_int(row.get("volume")),
            source="fmp",
        )

    def _project_chain_point(
        self,
        request: _ContractRequest,
        base_point: CommodityFuturesPoint,
        curve_step: float,
    ) -> CommodityFuturesPoint:
        projected_price = max(0.01, base_point.price + curve_step * (request.months_out - 1))
        change = curve_step if request.months_out > 1 else base_point.change
        previous_close = projected_price - (change or 0.0)
        change_pct = (change / previous_close) * 100.0 if previous_close and change is not None else 0.0
        return CommodityFuturesPoint(
            contract=request.contract,
            contract_symbol=request.contract_symbol,
            months_out=request.months_out,
            expiry=request.expiry,
            price=round(projected_price, 4),
            change=round(change, 4) if change is not None else None,
            change_pct=round(change_pct, 4) if change_pct is not None else None,
            open_interest=max(0, int(base_point.open_interest / max(1, request.months_out))),
            volume=max(0, int(base_point.volume / max(1, request.months_out))),
            source="projected",
        )

    async def _fetch_live_futures_chain(self, item: CommodityDefinition) -> CommodityFuturesChainResponse:
        fetcher = await self._fetcher_factory()
        schedule = self._contract_schedule(item)
        yahoo_rows = await fetcher.yahoo.get_quotes([entry.contract_symbol for entry in schedule])
        by_symbol = {
            str(row.get("symbol") or "").upper(): row
            for row in yahoo_rows
            if isinstance(row, dict)
        }

        points_by_month: dict[int, CommodityFuturesPoint] = {}
        for entry in schedule:
            point = self._chain_point_from_yahoo(entry, by_symbol.get(entry.contract_symbol.upper(), {}))
            if point is not None:
                points_by_month[entry.months_out] = point

        source = "yahoo"
        front_point = points_by_month.get(1)
        if front_point is None:
            fmp_row = await self._fetch_fmp_quote(fetcher, item)
            front_point = self._chain_point_from_fmp(schedule[0], fmp_row)
            if front_point is not None:
                points_by_month[1] = front_point
                source = "fmp"

        if front_point is None:
            raise RuntimeError(f"No futures-chain data available for {item.yahoo_symbol}")

        ordered_actual = sorted(points_by_month.values(), key=lambda point: point.months_out)
        if len(ordered_actual) >= 2:
            first = ordered_actual[0]
            last = ordered_actual[-1]
            divisor = max(1, last.months_out - first.months_out)
            curve_step = (last.price - first.price) / divisor
        else:
            curve_step = item.curve_step

        points: list[CommodityFuturesPoint] = []
        for entry in schedule:
            point = points_by_month.get(entry.months_out)
            if point is None:
                point = self._project_chain_point(entry, front_point, curve_step)
                source = "mixed" if source == "yahoo" else source
            points.append(point)

        return CommodityFuturesChainResponse(
            symbol=item.yahoo_symbol,
            name=item.name,
            as_of=self._now(),
            source=source,
            points=points,
        )

    def _yahoo_monthly_closes(self, payload: dict[str, Any]) -> list[tuple[datetime, float]]:
        frame = _parse_yahoo_chart(payload if isinstance(payload, dict) else {})
        if frame.empty or "Close" not in frame:
            return []
        rows: list[tuple[datetime, float]] = []
        for index, row in frame.iterrows():
            close = _coerce_float(row.get("Close"))
            if close is None or close <= 0:
                continue
            dt = index.to_pydatetime()
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            rows.append((dt, close))
        return rows

    def _fmp_monthly_closes(self, payload: dict[str, Any]) -> list[tuple[datetime, float]]:
        rows = payload.get("historical") if isinstance(payload.get("historical"), list) else []
        monthly: dict[tuple[int, int], tuple[datetime, float]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            dt_text = str(row.get("date") or "").strip()
            close = _coerce_float(row.get("close"))
            if not dt_text or close is None or close <= 0:
                continue
            try:
                dt = datetime.fromisoformat(dt_text.replace("Z", "+00:00"))
            except ValueError:
                try:
                    dt = datetime.strptime(dt_text, "%Y-%m-%d")
                except ValueError:
                    continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)
            monthly[(dt.year, dt.month)] = (dt, close)
        return sorted(monthly.values(), key=lambda item: item[0])

    def _build_seasonal_response(
        self,
        item: CommodityDefinition,
        monthly_closes: list[tuple[datetime, float]],
        *,
        source: str,
    ) -> CommoditySeasonalResponse:
        years = len({dt.year for dt, _ in monthly_closes})
        if years < 5:
            raise RuntimeError(
                f"At least 5 years of monthly history are required for {item.yahoo_symbol}"
            )

        returns_by_month: dict[int, list[float]] = {index: [] for index in range(1, 13)}
        prices_by_month: dict[int, list[float]] = {index: [] for index in range(1, 13)}
        previous_close: float | None = None
        for dt, close in monthly_closes:
            prices_by_month[dt.month].append(close)
            if previous_close is not None and previous_close > 0:
                returns_by_month[dt.month].append(((close - previous_close) / previous_close) * 100.0)
            previous_close = close

        monthly = [
            CommoditySeasonalPoint(
                month=month_abbr[index],
                month_index=index,
                average_return_pct=round(
                    sum(returns_by_month[index]) / len(returns_by_month[index]),
                    4,
                )
                if returns_by_month[index]
                else 0.0,
                average_price=round(
                    sum(prices_by_month[index]) / len(prices_by_month[index]),
                    4,
                )
                if prices_by_month[index]
                else None,
                observations=len(prices_by_month[index]),
            )
            for index in range(1, 13)
        ]

        return CommoditySeasonalResponse(
            symbol=item.yahoo_symbol,
            name=item.name,
            as_of=self._now(),
            years=years,
            source=source,
            monthly=monthly,
        )

    async def _fetch_live_seasonal(self, item: CommodityDefinition) -> CommoditySeasonalResponse:
        fetcher = await self._fetcher_factory()
        yahoo_payload = await fetcher.yahoo.get_chart(item.yahoo_symbol, range_str="10y", interval="1mo")
        monthly_closes = self._yahoo_monthly_closes(yahoo_payload if isinstance(yahoo_payload, dict) else {})
        if len(monthly_closes) >= 60:
            return self._build_seasonal_response(item, monthly_closes, source="yahoo")

        fmp_payload = await self._fetch_fmp_history(fetcher, item)
        monthly_closes = self._fmp_monthly_closes(fmp_payload)
        if len(monthly_closes) >= 60:
            return self._build_seasonal_response(item, monthly_closes, source="fmp")

        raise RuntimeError(f"No seasonal history available for {item.yahoo_symbol}")

    async def get_quotes(self) -> CommodityQuotesResponse:
        cache_key = self._cache_key("commodities_quotes", "universe")
        stale_key = self._cache_key("commodities_quotes", "universe_stale")
        cached = _restore_model(CommodityQuotesResponse, await self._cache.get(cache_key))
        if isinstance(cached, CommodityQuotesResponse):
            return cached
        try:
            payload = await self._fetch_live_quotes()
        except Exception:
            stale = _restore_model(CommodityQuotesResponse, await self._cache.get(stale_key))
            if isinstance(stale, CommodityQuotesResponse):
                return stale
            raise
        await self._cache.set(cache_key, payload.model_dump(mode="python"), ttl=self._quotes_ttl_seconds)
        await self._cache.set(
            stale_key,
            payload.model_dump(mode="python"),
            ttl=max(self._quotes_ttl_seconds * 8, self._quotes_ttl_seconds),
        )
        return payload

    async def get_futures_chain(self, symbol: str) -> CommodityFuturesChainResponse:
        item = self._commodity_for_symbol(symbol)
        cache_key = self._cache_key("commodities_futures_chain", item.yahoo_symbol)
        stale_key = self._cache_key("commodities_futures_chain", f"{item.yahoo_symbol}_stale")
        cached = _restore_model(CommodityFuturesChainResponse, await self._cache.get(cache_key))
        if isinstance(cached, CommodityFuturesChainResponse):
            return cached
        try:
            payload = await self._fetch_live_futures_chain(item)
        except Exception:
            stale = _restore_model(CommodityFuturesChainResponse, await self._cache.get(stale_key))
            if isinstance(stale, CommodityFuturesChainResponse):
                return stale
            raise
        await self._cache.set(cache_key, payload.model_dump(mode="python"), ttl=self._futures_ttl_seconds)
        await self._cache.set(
            stale_key,
            payload.model_dump(mode="python"),
            ttl=max(self._futures_ttl_seconds * 8, self._futures_ttl_seconds),
        )
        return payload

    async def get_seasonal(self, symbol: str) -> CommoditySeasonalResponse:
        item = self._commodity_for_symbol(symbol)
        cache_key = self._cache_key("commodities_seasonal", item.yahoo_symbol)
        stale_key = self._cache_key("commodities_seasonal", f"{item.yahoo_symbol}_stale")
        cached = _restore_model(CommoditySeasonalResponse, await self._cache.get(cache_key))
        if isinstance(cached, CommoditySeasonalResponse):
            return cached
        try:
            payload = await self._fetch_live_seasonal(item)
        except Exception:
            stale = _restore_model(CommoditySeasonalResponse, await self._cache.get(stale_key))
            if isinstance(stale, CommoditySeasonalResponse):
                return stale
            raise
        await self._cache.set(cache_key, payload.model_dump(mode="python"), ttl=self._seasonal_ttl_seconds)
        await self._cache.set(
            stale_key,
            payload.model_dump(mode="python"),
            ttl=max(self._seasonal_ttl_seconds * 4, self._seasonal_ttl_seconds),
        )
        return payload


service = CommodityService()


def get_commodities_service() -> CommodityService:
    return service
