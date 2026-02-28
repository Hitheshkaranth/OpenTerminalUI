from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
import yfinance as yf
from backend.config.settings import get_settings
from backend.fno.services.greeks_engine import get_greeks_engine

logger = logging.getLogger(__name__)

class USOptionsAdapter:
    """Fetches and normalizes US option chain data using FMP or yfinance."""

    def __init__(self):
        self.settings = get_settings()
        self.fmp_key = self.settings.fmp_api_key
        self.greeks = get_greeks_engine()
        # US Risk-free rate is roughly 4.5% currently
        self.risk_free_rate = 4.5

    def _to_float(self, value: Any, default: float = 0.0) -> float:
        try:
            out = float(value)
            return default if out != out else out
        except (TypeError, ValueError):
            return default

    async def get_expiry_dates(self, symbol: str) -> List[str]:
        """Fetch available expiry dates for a US stock."""
        try:
            # Try yfinance first for expiries as it's reliable and free for this
            ticker = yf.Ticker(symbol)
            expiries = await asyncio.to_thread(lambda: ticker.options)
            return list(expiries)
        except Exception as e:
            logger.error(f"Error fetching US expiries for {symbol}: {e}")
            return []

    async def get_option_chain(self, symbol: str, expiry: str, strike_range: int = 20) -> Dict[str, Any]:
        """Fetch option chain for a specific symbol and expiry."""
        symbol = symbol.upper()

        # 1. Fetch Spot Price
        spot = 0.0
        try:
            ticker = yf.Ticker(symbol)
            info = await asyncio.to_thread(lambda: ticker.info)
            spot = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose") or 0.0
        except Exception as e:
            logger.error(f"Error fetching spot for {symbol}: {e}")

        # 2. Try FMP for chain
        chain_data = None
        if self.fmp_key:
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    url = f"https://financialmodelingprep.com/api/v4/option-chain/{symbol}"
                    resp = await client.get(url, params={"apikey": self.fmp_key})
                    if resp.status_code == 200:
                        raw_data = resp.json()
                        # FMP returns all expiries, filter for the one we want
                        chain_data = [opt for opt in raw_data if opt.get("expiration") == expiry]
            except Exception as e:
                logger.error(f"FMP US Options error for {symbol}: {e}")

        # 3. Fallback to yfinance if FMP failed or returned nothing
        if not chain_data:
            try:
                ticker = yf.Ticker(symbol)
                opt_chain = await asyncio.to_thread(lambda: ticker.option_chain(expiry))
                chain_data = self._from_yf_chain(opt_chain)
            except Exception as e:
                logger.error(f"yfinance US Options error for {symbol}: {e}")
                return self._empty_chain(symbol, expiry)

        if not chain_data:
            return self._empty_chain(symbol, expiry)

        return self._normalize_chain(symbol, spot, expiry, chain_data, strike_range)

    def _from_yf_chain(self, yf_chain: Any) -> List[Dict[str, Any]]:
        """Convert yfinance option chain object to a list of dicts."""
        combined = []
        for _, row in yf_chain.calls.iterrows():
            d = row.to_dict()
            d["type"] = "C"
            combined.append(d)
        for _, row in yf_chain.puts.iterrows():
            d = row.to_dict()
            d["type"] = "P"
            combined.append(d)
        return combined

    def _normalize_chain(self, symbol: str, spot: float, expiry: str, data: List[Dict[str, Any]], strike_range: int) -> Dict[str, Any]:
        grouped = {}
        dte = max((datetime.strptime(expiry, "%Y-%m-%d").date() - date.today()).days, 1)

        for opt in data:
            strike = self._to_float(opt.get("strike"))
            if strike not in grouped:
                grouped[strike] = {"strike_price": strike, "ce": self._empty_leg(), "pe": self._empty_leg()}

            # Detect type (FMP uses 'type' or yfinance format)
            opt_type = str(opt.get("type", opt.get("optionType", ""))).upper()
            if "CALL" in opt_type or opt_type == "C":
                key = "ce"
                mibian_type = "CE"
            else:
                key = "pe"
                mibian_type = "PE"

            # Normalize values
            iv = self._to_float(opt.get("impliedVolatility", 0.0))
            ltp = self._to_float(opt.get("lastPrice", opt.get("price", 0.0)))

            # Recalculate IV if missing/low using mibian if possible
            if iv <= 0 and ltp > 0:
                iv = self.greeks.compute_iv(spot, strike, dte, ltp, mibian_type)

            leg = {
                "oi": int(opt.get("openInterest", 0)),
                "oi_change": 0, # US sources don't always give daily OI change in chain
                "volume": int(opt.get("volume", 0)),
                "iv": round(iv, 4),
                "ltp": ltp,
                "bid": self._to_float(opt.get("bid")),
                "ask": self._to_float(opt.get("ask")),
                "price_change": self._to_float(opt.get("change")),
                "greeks": self.greeks.compute_greeks(spot, strike, dte, iv, mibian_type)
            }
            grouped[strike][key] = leg

        strikes = sorted(grouped.values(), key=lambda x: x["strike_price"])

        # Filter range
        if strikes and strike_range > 0:
            idx = min(range(len(strikes)), key=lambda i: abs(strikes[i]["strike_price"] - spot))
            left = max(0, idx - strike_range)
            right = min(len(strikes), idx + strike_range + 1)
            strikes = strikes[left:right]

        return {
            "symbol": symbol,
            "market": "US",
            "spot_price": spot,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "expiry_date": expiry,
            "available_expiries": [], # Caller should fill this or we fetch separately
            "atm_strike": self._find_atm(spot, strikes),
            "strikes": strikes,
            "totals": self._calculate_totals(strikes)
        }

    def _find_atm(self, spot: float, strikes: List[Dict[str, Any]]) -> float:
        if not strikes: return 0.0
        return min([s["strike_price"] for s in strikes], key=lambda x: abs(x - spot))

    def _calculate_totals(self, strikes: List[Dict[str, Any]]) -> Dict[str, Any]:
        ce_oi = sum(s["ce"]["oi"] for s in strikes)
        pe_oi = sum(s["pe"]["oi"] for s in strikes)
        ce_vol = sum(s["ce"]["volume"] for s in strikes)
        pe_vol = sum(s["pe"]["volume"] for s in strikes)
        return {
            "ce_oi_total": ce_oi,
            "pe_oi_total": pe_oi,
            "ce_volume_total": ce_vol,
            "pe_volume_total": pe_vol,
            "pcr_oi": round(pe_oi / ce_oi, 4) if ce_oi > 0 else 0.0,
            "pcr_volume": round(pe_vol / ce_vol, 4) if ce_vol > 0 else 0.0
        }

    def _empty_leg(self) -> Dict[str, Any]:
        return {
            "oi": 0, "oi_change": 0, "volume": 0, "iv": 0.0,
            "ltp": 0.0, "bid": 0.0, "ask": 0.0, "price_change": 0.0,
            "greeks": {"delta": 0, "gamma": 0, "theta": 0, "vega": 0, "rho": 0}
        }

    def _empty_chain(self, symbol: str, expiry: str) -> Dict[str, Any]:
        return {
            "symbol": symbol, "market": "US", "spot_price": 0.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "expiry_date": expiry, "available_expiries": [],
            "atm_strike": 0.0, "strikes": [],
            "totals": {"ce_oi_total": 0, "pe_oi_total": 0, "ce_volume_total": 0, "pe_volume_total": 0, "pcr_oi": 0.0, "pcr_volume": 0.0}
        }
