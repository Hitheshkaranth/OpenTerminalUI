from __future__ import annotations

import asyncio
import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config.settings import get_settings
from backend.core.kite_client import KiteClient

logger = logging.getLogger(__name__)

SUPPORTED_EXCHANGES = {"NSE", "BSE", "NFO"}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sqlite_file_from_url(sqlite_url: str) -> Path:
    # Examples:
    # sqlite:///./backend/openterminalui.db
    # sqlite:////data/openterminalui.db
    if sqlite_url.startswith("sqlite:////"):
        return Path(sqlite_url.removeprefix("sqlite:////")).resolve()
    if sqlite_url.startswith("sqlite:///"):
        return Path(sqlite_url.removeprefix("sqlite:///")).resolve()
    if sqlite_url.startswith("sqlite://"):
        return Path(sqlite_url.removeprefix("sqlite://")).resolve()
    return Path("./backend/openterminalui.db").resolve()


@dataclass
class InstrumentRow:
    exchange: str
    symbol: str
    token: int
    tradingsymbol: str
    updated_at: str


class InstrumentMapService:
    def __init__(self) -> None:
        settings = get_settings()
        self.sqlite_path = _sqlite_file_from_url(settings.sqlite_url)
        self._init_lock = asyncio.Lock()
        self._ready = False

    async def initialize(self) -> None:
        async with self._init_lock:
            if self._ready:
                return
            self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(self._init_table)
            self._ready = True

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self.sqlite_path), check_same_thread=False)

    def _init_table(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS instrument_map (
                    exchange TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    token INTEGER NOT NULL,
                    tradingsymbol TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (exchange, symbol)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_instrument_map_token ON instrument_map (token)"
            )
            conn.commit()

    async def refresh_if_stale(self, kite_client: KiteClient, force: bool = False) -> bool:
        await self.initialize()
        is_stale = await asyncio.to_thread(self._is_stale)
        if not force and not is_stale:
            return True
        return await self._download_and_store(kite_client)

    def _is_stale(self) -> bool:
        with self._connect() as conn:
            row = conn.execute("SELECT MAX(updated_at) FROM instrument_map").fetchone()
            if not row or not row[0]:
                return True
            try:
                last = datetime.fromisoformat(str(row[0]))
            except ValueError:
                return True
            return last.date() != datetime.now(timezone.utc).date()

    async def _download_and_store(self, kite_client: KiteClient) -> bool:
        if not kite_client.api_key:
            logger.info("Instrument map refresh skipped: Kite API key is missing")
            return False
        access_token = kite_client.resolve_access_token()
        if not access_token:
            logger.info("Instrument map refresh skipped: Kite access token is missing")
            return False

        try:
            from kiteconnect import KiteConnect  # type: ignore
        except Exception as exc:
            logger.warning("Instrument map refresh skipped: kiteconnect unavailable (%s)", exc)
            return False

        def _fetch() -> list[InstrumentRow]:
            kc = KiteConnect(api_key=kite_client.api_key)
            kc.set_access_token(access_token)
            now_iso = _utc_now_iso()
            rows: list[InstrumentRow] = []
            for exchange in sorted(SUPPORTED_EXCHANGES):
                instruments = kc.instruments(exchange=exchange)
                for item in instruments:
                    symbol = str(item.get("tradingsymbol") or "").strip().upper()
                    token = item.get("instrument_token")
                    if not symbol or not isinstance(token, int):
                        continue
                    rows.append(
                        InstrumentRow(
                            exchange=exchange,
                            symbol=symbol,
                            token=token,
                            tradingsymbol=symbol,
                            updated_at=now_iso,
                        )
                    )
            return rows

        try:
            rows = await asyncio.to_thread(_fetch)
            if not rows:
                logger.warning("Instrument map refresh returned no rows")
                return False
            await asyncio.to_thread(self._replace_rows, rows)
            logger.info("Instrument map refreshed with %s rows", len(rows))
            return True
        except Exception as exc:
            logger.warning("Instrument map refresh failed: %s", exc)
            return False

    def _replace_rows(self, rows: list[InstrumentRow]) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM instrument_map")
            conn.executemany(
                """
                INSERT INTO instrument_map(exchange, symbol, token, tradingsymbol, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                [(r.exchange, r.symbol, r.token, r.tradingsymbol, r.updated_at) for r in rows],
            )
            conn.commit()

    async def resolve_many(self, symbols: list[str]) -> dict[str, int]:
        await self.initialize()
        return await asyncio.to_thread(self._resolve_many, symbols)

    def _resolve_many(self, symbols: list[str]) -> dict[str, int]:
        out: dict[str, int] = {}
        parsed: list[tuple[str, str, str]] = []
        for token in symbols:
            raw = (token or "").strip().upper()
            if ":" not in raw:
                continue
            exchange, symbol = raw.split(":", 1)
            if exchange not in SUPPORTED_EXCHANGES or not symbol:
                continue
            parsed.append((raw, exchange, symbol))
        if not parsed:
            return out

        with self._connect() as conn:
            for full, exchange, symbol in parsed:
                row = conn.execute(
                    "SELECT token FROM instrument_map WHERE exchange = ? AND symbol = ?",
                    (exchange, symbol),
                ).fetchone()
                if row and isinstance(row[0], int):
                    out[full] = row[0]
        return out

    async def symbol_by_token_many(self, tokens: list[int]) -> dict[int, str]:
        await self.initialize()
        return await asyncio.to_thread(self._symbol_by_token_many, tokens)

    def _symbol_by_token_many(self, tokens: list[int]) -> dict[int, str]:
        if not tokens:
            return {}
        unique_tokens = sorted({int(t) for t in tokens if isinstance(t, int)})
        if not unique_tokens:
            return {}
        placeholders = ",".join("?" for _ in unique_tokens)
        out: dict[int, str] = {}
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT exchange, symbol, token FROM instrument_map WHERE token IN ({placeholders})",
                tuple(unique_tokens),
            ).fetchall()
            for exchange, symbol, token in rows:
                if isinstance(exchange, str) and isinstance(symbol, str) and isinstance(token, int):
                    out[token] = f"{exchange.upper()}:{symbol.upper()}"
        return out


_instrument_map_service = InstrumentMapService()


def get_instrument_map_service() -> InstrumentMapService:
    return _instrument_map_service
