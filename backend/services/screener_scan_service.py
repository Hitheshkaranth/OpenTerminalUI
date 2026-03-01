from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

import pandas as pd

SnapshotFetcher = Callable[[str], Awaitable[dict[str, Any]]]
HydrateRowsFetcher = Callable[[list[str], list[dict[str, str]], int], Awaitable[tuple[pd.DataFrame, int]]]
UniverseLoader = Callable[[str], list[str]]


def normalize_scan_row(row: dict[str, Any], *, exchange_hint: str | None = None, country_hint: str | None = None) -> dict[str, Any]:
    exchange = str(row.get("exchange") or row.get("market") or exchange_hint or "").strip().upper()
    if exchange not in {"NSE", "NYSE", "NASDAQ"}:
        exchange = exchange_hint or "NASDAQ"
    exchange = str(exchange).upper()
    country = str(row.get("country") or row.get("country_code") or country_hint or "").strip().upper()
    if not country:
        country = "IN" if exchange == "NSE" else "US"

    out = dict(row)
    out["exchange"] = exchange
    out["market"] = exchange
    out["country"] = country
    out["symbol"] = out.get("symbol") or out.get("ticker")
    out["pe_ratio"] = out.get("pe_ratio") if out.get("pe_ratio") is not None else out.get("pe")
    out["pb_ratio"] = out.get("pb_ratio") if out.get("pb_ratio") is not None else out.get("pb_calc")
    out["ps_ratio"] = out.get("ps_ratio") if out.get("ps_ratio") is not None else out.get("ps_calc")
    out["roe"] = out.get("roe") if out.get("roe") is not None else out.get("roe_pct")
    out["roa"] = out.get("roa") if out.get("roa") is not None else out.get("roa_pct")
    out["revenue_growth_yoy"] = (
        out.get("revenue_growth_yoy") if out.get("revenue_growth_yoy") is not None else out.get("rev_growth_pct")
    )
    out["earnings_growth_yoy"] = (
        out.get("earnings_growth_yoy") if out.get("earnings_growth_yoy") is not None else out.get("eps_growth_pct")
    )
    return out


def merge_scan_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        symbol = str(row.get("symbol") or row.get("ticker") or "").strip().upper()
        exchange = str(row.get("exchange") or row.get("market") or "").strip().upper()
        if not symbol or not exchange:
            continue
        deduped[(symbol, exchange)] = row
    return list(deduped.values())


@dataclass
class NSEScreenerAdapter:
    hydrate_rows: HydrateRowsFetcher
    load_universe: UniverseLoader
    universe_key: str = "nse_eq"
    universe_limit: int = 350
    refresh_cap: int = 60

    async def fetch(self, warnings: list[dict[str, str]]) -> list[dict[str, Any]]:
        symbols = self.load_universe(self.universe_key)[: self.universe_limit]
        nse_df, skipped = await self.hydrate_rows(symbols, warnings, self.refresh_cap)
        if skipped:
            warnings.append({"code": "nse_partial", "message": f"Skipped {skipped} NSE symbols during refresh"})
        if nse_df.empty:
            return []
        out: list[dict[str, Any]] = []
        for rec in nse_df.where(pd.notnull(nse_df), None).to_dict(orient="records"):
            out.append(normalize_scan_row(rec, exchange_hint="NSE", country_hint="IN"))
        return out


@dataclass
class FMPScreenerAdapter:
    snapshot_fetcher: SnapshotFetcher
    seed_symbols: list[str]
    max_concurrency: int = 8

    async def fetch(self, requested_markets: list[str]) -> list[dict[str, Any]]:
        sem = asyncio.Semaphore(max(1, self.max_concurrency))

        async def _fetch_one(symbol: str) -> Optional[dict[str, Any]]:
            async with sem:
                snap = await self.snapshot_fetcher(symbol)
                if not snap:
                    return None
                normalized = normalize_scan_row(dict(snap), exchange_hint="NASDAQ", country_hint="US")
                if normalized.get("exchange") not in requested_markets:
                    return None
                return normalized

        fetched = await asyncio.gather(*(_fetch_one(sym) for sym in self.seed_symbols))
        return [row for row in fetched if row is not None]
