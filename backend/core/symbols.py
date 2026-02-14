from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Symbol:
    raw: str
    market: str
    canonical: str
    provider_symbol: str


def normalize_symbol(raw_symbol: str, market: str = "NSE") -> Symbol:
    raw = raw_symbol.strip().upper()
    market_norm = market.strip().upper() or "NSE"
    base = raw
    if base.endswith(".NS"):
        base = base[:-3]
    if base.endswith(".BO"):
        base = base[:-3]
    if "." in base and not base.startswith("^"):
        base = base.split(".", 1)[0]
    if market_norm == "NSE":
        provider_symbol = base if base.startswith("^") else f"{base}.NS"
    elif market_norm == "BSE":
        provider_symbol = base if base.startswith("^") else f"{base}.BO"
    else:
        provider_symbol = base
    return Symbol(
        raw=raw,
        market=market_norm,
        canonical=base,
        provider_symbol=provider_symbol,
    )
