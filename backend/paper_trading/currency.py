"""Currency identity and dated FX conversion for paper cash and valuations."""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from backend.agent.tools.sizing_tools import _number, _symbol_identity

CURRENCIES = {"INR", "USD", "EUR", "GBP", "JPY", "HKD", "AUD", "CAD", "CHF", "SGD"}
EXCHANGES = {"NSE": "INR", "BSE": "INR", "NYSE": "USD", "NASDAQ": "USD", "AMEX": "USD",
             "LSE": "GBP", "TSE": "JPY", "HKSE": "HKD", "ASX": "AUD", "TSX": "CAD",
             "XETRA": "EUR", "EURONEXT": "EUR"}


def validate_currency(value: object) -> str:
    if not isinstance(value, str) or value not in CURRENCIES:
        raise ValueError("Unsupported paper base currency")
    return value


def quote_currency(symbol: str, provenance: dict, base_currency: str) -> str:
    exchange, _ = _symbol_identity(symbol)
    explicit = EXCHANGES.get(exchange)
    reported = provenance.get("currency")
    if reported:
        reported = validate_currency(reported)
        if explicit and reported != explicit:
            raise ValueError(f"Conflicting quote currency for {symbol}")
        return reported
    if explicit:
        return explicit
    if exchange:
        raise ValueError(f"Unknown exchange currency for {symbol}")
    # Bare symbols preserve the existing paper-book convention. International
    # exposure must use explicit exchange-qualified symbols or provider currency.
    return base_currency


def validate_quote_source(source: dict, max_age: float, *, symbol: str) -> None:
    if source.get("quality") not in {"live", "delayed", "cached"} or source.get("source") in {"mock", "synthetic", None}:
        raise ValueError(f"Usable quote provenance required for {symbol}")
    try:
        stamp = datetime.fromisoformat(source["as_of"].replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - stamp).total_seconds()
        if age < -60 or age > max_age:
            raise ValueError(f"Quote for {symbol} is stale or future-dated")
    except (KeyError, TypeError, AttributeError) as exc:
        raise ValueError(f"Dated quote required for {symbol}") from exc


async def convert_marked_prices(prices: dict[str, Decimal], sources: dict, base: str,
                                max_age: float, fetch_marks) -> tuple[dict, dict]:
    """Convert each quote into base units with direct, source-dated FX evidence."""
    validate_currency(base)
    currencies = {s: quote_currency(s, sources.get(s, {}), base) for s in prices}
    pairs = sorted({f"{currency}{base}=X" for currency in currencies.values() if currency != base})
    fx_prices, fx_sources = await fetch_marks(pairs) if pairs else ({}, {})
    evidence = {}
    converted = {}
    for symbol, price in prices.items():
        currency = currencies[symbol]
        pair = f"{currency}{base}=X"
        rate = Decimal(1)
        source = None
        if currency != base:
            rate = _number(fx_prices.get(pair), f"FX {pair}")
            source = fx_sources.get(pair, {})
            validate_quote_source(source, max_age, symbol=pair)
        converted[symbol] = price * rate
        evidence[symbol] = {"quote_currency": currency, "base_currency": base, "rate": float(rate),
                            "pair": pair if currency != base else None, "provenance": source}
    return converted, evidence


def require_verified_foreign_basis(db, portfolio_id: str, symbols: list[str]) -> None:
    """Never silently reinterpret legacy native-currency cost bases as base units."""
    from backend.models import VirtualOrder, VirtualPosition
    for symbol in symbols:
        position = db.query(VirtualPosition).filter_by(portfolio_id=portfolio_id, symbol=symbol).first()
        if position is None or not position.quantity:
            continue
        buys = db.query(VirtualOrder).filter_by(portfolio_id=portfolio_id, symbol=symbol,
                                               side="buy", status="filled").all()
        if not buys or any(not ((order.signal_metadata or {}).get("fill_preflight") or {}).get("fx", {}).get(symbol) for order in buys):
            raise ValueError("Legacy foreign position cost basis requires reconciliation in a new paper book; historical FX is not fabricated")
