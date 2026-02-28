from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any

from backend.core.ttl_policy import market_open_now
from backend.api.deps import get_unified_fetcher
from backend.fno.services.greeks_engine import get_greeks_engine
from backend.shared.cache import cache as default_cache
from backend.shared.nse_session import NSESession
from backend.shared.symbol_resolver import SymbolResolver

INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}


class OptionChainFetcher:
    """Fetches and normalizes option chain data from NSE India."""

    def __init__(
        self,
        nse_session: NSESession | None = None,
        cache: Any = None,
        symbol_resolver: SymbolResolver | None = None,
    ) -> None:
        self._nse = nse_session or NSESession()
        self._cache = cache or default_cache
        self._resolver = symbol_resolver or SymbolResolver()
        self._greeks = get_greeks_engine()

    def _get_us_adapter(self):
        from backend.adapters.us_options_adapter import USOptionsAdapter
        return USOptionsAdapter()

    def _get_market_classifier(self):
        from backend.shared.market_classifier import market_classifier
        return market_classifier

    def _to_float(self, value: Any, default: float = 0.0) -> float:
        try:
            out = float(value)
            if out != out:
                return default
            return out
        except (TypeError, ValueError):
            return default

    def _to_int(self, value: Any, default: int = 0) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default

    def _as_iso_date(self, value: Any) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        try:
            return datetime.strptime(text, "%d-%b-%Y").date().isoformat()
        except Exception:
            pass
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
        except Exception:
            return text

    def _pick_expiry(self, available: list[str], expiry: str | None) -> str:
        if not available:
            return expiry or ""
        if expiry and expiry in available:
            return expiry
        today = date.today()
        future_sorted = sorted(available)
        for val in future_sorted:
            try:
                if date.fromisoformat(val) >= today:
                    return val
            except Exception:
                continue
        return future_sorted[0]

    def _option_path(self, symbol: str) -> str:
        symbol_u = (symbol or "").strip().upper()
        if symbol_u in INDEX_SYMBOLS or symbol_u.startswith("NIFTY"):
            return "/api/option-chain-indices"
        return "/api/option-chain-equities"

    def _find_atm(self, spot_price: float, strikes: list[dict[str, Any]]) -> float:
        if not strikes:
            return 0.0
        vals = [self._to_float(row.get("strike_price"), 0.0) for row in strikes]
        vals = [v for v in vals if v > 0]
        if not vals:
            return 0.0
        return min(vals, key=lambda x: abs(x - spot_price))

    def _days_to_expiry(self, expiry_iso: str) -> int:
        try:
            d = date.fromisoformat(expiry_iso)
            return max((d - date.today()).days, 1)
        except Exception:
            return 1

    def _normalize_leg(self, leg: dict[str, Any] | None, spot: float, strike: float, dte: int, option_type: str) -> dict[str, Any]:
        if not isinstance(leg, dict):
            return {
                "oi": 0,
                "oi_change": 0,
                "volume": 0,
                "iv": 0.0,
                "ltp": 0.0,
                "bid": 0.0,
                "ask": 0.0,
                "price_change": 0.0,
                "greeks": self._greeks.compute_greeks(spot, strike, dte, 0.0, option_type),
            }
        iv = self._to_float(leg.get("impliedVolatility"), 0.0)
        ltp = self._to_float(leg.get("lastPrice"), 0.0)
        if iv <= 0 and ltp > 0:
            iv = self._greeks.compute_iv(spot, strike, dte, ltp, option_type)
        return {
            "oi": self._to_int(leg.get("openInterest"), 0),
            "oi_change": self._to_int(leg.get("changeinOpenInterest"), 0),
            "volume": self._to_int(leg.get("totalTradedVolume"), 0),
            "iv": round(iv, 4),
            "ltp": round(ltp, 4),
            "bid": round(self._to_float(leg.get("bidprice"), 0.0), 4),
            "ask": round(self._to_float(leg.get("askPrice"), 0.0), 4),
            "price_change": round(self._to_float(leg.get("change"), 0.0), 4),
            "greeks": self._greeks.compute_greeks(spot, strike, dte, iv, option_type),
        }

    def _from_nse_records(self, symbol: str, raw: dict[str, Any], expiry: str | None, strike_range: int = 20) -> dict[str, Any]:
        records = raw.get("records") if isinstance(raw.get("records"), dict) else {}
        expiries_raw = records.get("expiryDates") if isinstance(records.get("expiryDates"), list) else []
        available = [self._as_iso_date(v) for v in expiries_raw if str(v).strip()]
        selected_expiry = self._pick_expiry(available, expiry)

        underlying_val = records.get("underlyingValue")
        if underlying_val is None and isinstance(raw.get("filtered"), dict):
            underlying_val = raw["filtered"].get("underlyingValue")
        spot = self._to_float(underlying_val, 0.0)

        data_rows = records.get("data") if isinstance(records.get("data"), list) else []
        normalized_rows: list[dict[str, Any]] = []
        dte = self._days_to_expiry(selected_expiry)
        for row in data_rows:
            if not isinstance(row, dict):
                continue
            row_expiry = self._as_iso_date(row.get("expiryDate"))
            if selected_expiry and row_expiry and row_expiry != selected_expiry:
                continue
            strike = self._to_float(row.get("strikePrice"), 0.0)
            if strike <= 0:
                continue
            ce_leg = row.get("CE") if isinstance(row.get("CE"), dict) else None
            pe_leg = row.get("PE") if isinstance(row.get("PE"), dict) else None
            normalized_rows.append(
                {
                    "strike_price": strike,
                    "ce": self._normalize_leg(ce_leg, spot, strike, dte, "CE"),
                    "pe": self._normalize_leg(pe_leg, spot, strike, dte, "PE"),
                }
            )

        normalized_rows.sort(key=lambda x: self._to_float(x.get("strike_price")))
        atm = self._find_atm(spot, normalized_rows)
        if normalized_rows and strike_range > 0:
            idx = min(range(len(normalized_rows)), key=lambda i: abs(self._to_float(normalized_rows[i]["strike_price"]) - atm))
            left = max(0, idx - strike_range)
            right = min(len(normalized_rows), idx + strike_range + 1)
            filtered_rows = normalized_rows[left:right]
        else:
            filtered_rows = normalized_rows

        ce_oi_total = sum(self._to_float((r.get("ce") or {}).get("oi")) for r in filtered_rows)
        pe_oi_total = sum(self._to_float((r.get("pe") or {}).get("oi")) for r in filtered_rows)
        ce_vol_total = sum(self._to_float((r.get("ce") or {}).get("volume")) for r in filtered_rows)
        pe_vol_total = sum(self._to_float((r.get("pe") or {}).get("volume")) for r in filtered_rows)

        ts = datetime.now(timezone.utc).isoformat()
        if isinstance(records.get("timestamp"), str) and records.get("timestamp"):
            try:
                ts = datetime.strptime(str(records["timestamp"]), "%d-%b-%Y %H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
            except Exception:
                ts = datetime.now(timezone.utc).isoformat()

        return {
            "symbol": symbol,
            "spot_price": round(spot, 4),
            "timestamp": ts,
            "expiry_date": selected_expiry,
            "available_expiries": sorted(set(available)),
            "atm_strike": atm,
            "strikes": filtered_rows,
            "totals": {
                "ce_oi_total": int(ce_oi_total),
                "pe_oi_total": int(pe_oi_total),
                "ce_volume_total": int(ce_vol_total),
                "pe_volume_total": int(pe_vol_total),
                "pcr_oi": round((pe_oi_total / ce_oi_total), 4) if ce_oi_total > 0 else 0.0,
                "pcr_volume": round((pe_vol_total / ce_vol_total), 4) if ce_vol_total > 0 else 0.0,
            },
        }

    def _fetch_with_nsepython(self, symbol: str) -> dict[str, Any] | None:
        try:
            from nsepython import option_chain  # type: ignore
        except Exception:
            return None
        try:
            out = option_chain(symbol)
            return out if isinstance(out, dict) else None
        except Exception:
            return None

    def _fetch_with_nse_api(self, symbol: str) -> dict[str, Any] | None:
        path = self._option_path(symbol)
        try:
            out = self._nse.get(path, {"symbol": symbol})
            return out if isinstance(out, dict) else None
        except Exception:
            return None

    def _fallback_spot_from_nsetools(self, symbol: str) -> float:
        try:
            from nsetools import Nse  # type: ignore

            nse = Nse()
            row = nse.get_quote(symbol)
            if isinstance(row, dict):
                for key in ("lastPrice", "ltp", "closePrice"):
                    val = self._to_float(row.get(key), 0.0)
                    if val > 0:
                        return val
        except Exception:
            return 0.0
        return 0.0

    async def _fallback_spot_from_kite(self, symbol: str) -> float:
        try:
            fetcher = await get_unified_fetcher()
            kite_token = fetcher.kite.resolve_access_token()
            if not (fetcher.kite.api_key and kite_token):
                return 0.0
            instrument = f"NSE:{symbol}"
            payload = await fetcher.kite.get_quote(kite_token, [instrument])
            data = payload.get("data") if isinstance(payload, dict) else {}
            row = data.get(instrument) if isinstance(data, dict) else None
            if isinstance(row, dict):
                return self._to_float(row.get("last_price"), 0.0)
        except Exception:
            return 0.0
        return 0.0

    async def get_option_chain(self, symbol: str, expiry: str | None = None, strike_range: int = 20) -> dict[str, Any]:
        """
        Fetch full option chain for an index or stock (NSE or US).
        """
        symbol_u = (symbol or "").strip().upper()
        if not symbol_u:
            return {
                "symbol": "",
                "spot_price": 0.0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "expiry_date": "",
                "available_expiries": [],
                "atm_strike": 0.0,
                "strikes": [],
                "totals": {"ce_oi_total": 0, "pe_oi_total": 0, "ce_volume_total": 0, "pe_volume_total": 0, "pcr_oi": 0.0, "pcr_volume": 0.0},
            }

        market_classifier = self._get_market_classifier()
        cls = await market_classifier.classify(symbol_u)
        is_us = cls.country_code == "US"

        cache_key = self._cache.build_key("fno_option_chain", symbol_u, {"expiry": expiry or "", "range": int(strike_range)})
        cached = await self._cache.get(cache_key)
        if cached:
            return cached

        if is_us:
            # US Logic
            us_adapter = self._get_us_adapter()
            if not expiry:
                expiries = await us_adapter.get_expiry_dates(symbol_u)
                expiry = self._pick_expiry(expiries, None)

            chain = await us_adapter.get_option_chain(symbol_u, expiry, strike_range)
            if not chain.get("available_expiries"):
                chain["available_expiries"] = await us_adapter.get_expiry_dates(symbol_u)
            chain["market"] = "US"
        else:
            # NSE Logic (Existing)
            raw = await asyncio.to_thread(self._fetch_with_nsepython, symbol_u)
            if not isinstance(raw, dict):
                raw = await asyncio.to_thread(self._fetch_with_nse_api, symbol_u)

            if isinstance(raw, dict):
                chain = self._from_nse_records(symbol_u, raw, expiry, strike_range)
            else:
                spot_fallback = await asyncio.to_thread(self._fallback_spot_from_nsetools, symbol_u)
                if spot_fallback <= 0:
                    spot_fallback = await self._fallback_spot_from_kite(symbol_u)
                chain = {
                    "symbol": symbol_u,
                    "spot_price": spot_fallback,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "expiry_date": expiry or "",
                    "available_expiries": [expiry] if expiry else [],
                    "atm_strike": 0.0,
                    "strikes": [],
                    "totals": {"ce_oi_total": 0, "pe_oi_total": 0, "ce_volume_total": 0, "pe_volume_total": 0, "pcr_oi": 0.0, "pcr_volume": 0.0},
                }
            chain["market"] = "NSE"

        # Add IV Rank and Percentile
        try:
            from backend.fno.services.iv_engine import get_iv_engine
            iv_engine = get_iv_engine()
            atm_iv = iv_engine._atm_iv(chain)
            iv_percentile, iv_rank = await iv_engine._iv_rank_percentile(symbol_u, atm_iv)
            chain["iv_rank"] = iv_rank
            chain["iv_percentile"] = iv_percentile
            chain["atm_iv"] = atm_iv
        except Exception:
            chain["iv_rank"] = 0.0
            chain["iv_percentile"] = 0.0
            chain["atm_iv"] = 0.0

        ttl = 60 if market_open_now() else 120
        await self._cache.set(cache_key, chain, ttl=ttl)
        return chain

    async def get_expiry_dates(self, symbol: str) -> list[str]:
        symbol_u = symbol.strip().upper()
        market_classifier = self._get_market_classifier()
        cls = await market_classifier.classify(symbol_u)
        if cls.country_code == "US":
            return await self._get_us_adapter().get_expiry_dates(symbol_u)

        chain = await self.get_option_chain(symbol_u, expiry=None, strike_range=40)
        expiries = chain.get("available_expiries")
        if not isinstance(expiries, list):
            return []
        return [str(v) for v in expiries if str(v).strip()]


_option_chain_fetcher = OptionChainFetcher()


def get_option_chain_fetcher() -> OptionChainFetcher:
    return _option_chain_fetcher
