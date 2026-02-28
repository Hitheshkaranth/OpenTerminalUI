from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

from backend.api.deps import get_unified_fetcher
from backend.core.ttl_policy import market_open_now
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher
from backend.services.candle_aggregator import CandleAggregator
from backend.services.finnhub_ws import FinnhubWebSocket
from backend.services.instrument_map import get_instrument_map_service
from backend.services.kite_stream import KiteStreamAdapter
from backend.services.redis_quote_bus import get_quote_bus

logger = logging.getLogger(__name__)

SYMBOL_TOKEN_RE = re.compile(r"^(NSE|BSE|NFO|NYSE|NASDAQ):([A-Z0-9][A-Z0-9._-]{0,40})$")
US_MARKETS = {"NYSE", "NASDAQ"}
IN_MARKETS = {"NSE", "BSE", "NFO"}
NFO_OPTION_RE = re.compile(r"^([A-Z]+)\d{2}[A-Z]{3}(\d+)(CE|PE)$")
NFO_FUT_RE = re.compile(r"^([A-Z]+)\d{2}[A-Z]{3}FUT$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_tick_ts(value: Any) -> datetime:
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            pass
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except Exception:
            pass
    return datetime.now(timezone.utc)


def _to_float(value: Any) -> float | None:
    try:
        out = float(value)
        if out != out:
            return None
        return out
    except (TypeError, ValueError):
        return None


def _parse_symbol_token(token: str) -> tuple[str, str] | None:
    m = SYMBOL_TOKEN_RE.match((token or "").strip().upper())
    if not m:
        return None
    return m.group(1), m.group(2)


class MarketDataHub:
    def __init__(self, poll_interval_seconds: float = 2.0) -> None:
        self.poll_interval_seconds = poll_interval_seconds
        self._lock = asyncio.Lock()
        self._connections: dict[WebSocket, set[str]] = {}
        self._poll_task: asyncio.Task | None = None
        self._running = False
        self._instance_id = str(uuid.uuid4())
        self._is_aggregator = False
        self._lock_task: asyncio.Task | None = None

        self._instrument_map = get_instrument_map_service()
        self._kite_stream: KiteStreamAdapter | None = None
        self._stream_sync_lock = asyncio.Lock()
        self._stream_symbols_to_token: dict[str, int] = {}
        self._stream_token_to_symbol: dict[int, str] = {}
        self._nfo_fallback_poll_seconds = 30.0
        self._nfo_chain_last_fetch: dict[str, float] = {}
        self._nfo_quote_cache: dict[str, dict[str, Any]] = {}
        self._tick_listeners: list = []
        self._alert_connections: set[WebSocket] = set()
        self._candle_aggregator = CandleAggregator()
        self._finnhub_ws = FinnhubWebSocket(self._on_finnhub_trade)

        # Redis Quote Bus
        self._bus = get_quote_bus()
        self._bus.register_local_listener(self._on_bus_message)
        self._market_status_task: asyncio.Task | None = None

    async def start(self) -> None:
        async with self._lock:
            if self._running:
                return
            self._running = True

            # Connect to Redis
            await self._bus.connect()

            # Auto-subscribe to all supported markets
            for m in list(US_MARKETS) + list(IN_MARKETS):
                await self._bus.subscribe_market(m)

            self._poll_task = asyncio.create_task(self._poll_loop(), name="marketdata-hub-poll")
            self._lock_task = asyncio.create_task(self._aggregator_lock_loop(), name="aggregator-lock-loop")
            self._market_status_task = asyncio.create_task(self._market_status_loop(), name="market-status-loop")

        fetcher = await get_unified_fetcher()
        await self._instrument_map.initialize()
        await self._instrument_map.refresh_if_stale(fetcher.kite)

        self._kite_stream = KiteStreamAdapter(fetcher.kite, self._on_kite_tick)
        await self._kite_stream.start()
        await self._finnhub_ws.start()
        await self._sync_stream_subscriptions()
        logger.info("MarketDataHub started (Instance ID: %s)", self._instance_id)

    async def _aggregator_lock_loop(self):
        """Maintain aggregator status using distributed lock."""
        while self._running:
            try:
                if not self._is_aggregator:
                    self._is_aggregator = await self._bus.acquire_aggregator_lock(self._instance_id)
                    if self._is_aggregator:
                        logger.info("This instance (%s) is now the CANDLE AGGREGATOR", self._instance_id)
                else:
                    still_held = await self._bus.renew_aggregator_lock(self._instance_id)
                    if not still_held:
                        self._is_aggregator = False
                        logger.warning("Lost CANDLE AGGREGATOR lock")
            except Exception:
                logger.exception("Aggregator lock loop error")
            await asyncio.sleep(5)

    async def _on_bus_message(self, channel: str, payload: dict[str, Any]):
        """Handle incoming messages from Redis Bus (Ticks or Bars)."""
        if channel.startswith("quotes:"):
            symbol = payload.get("symbol")
            if symbol:
                # 1. Local Broadcast to connected WS clients
                await self.broadcast(symbol, payload)
                # 2. Emit to local tick listeners (e.g. alert engine) and process candles
                await self._emit_tick(payload)

        elif channel.startswith("bars:"):
            # Completed bar from aggregator via Redis — broadcast to clients on other instances
            symbol = payload.get("symbol")
            if symbol and not self._is_aggregator:
                # Aggregator already broadcast locally in _on_tick_for_candles; skip duplicate
                await self.broadcast(symbol, payload)

    async def shutdown(self) -> None:
        async with self._lock:
            self._running = False
            task = self._poll_task
            lock_task = self._lock_task
            status_task = self._market_status_task
            self._poll_task = None
            self._lock_task = None
            self._market_status_task = None
            sockets = list(self._connections.keys())
            alert_sockets = list(self._alert_connections)
            self._connections.clear()
            self._alert_connections.clear()
            self._stream_symbols_to_token.clear()
            self._stream_token_to_symbol.clear()
            self._nfo_chain_last_fetch.clear()
            self._nfo_quote_cache.clear()
            finnhub_ws = self._finnhub_ws

        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        if lock_task:
            lock_task.cancel()
            try:
                await lock_task
            except asyncio.CancelledError:
                pass

        if status_task:
            status_task.cancel()
            try:
                await status_task
            except asyncio.CancelledError:
                pass

        await self._bus.disconnect()

        if self._kite_stream:
            await self._kite_stream.stop()
            self._kite_stream = None
        if finnhub_ws:
            await finnhub_ws.stop()

        for ws in sockets:
            try:
                await ws.close()
            except Exception:
                pass
        for ws in alert_sockets:
            try:
                await ws.close()
            except Exception:
                pass

        logger.info("MarketDataHub stopped")

    async def register(self, websocket: WebSocket) -> None:
        await self.start()
        async with self._lock:
            self._connections.setdefault(websocket, set())
            logger.info("WS client connected: total=%s", len(self._connections))

    async def unregister(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(websocket, None)
            logger.info("WS client disconnected: total=%s", len(self._connections))
        await self._sync_stream_subscriptions()

    async def subscribe(self, websocket: WebSocket, symbols: list[str]) -> list[str]:
        accepted: list[str] = []
        async with self._lock:
            if websocket not in self._connections:
                return accepted
            bucket = self._connections[websocket]
            for raw in symbols:
                parsed = _parse_symbol_token(raw)
                if not parsed:
                    continue
                market, symbol = parsed
                token = f"{market}:{symbol}"
                bucket.add(token)
                accepted.append(token)
        await self._sync_stream_subscriptions()
        return accepted

    async def unsubscribe(self, websocket: WebSocket, symbols: list[str]) -> list[str]:
        removed: list[str] = []
        async with self._lock:
            if websocket not in self._connections:
                return removed
            bucket = self._connections[websocket]
            for raw in symbols:
                parsed = _parse_symbol_token(raw)
                if not parsed:
                    continue
                market, symbol = parsed
                token = f"{market}:{symbol}"
                if token in bucket:
                    bucket.remove(token)
                    removed.append(token)
        await self._sync_stream_subscriptions()
        return removed

    async def broadcast(self, symbol: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            targets = [(ws, subs) for ws, subs in self._connections.items() if symbol in subs]

        if not targets:
            return

        stale: list[WebSocket] = []
        for ws, _ in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)

        if stale:
            async with self._lock:
                for ws in stale:
                    self._connections.pop(ws, None)
            logger.debug("Dropped %s stale WS clients", len(stale))
            await self._sync_stream_subscriptions()

    async def broadcast_to_all(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._connections.keys())
        if not sockets:
            return
        stale: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        if stale:
            async with self._lock:
                for ws in stale:
                    self._connections.pop(ws, None)
            await self._sync_stream_subscriptions()

    async def _market_status_loop(self) -> None:
        from backend.api.routes.reports import market_status
        while self._running:
            try:
                # Fetch fresh market status (indices, market state, etc)
                status = await market_status()
                payload = {
                    "type": "market_status",
                    "data": status,
                    "ts": _now_iso()
                }
                await self.broadcast_to_all(payload)
            except Exception:
                logger.exception("Market status broadcast loop error")
            await asyncio.sleep(5.0)

    async def _broadcast_candle(self, symbol: str, interval: str, candle: dict[str, Any], status: str = "closed") -> None:
        await self.broadcast(
            symbol,
            {
                "type": "candle",
                "symbol": symbol,
                "interval": interval,
                "status": status,
                **candle,
            },
        )

    async def register_alert_socket(self, websocket: WebSocket) -> None:
        await self.start()
        async with self._lock:
            self._alert_connections.add(websocket)

    async def unregister_alert_socket(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._alert_connections.discard(websocket)

    async def broadcast_alert(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._alert_connections)
        stale: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        if stale:
            async with self._lock:
                for ws in stale:
                    self._alert_connections.discard(ws)

    def register_tick_listener(self, callback) -> None:
        if callback in self._tick_listeners:
            return
        self._tick_listeners.append(callback)

    async def _emit_tick(self, payload: dict[str, Any]) -> None:
        for callback in list(self._tick_listeners):
            try:
                result = callback(payload)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("Tick listener failed")
        await self._on_tick_for_candles(payload)

    async def _union_subscriptions(self) -> set[str]:
        async with self._lock:
            out: set[str] = set()
            for subs in self._connections.values():
                out.update(subs)
            return out

    async def metrics_snapshot(self) -> dict[str, int]:
        async with self._lock:
            all_subs: set[str] = set()
            for subs in self._connections.values():
                all_subs.update(subs)
            return {
                "ws_connected_clients": len(self._connections),
                "ws_subscriptions": len(all_subs),
            }

    def kite_stream_status(self) -> str:
        if not self._kite_stream:
            return "uninitialized"
        return self._kite_stream.last_status

    async def _sync_stream_subscriptions(self) -> None:
        if not self._kite_stream or not self._kite_stream.enabled:
            subscriptions = await self._union_subscriptions()
            us_symbols = {
                token.split(":", 1)[1]
                for token in subscriptions
                if ":" in token and token.split(":", 1)[0] in US_MARKETS
            }
            await self._finnhub_ws.set_symbols(us_symbols)
            return
        async with self._stream_sync_lock:
            subscriptions = await self._union_subscriptions()
            in_symbols = sorted(sym for sym in subscriptions if sym.split(":", 1)[0] in IN_MARKETS)
            mapping = await self._instrument_map.resolve_many(in_symbols)
            token_set = {int(t) for t in mapping.values()}
            await self._kite_stream.set_tokens(token_set)
            async with self._lock:
                self._stream_symbols_to_token = {k: int(v) for k, v in mapping.items()}
                self._stream_token_to_symbol = {int(v): k for k, v in mapping.items()}
            us_symbols = {
                token.split(":", 1)[1]
                for token in subscriptions
                if ":" in token and token.split(":", 1)[0] in US_MARKETS
            }
            await self._finnhub_ws.set_symbols(us_symbols)

    async def _poll_loop(self) -> None:
        try:
            while self._running:
                try:
                    tokens = await self._union_subscriptions()
                    stream_connected = bool(self._kite_stream and self._kite_stream.connected)
                    stream_symbols: set[str] = set()
                    if stream_connected:
                        async with self._lock:
                            stream_symbols = set(self._stream_symbols_to_token.keys())
                    if self._finnhub_ws.connected:
                        stream_symbols.update({t for t in tokens if t.split(":", 1)[0] in US_MARKETS})
                    poll_tokens = sorted(tokens - stream_symbols)
                    if poll_tokens:
                        ticks = await self._fetch_ticks(poll_tokens)
                        for token, tick in ticks.items():
                            tick["provider"] = "polling"
                            market = token.split(":", 1)[0]
                            await self._bus.publish_tick(market, tick)
                except Exception as exc:
                    logger.exception("MarketDataHub poll iteration failed: %s", exc)
                await asyncio.sleep(self.poll_interval_seconds)
        except asyncio.CancelledError:
            logger.debug("MarketDataHub poll loop cancelled")
            raise

    async def _on_kite_tick(self, tick: dict[str, Any]) -> None:
        token = tick.get("instrument_token")
        if not isinstance(token, int):
            return
        async with self._lock:
            symbol = self._stream_token_to_symbol.get(token)
        if not symbol:
            return

        ltp = _to_float(tick.get("last_price"))
        if ltp is None:
            return
        ohlc = tick.get("ohlc") if isinstance(tick.get("ohlc"), dict) else {}
        prev_close = _to_float(ohlc.get("close"))
        change = (ltp - prev_close) if prev_close not in (None, 0.0) else 0.0
        change_pct = ((change / prev_close) * 100.0) if prev_close not in (None, 0.0) else 0.0

        payload = {
            "type": "tick",
            "symbol": symbol,
            "ltp": ltp,
            "change": change,
            "change_pct": change_pct,
            "oi": _to_float(tick.get("oi")),
            "volume": _to_float(tick.get("volume") if tick.get("volume") is not None else tick.get("volume_traded")),
            "ts": _now_iso(),
            "provider": "kite",
        }
        market = symbol.split(":", 1)[0]
        await self._bus.publish_tick(market, payload)

    async def _on_finnhub_trade(self, raw_symbol: str, price: float, volume: float, ts_ms: int) -> None:
        symbol_candidates: set[str] = set()
        suffix = f":{raw_symbol.strip().upper()}"
        async with self._lock:
            for subs in self._connections.values():
                for token in subs:
                    if token.endswith(suffix) and token.split(":", 1)[0] in US_MARKETS:
                        symbol_candidates.add(token)
        if not symbol_candidates:
            symbol_candidates.add(f"NASDAQ:{raw_symbol.strip().upper()}")
        ts_iso = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).isoformat()
        for symbol_token in sorted(symbol_candidates):
            payload = {
                "type": "tick",
                "symbol": symbol_token,
                "ltp": float(price),
                "change": 0.0,
                "change_pct": 0.0,
                "oi": None,
                "volume": float(volume),
                "ts": ts_iso,
                "provider": "finnhub",
            }
            market = symbol_token.split(":", 1)[0]
            await self._bus.publish_tick(market, payload)

    async def _on_tick_for_candles(self, payload: dict[str, Any]) -> None:
        symbol = str(payload.get("symbol") or "").strip().upper()
        ltp = _to_float(payload.get("ltp"))
        if not symbol or ltp is None:
            return
        volume = _to_float(payload.get("volume")) or 0.0
        ts = _parse_tick_ts(payload.get("ts"))
        completed = self._candle_aggregator.on_tick(symbol, ltp, volume, ts)

        market = symbol.split(":", 1)[0]
        for sym, interval, candle in completed:
            # Broadcast closed candle to local WS clients immediately
            await self._broadcast_candle(sym, interval, candle, status="closed")
            # Only the aggregator publishes to Redis so other instances can pick it up
            if self._is_aggregator:
                bar_payload = {
                    "type": "candle",
                    "symbol": sym,
                    "interval": interval,
                    "status": "closed",
                    **candle,
                }
                await self._bus.publish_bar(market, interval, bar_payload)

        for sym, interval, candle in self._candle_aggregator.current_candles(symbol):
            await self._broadcast_candle(sym, interval, candle, status="partial")

    async def _fetch_ticks(self, tokens: list[str]) -> dict[str, dict[str, Any]]:
        fetcher = await get_unified_fetcher()
        by_market: dict[str, list[str]] = {}
        for token in tokens:
            parsed = _parse_symbol_token(token)
            if not parsed:
                continue
            market, symbol = parsed
            by_market.setdefault(market, []).append(symbol)

        out: dict[str, dict[str, Any]] = {}
        for market, symbols in by_market.items():
            quotes = await self._fetch_quotes_batch(fetcher, market, symbols)
            for row in quotes:
                symbol = str(row.get("symbol") or "").upper()
                ltp = _to_float(row.get("last"))
                if not symbol or ltp is None:
                    continue
                token = f"{market}:{symbol}"
                out[token] = {
                    "type": "tick",
                    "symbol": token,
                    "ltp": ltp,
                    "change": _to_float(row.get("change")) or 0.0,
                    "change_pct": _to_float(row.get("changePct")) or 0.0,
                    "oi": _to_float(row.get("oi")),
                    "volume": _to_float(row.get("volume")),
                    "ts": str(row.get("ts") or _now_iso()),
                }
        return out

    async def _fetch_quotes_batch(self, fetcher: Any, market: str, symbols: list[str]) -> list[dict[str, Any]]:
        now_iso = _now_iso()
        symbol_list = list(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))
        if not symbol_list:
            return []

        if market in US_MARKETS and fetcher.finnhub.api_key:
            payloads = await asyncio.gather(
                *(fetcher.finnhub.get_quote(symbol) for symbol in symbol_list),
                return_exceptions=True,
            )
            quotes: list[dict[str, Any]] = []
            for symbol, payload in zip(symbol_list, payloads):
                if isinstance(payload, Exception) or not isinstance(payload, dict):
                    continue
                last = _to_float(payload.get("c"))
                if last is None:
                    continue
                epoch = payload.get("t")
                ts_iso = now_iso
                if isinstance(epoch, (int, float)) and epoch > 0:
                    ts_iso = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
                quotes.append(
                    {
                        "symbol": symbol,
                        "last": last,
                        "change": _to_float(payload.get("d")) or 0.0,
                        "changePct": _to_float(payload.get("dp")) or 0.0,
                        "ts": ts_iso,
                    }
                )
            return quotes

        if market == "NFO":
            kite_token = fetcher.kite.resolve_access_token()
            if fetcher.kite.api_key and kite_token:
                instruments = [f"NFO:{symbol}" for symbol in symbol_list]
                data = await fetcher.kite.get_quote(kite_token, instruments)
                quote_map = data.get("data") if isinstance(data, dict) else {}
                quotes: list[dict[str, Any]] = []
                if isinstance(quote_map, dict):
                    for instrument, symbol in zip(instruments, symbol_list):
                        row = quote_map.get(instrument)
                        if not isinstance(row, dict):
                            continue
                        last = _to_float(row.get("last_price"))
                        if last is None:
                            continue
                        ohlc = row.get("ohlc") if isinstance(row.get("ohlc"), dict) else {}
                        close = _to_float(ohlc.get("close"))
                        change = (last - close) if close not in (None, 0.0) else 0.0
                        change_pct = ((change / close) * 100.0) if close not in (None, 0.0) else 0.0
                        quotes.append(
                            {
                                "symbol": symbol,
                                "last": last,
                                "change": change,
                                "changePct": change_pct,
                                "oi": _to_float(row.get("oi")),
                                "volume": _to_float(row.get("volume")),
                                "ts": now_iso,
                            }
                        )
                return quotes
            if market_open_now():
                return await self._fetch_nfo_fallback_quotes(fetcher, symbol_list, now_iso)
            return []

        if market in IN_MARKETS:
            suffix = ".NS" if market == "NSE" else ".BO"
            yahoo_symbols = [f"{symbol}{suffix}" for symbol in symbol_list]
            rows = await fetcher.yahoo.get_quotes(yahoo_symbols)
            quotes = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                raw_symbol = str(row.get("symbol") or "").upper()
                symbol = raw_symbol.replace(".NS", "").replace(".BO", "")
                last = _to_float(row.get("regularMarketPrice"))
                if symbol not in symbol_list or last is None:
                    continue
                epoch = row.get("regularMarketTime")
                ts_iso = now_iso
                if isinstance(epoch, (int, float)) and epoch > 0:
                    ts_iso = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
                quotes.append(
                    {
                        "symbol": symbol,
                        "last": last,
                        "change": _to_float(row.get("regularMarketChange")) or 0.0,
                        "changePct": _to_float(row.get("regularMarketChangePercent")) or 0.0,
                        "ts": ts_iso,
                    }
                )
            return quotes

        return []

    async def _fetch_nfo_fallback_quotes(self, fetcher: Any, symbols: list[str], now_iso: str) -> list[dict[str, Any]]:
        option_specs: dict[str, tuple[str, float, str]] = {}
        fut_underlyings: dict[str, set[str]] = {}
        for sym in symbols:
            m_opt = NFO_OPTION_RE.match(sym)
            if m_opt:
                underlying, strike_text, side = m_opt.groups()
                try:
                    strike = float(strike_text)
                except ValueError:
                    continue
                option_specs[sym] = (underlying, strike, side)
                continue
            m_fut = NFO_FUT_RE.match(sym)
            if m_fut:
                underlying = m_fut.group(1)
                fut_underlyings.setdefault(underlying, set()).add(sym)

        fetcher_chain = get_option_chain_fetcher()
        now_ts = time.time()
        by_underlying: dict[str, dict[str, Any]] = {}
        for _, (underlying, _, _) in option_specs.items():
            cached_at = self._nfo_chain_last_fetch.get(underlying, 0.0)
            if now_ts - cached_at >= self._nfo_fallback_poll_seconds:
                chain = await fetcher_chain.get_option_chain(underlying, strike_range=25)
                by_underlying[underlying] = chain
                self._nfo_chain_last_fetch[underlying] = now_ts
            else:
                by_underlying[underlying] = {}

        # Refresh option symbol cache from option chain snapshots.
        for sym, (underlying, strike, side) in option_specs.items():
            chain = by_underlying.get(underlying) or {}
            strikes = chain.get("strikes") if isinstance(chain.get("strikes"), list) else []
            leg = None
            for row in strikes:
                if not isinstance(row, dict):
                    continue
                if _to_float(row.get("strike_price")) != strike:
                    continue
                leg = row.get("ce") if side == "CE" else row.get("pe")
                break
            if isinstance(leg, dict):
                self._nfo_quote_cache[sym] = {
                    "symbol": sym,
                    "last": _to_float(leg.get("ltp")) or 0.0,
                    "change": _to_float(leg.get("price_change")) or 0.0,
                    "changePct": 0.0,
                    "oi": _to_float(leg.get("oi")),
                    "volume": _to_float(leg.get("volume")),
                    "ts": str(chain.get("timestamp") or now_iso),
                }

        # Approximate FUT ticks from underlying spot when kite stream is unavailable.
        for underlying, fut_symbols in fut_underlyings.items():
            suffix = ".NS"
            try:
                rows = await fetcher.yahoo.get_quotes([f"{underlying}{suffix}"])
            except Exception:
                rows = []
            last = None
            change = 0.0
            change_pct = 0.0
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                row = rows[0]
                last = _to_float(row.get("regularMarketPrice"))
                change = _to_float(row.get("regularMarketChange")) or 0.0
                change_pct = _to_float(row.get("regularMarketChangePercent")) or 0.0
            if last is None:
                continue
            for fut_sym in fut_symbols:
                self._nfo_quote_cache[fut_sym] = {
                    "symbol": fut_sym,
                    "last": last,
                    "change": change,
                    "changePct": change_pct,
                    "oi": None,
                    "volume": None,
                    "ts": now_iso,
                }

        out: list[dict[str, Any]] = []
        for sym in symbols:
            q = self._nfo_quote_cache.get(sym)
            if q:
                out.append(q)
        return out


_marketdata_hub = MarketDataHub()


def get_marketdata_hub() -> MarketDataHub:
    return _marketdata_hub
