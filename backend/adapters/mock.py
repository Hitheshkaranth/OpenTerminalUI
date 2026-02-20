"""Mock adapter for testing and demo mode — no external API calls."""
from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import mibian

from backend.adapters.base import (
    DataAdapter,
    FuturesContract,
    Instrument,
    OHLCV,
    OptionChain,
    OptionContract,
    QuoteResponse,
)


class MockDataAdapter(DataAdapter):
    """Generates deterministic-ish synthetic data for all instrument types."""

    SEED_PRICES = {
        "NSE:NIFTY 50": 22150.0,
        "NSE:INFY": 1820.0,
        "NSE:RELIANCE": 2950.0,
        "NSE:TCS": 4100.0,
        "NASDAQ:AAPL": 242.0,
        "NASDAQ:MSFT": 430.0,
        "AMEX:SPY": 590.0,
        "AMEX:QQQ": 510.0,
    }

    def __init__(self, seed: int = 42):
        self._rng = random.Random(seed)

    def _price(self, symbol: str) -> float:
        return self.SEED_PRICES.get(symbol.upper(), 100.0)

    async def get_quote(self, symbol: str) -> QuoteResponse:
        base = self._price(symbol)
        jitter = self._rng.gauss(0, base * 0.002)
        price = round(base + jitter, 2)
        change = round(jitter, 2)
        return QuoteResponse(
            symbol=symbol,
            price=price,
            change=change,
            change_pct=round(change / base * 100, 2),
            currency="INR" if symbol.upper().startswith("NSE") else "USD",
        )

    async def get_history(
        self, symbol: str, timeframe: str, start: date, end: date
    ) -> list[OHLCV]:
        base = self._price(symbol)
        days = max(1, (end - start).days)
        candles: list[OHLCV] = []
        price = base
        for i in range(days):
            dt = start + timedelta(days=i)
            if dt.weekday() >= 5:
                continue
            move = self._rng.gauss(0, base * 0.01)
            o = round(price, 2)
            h = round(price + abs(self._rng.gauss(0, base * 0.005)), 2)
            l = round(price - abs(self._rng.gauss(0, base * 0.005)), 2)
            c = round(price + move, 2)
            v = int(self._rng.uniform(1_000_000, 20_000_000))
            ts = int(datetime.combine(dt, time.min, tzinfo=timezone.utc).timestamp())
            candles.append(OHLCV(t=ts, o=o, h=h, l=l, c=c, v=v))
            price = c
        return candles

    async def search_instruments(self, query: str) -> list[Instrument]:
        q = query.upper()
        return [
            Instrument(symbol=sym, name=sym.split(":")[-1], exchange=sym.split(":")[0])
            for sym in self.SEED_PRICES
            if q in sym
        ]

    async def get_fundamentals(self, symbol: str) -> dict[str, Any]:
        return {
            "pe_ratio": round(self._rng.uniform(10, 40), 1),
            "pb_ratio": round(self._rng.uniform(1, 8), 1),
            "market_cap": int(self._rng.uniform(1e10, 5e12)),
            "roe": round(self._rng.uniform(5, 35), 1),
            "debt_equity": round(self._rng.uniform(0, 2), 2),
        }

    async def supports_streaming(self) -> bool:
        return False

    async def get_option_chain(
        self, underlying: str, expiry: date
    ) -> OptionChain:
        spot = self._price(f"NSE:{underlying}")
        dte = max(1, (expiry - date.today()).days)
        r = 0.065
        step = 50 if "NIFTY" in underlying.upper() else 100
        atm = round(spot / step) * step
        strikes = list(range(int(atm - 10 * step), int(atm + 11 * step), step))

        contracts: list[OptionContract] = []
        total_call_oi = 0
        total_put_oi = 0

        for strike in strikes:
            for opt_type in ("CE", "PE"):
                try:
                    bs = mibian.BS([spot, strike, r * 100, dte], volatility=16)
                    if opt_type == "CE":
                        price = bs.callPrice
                        delta = bs.callDelta
                        theta = bs.callTheta
                    else:
                        price = bs.putPrice
                        delta = bs.putDelta
                        theta = bs.putTheta

                    iv = 16 + self._rng.gauss(0, 1.5)
                    oi = int(self._rng.uniform(50_000, 5_000_000))
                    vol = int(self._rng.uniform(10_000, 2_000_000))

                    if opt_type == "CE":
                        total_call_oi += oi
                    else:
                        total_put_oi += oi

                    contracts.append(
                        OptionContract(
                            symbol=f"NFO:{underlying}{expiry.strftime('%y%b').upper()}{strike}{opt_type}",
                            underlying=underlying,
                            expiry=expiry.isoformat(),
                            strike=float(strike),
                            option_type=opt_type,
                            ltp=round(max(0.05, float(price or 0.0)), 2),
                            bid=round(max(0.05, float(price or 0.0) - 1), 2),
                            ask=round(float(price or 0.0) + 1, 2),
                            iv=round(max(5, iv), 1),
                            delta=round(float(delta or 0.0), 4),
                            gamma=round(float(bs.gamma or 0.0), 6),
                            theta=round(float(theta or 0.0), 2),
                            vega=round(float(bs.vega or 0.0), 2),
                            oi=oi,
                            oi_change=int(self._rng.uniform(-500_000, 500_000)),
                            volume=vol,
                            lot_size=25 if "NIFTY" in underlying.upper() else 15,
                        )
                    )
                except Exception:
                    continue

        pcr_oi = round(total_put_oi / max(1, total_call_oi), 2)
        max_pain = self._compute_max_pain(contracts, spot)

        return OptionChain(
            underlying=underlying,
            spot_price=spot,
            expiry=expiry.isoformat(),
            contracts=contracts,
            pcr_oi=pcr_oi,
            max_pain=max_pain,
            timestamp=date.today().isoformat(),
        )

    def _compute_max_pain(
        self, contracts: list[OptionContract], spot: float
    ) -> float:
        """Max pain = strike where total option buyer loss is maximized."""
        strikes = sorted(set(c.strike for c in contracts))
        min_pain = float("inf")
        max_pain_strike = spot

        for test_strike in strikes:
            total_pain = 0.0
            for c in contracts:
                if c.option_type in ("CE", "C"):
                    intrinsic = max(0, test_strike - c.strike)
                else:
                    intrinsic = max(0, c.strike - test_strike)
                total_pain += intrinsic * c.oi
            if total_pain < min_pain:
                min_pain = total_pain
                max_pain_strike = test_strike

        return max_pain_strike

    async def get_futures_chain(self, underlying: str) -> list[FuturesContract]:
        spot = self._price(f"NSE:{underlying}")
        today = date.today()
        contracts: list[FuturesContract] = []

        for months_ahead in (0, 1, 2):
            exp = today.replace(day=28) + timedelta(days=32 * months_ahead)
            exp = exp.replace(day=min(28, exp.day))
            dte = max(1, (exp - today).days)
            basis = spot * 0.065 * dte / 365
            fut_price = round(spot + basis, 2)

            contracts.append(
                FuturesContract(
                    symbol=f"NFO:{underlying}{exp.strftime('%y%b').upper()}FUT",
                    underlying=underlying,
                    expiry=exp.isoformat(),
                    ltp=fut_price,
                    basis=round(basis, 2),
                    basis_pct=round(basis / spot * 100, 3),
                    annualized_basis=round(basis / spot / dte * 365 * 100, 2),
                    oi=int(self._rng.uniform(1_000_000, 15_000_000)),
                    volume=int(self._rng.uniform(500_000, 8_000_000)),
                    lot_size=25 if "NIFTY" in underlying.upper() else 15,
                )
            )

        return contracts
