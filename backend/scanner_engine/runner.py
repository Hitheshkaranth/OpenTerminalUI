from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from backend.api.routes.chart import _parse_yahoo_chart
from backend.core.unified_fetcher import UnifiedFetcher
from backend.scanner_engine.detectors import DETECTOR_MAP
from backend.scanner_engine.indicators import compute_indicator_pack
from backend.scanner_engine.ranking import rank_results
from backend.scanner_engine.schemas import ScanPresetBase

DATA_DIR = Path(__file__).resolve().parents[2] / "data"

_US_SP500_FALLBACK = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "GOOGL",
    "TSLA",
    "AVGO",
    "JPM",
    "LLY",
]

_US_NASDAQ100_FALLBACK = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "GOOGL",
    "TSLA",
    "NFLX",
    "AMD",
    "INTC",
]


@dataclass
class ScanRunBundle:
    summary: dict[str, Any]
    results: list[dict[str, Any]]


class ScannerRunner:
    def __init__(self, fetcher: UnifiedFetcher) -> None:
        self._fetcher = fetcher
        self._history_cache: dict[tuple[str, str], pd.DataFrame] = {}

    def resolve_universe(self, universe: str) -> list[str]:
        value = universe.strip().upper()
        nse_all = self._read_lines(DATA_DIR / "nse_equity_symbols_eq.txt")
        if value == "NSE:NIFTY50":
            return nse_all[:50]
        if value == "NSE:NIFTY100":
            return nse_all[:100]
        if value == "NSE:NIFTY200":
            return nse_all[:200]
        if value == "NSE:NIFTY500":
            return nse_all[:500]
        if value == "NSE:FNO":
            return nse_all[:200]
        if value == "US:SP500":
            return _US_SP500_FALLBACK
        if value == "US:NASDAQ100":
            return _US_NASDAQ100_FALLBACK
        if value.startswith("CUSTOM:"):
            return [x.strip().upper() for x in value.replace("CUSTOM:", "").split(",") if x.strip()]
        return nse_all[:200]

    async def run(self, preset: ScanPresetBase, symbol_cap: int | None = None, concurrency: int = 8) -> ScanRunBundle:
        all_symbols = self.resolve_universe(preset.universe)
        symbols = all_symbols[: max(1, symbol_cap)] if symbol_cap else all_symbols
        matches: list[dict[str, Any]] = []
        scanned = 0
        sem = asyncio.Semaphore(max(1, concurrency))

        async def _scan_symbol(symbol: str) -> tuple[int, list[dict[str, Any]]]:
            async with sem:
                frame = await self._load_history(symbol=symbol, timeframe=preset.timeframe)
            if frame is None or frame.empty:
                return 0, []
            enriched = compute_indicator_pack(frame)
            if not self._pass_liquidity(enriched, preset):
                return 0, []
            symbol_matches: list[dict[str, Any]] = []
            for rule in preset.rules:
                detector = DETECTOR_MAP.get(rule.type)
                if detector is None:
                    continue
                try:
                    payload = detector(enriched, **rule.params)
                except TypeError:
                    continue
                if not bool(payload.get("passed")) and str(payload.get("event_type") or "none") == "none":
                    continue
                trend_alignment = 1.0 if str(payload.get("trend_state") or "").lower() == "up" else 0.0
                breakout_level = float(payload.get("breakout_level") or 0.0)
                close = float(enriched["Close"].iloc[-1])
                breakout_strength = (close - breakout_level) / breakout_level if breakout_level else 0.0
                features = payload.get("features") if isinstance(payload.get("features"), dict) else {}
                features["trend_alignment"] = trend_alignment
                features["breakout_strength"] = breakout_strength
                features["atr_pct"] = float(enriched["atr_pct"].iloc[-1]) if not pd.isna(enriched["atr_pct"].iloc[-1]) else 0.0
                payload["features"] = features
                symbol_matches.append(
                    {
                        "symbol": symbol,
                        "setup_type": payload.get("setup_type") or rule.type,
                        "signal_ts": enriched.index[-1].to_pydatetime(),
                        "levels": payload.get("levels") if isinstance(payload.get("levels"), dict) else {},
                        "features": payload.get("features"),
                        "explain": {"steps": payload.get("explain_steps") or [], "event_type": payload.get("event_type")},
                        "trend_state": payload.get("trend_state"),
                        "signal_age": payload.get("signal_age"),
                        "rvol": float((payload.get("features") or {}).get("rvol") or 0.0),
                        "atr_pct": float((payload.get("features") or {}).get("atr_pct") or 0.0),
                        "breakout_level": payload.get("breakout_level"),
                        "distance_to_trigger": payload.get("distance_to_trigger"),
                        "event_type": payload.get("event_type", "none"),
                    }
                )
            return 1, symbol_matches

        scanned_rows = await asyncio.gather(*(_scan_symbol(symbol) for symbol in symbols))
        for scanned_flag, symbol_matches in scanned_rows:
            scanned += scanned_flag
            matches.extend(symbol_matches)

        ranked = rank_results(matches)
        summary = {
            "symbols_total": len(all_symbols),
            "symbols_scanned_batch": len(symbols),
            "symbols_scanned": scanned,
            "matches": len(ranked),
            "setups": sorted({str(r.get("setup_type") or "") for r in ranked}),
        }
        return ScanRunBundle(summary=summary, results=ranked)

    def _pass_liquidity(self, df: pd.DataFrame, preset: ScanPresetBase) -> bool:
        close = float(df["Close"].iloc[-1])
        avg_vol = float(df["avg_volume_20"].iloc[-1] or 0.0)
        avg_value = float(df["avg_traded_value_20"].iloc[-1] or 0.0)
        gate = preset.liquidity_gate
        return close >= gate.min_price and avg_vol >= gate.min_avg_volume and avg_value >= gate.min_avg_traded_value

    async def _load_history(self, symbol: str, timeframe: str) -> pd.DataFrame | None:
        key = (symbol, timeframe)
        if key in self._history_cache:
            return self._history_cache[key]
        try:
            raw = await self._fetcher.fetch_history(symbol, range_str="1y", interval=timeframe)
        except Exception:
            return None
        if not raw or "chart" not in raw:
            return None
        frame = _parse_yahoo_chart(raw)
        if frame.empty:
            return None
        frame = frame.sort_index()
        self._history_cache[key] = frame
        return frame

    @staticmethod
    def _read_lines(path: Path) -> list[str]:
        if not path.exists():
            return []
        return [line.strip().upper() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
