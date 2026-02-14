from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher
from backend.shared.db import engine


class IVEngine:
    """Implied Volatility analysis and surface construction."""

    def __init__(self) -> None:
        self._fetcher = get_option_chain_fetcher()
        self._ensure_table()

    def _ensure_table(self) -> None:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS iv_snapshots (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        snapshot_date TEXT NOT NULL,
                        symbol TEXT NOT NULL,
                        atm_iv REAL NOT NULL,
                        created_at TEXT NOT NULL,
                        UNIQUE(snapshot_date, symbol)
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_iv_snapshots_symbol_date ON iv_snapshots(symbol, snapshot_date)"))

    def _to_float(self, value: Any, default: float = 0.0) -> float:
        try:
            out = float(value)
            if out != out:
                return default
            return out
        except (TypeError, ValueError):
            return default

    def _atm_iv(self, chain: dict[str, Any]) -> float:
        atm = self._to_float(chain.get("atm_strike"), 0.0)
        for row in chain.get("strikes", []) if isinstance(chain.get("strikes"), list) else []:
            if not isinstance(row, dict):
                continue
            if abs(self._to_float(row.get("strike_price"), 0.0) - atm) > 1e-9:
                continue
            ce_iv = self._to_float((row.get("ce") or {}).get("iv"), 0.0)
            pe_iv = self._to_float((row.get("pe") or {}).get("iv"), 0.0)
            vals = [v for v in [ce_iv, pe_iv] if v > 0]
            if vals:
                return round(sum(vals) / len(vals), 4)
        return 0.0

    async def _save_snapshot(self, symbol: str, atm_iv: float) -> None:
        day = date.today().isoformat()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO iv_snapshots(snapshot_date, symbol, atm_iv, created_at)
                    VALUES (:snapshot_date, :symbol, :atm_iv, :created_at)
                    ON CONFLICT(snapshot_date, symbol) DO UPDATE SET
                        atm_iv=excluded.atm_iv,
                        created_at=excluded.created_at
                    """
                ),
                {
                    "snapshot_date": day,
                    "symbol": symbol.upper(),
                    "atm_iv": float(atm_iv),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )

    async def _iv_rank_percentile(self, symbol: str, current_iv: float) -> tuple[float, float]:
        cutoff = (date.today() - timedelta(days=365)).isoformat()
        with engine.begin() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT atm_iv
                    FROM iv_snapshots
                    WHERE symbol = :symbol AND snapshot_date >= :cutoff
                    ORDER BY snapshot_date ASC
                    """
                ),
                {"symbol": symbol.upper(), "cutoff": cutoff},
            ).fetchall()
        vals = [self._to_float(row[0], 0.0) for row in rows if row and self._to_float(row[0], 0.0) > 0]
        if current_iv > 0:
            vals.append(current_iv)
        if not vals:
            return 0.0, 0.0
        low = min(vals)
        high = max(vals)
        iv_rank = ((current_iv - low) / (high - low) * 100.0) if high > low else 0.0
        pct = (sum(1 for v in vals if v <= current_iv) / len(vals)) * 100.0
        return round(max(0.0, min(100.0, pct)), 2), round(max(0.0, min(100.0, iv_rank)), 2)

    async def get_iv_data(self, symbol: str, expiry: str | None = None) -> dict[str, Any]:
        """
        IV for all strikes for a given expiry.
        """
        chain = await self._fetcher.get_option_chain(symbol, expiry=expiry, strike_range=40)
        spot = self._to_float(chain.get("spot_price"), 0.0)
        atm_iv = self._atm_iv(chain)
        await self._save_snapshot(str(chain.get("symbol") or symbol), atm_iv)
        iv_percentile, iv_rank = await self._iv_rank_percentile(str(chain.get("symbol") or symbol), atm_iv)

        skew = []
        for row in chain.get("strikes", []) if isinstance(chain.get("strikes"), list) else []:
            if not isinstance(row, dict):
                continue
            strike = self._to_float(row.get("strike_price"), 0.0)
            ce_iv = self._to_float((row.get("ce") or {}).get("iv"), 0.0)
            pe_iv = self._to_float((row.get("pe") or {}).get("iv"), 0.0)
            moneyness = ((strike - spot) / spot * 100.0) if spot > 0 else 0.0
            skew.append(
                {
                    "strike": strike,
                    "ce_iv": round(ce_iv, 4),
                    "pe_iv": round(pe_iv, 4),
                    "moneyness": round(moneyness, 2),
                }
            )

        return {
            "symbol": chain.get("symbol"),
            "expiry": chain.get("expiry_date"),
            "spot": spot,
            "atm_iv": atm_iv,
            "iv_skew": skew,
            "iv_percentile": iv_percentile,
            "iv_rank": iv_rank,
        }

    async def get_iv_surface(self, symbol: str) -> dict[str, Any]:
        """
        3D IV surface across strikes and expiries.
        """
        expiries = await self._fetcher.get_expiry_dates(symbol)
        expiries = expiries[:3]
        if not expiries:
            return {"symbol": symbol.strip().upper(), "expiries": [], "strikes": [], "surface": []}

        chains = [await self._fetcher.get_option_chain(symbol, expiry=exp, strike_range=25) for exp in expiries]
        strike_union: set[float] = set()
        for chain in chains:
            for row in chain.get("strikes", []) if isinstance(chain.get("strikes"), list) else []:
                if isinstance(row, dict):
                    strike_union.add(self._to_float(row.get("strike_price"), 0.0))
        strikes = sorted(v for v in strike_union if v > 0)

        surface: list[list[float]] = []
        for strike in strikes:
            row_vals: list[float] = []
            for chain in chains:
                iv_val = 0.0
                for item in chain.get("strikes", []) if isinstance(chain.get("strikes"), list) else []:
                    if not isinstance(item, dict):
                        continue
                    if abs(self._to_float(item.get("strike_price"), 0.0) - strike) > 1e-9:
                        continue
                    ce_iv = self._to_float((item.get("ce") or {}).get("iv"), 0.0)
                    pe_iv = self._to_float((item.get("pe") or {}).get("iv"), 0.0)
                    vals = [v for v in [ce_iv, pe_iv] if v > 0]
                    iv_val = round(sum(vals) / len(vals), 4) if vals else 0.0
                    break
                row_vals.append(iv_val)
            surface.append(row_vals)

        return {"symbol": symbol.strip().upper(), "expiries": expiries, "strikes": strikes, "surface": surface}


_iv_engine = IVEngine()


def get_iv_engine() -> IVEngine:
    return _iv_engine
