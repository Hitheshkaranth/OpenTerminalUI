from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from backend.fno.services.oi_analyzer import get_oi_analyzer
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher
from backend.shared.db import engine


class PCRTracker:
    """Tracks Put-Call Ratio trends over time."""

    DEFAULT_SYMBOLS = [
        "NIFTY",
        "BANKNIFTY",
        "RELIANCE",
        "TCS",
        "INFY",
        "HDFCBANK",
        "ICICIBANK",
        "SBIN",
        "LT",
        "AXISBANK",
        "KOTAKBANK",
        "ITC",
        "BAJFINANCE",
        "MARUTI",
        "TATAMOTORS",
        "BHARTIARTL",
        "SUNPHARMA",
        "HCLTECH",
        "WIPRO",
        "ADANIPORTS",
        "NTPC",
        "ONGC",
    ]

    def __init__(self) -> None:
        self._fetcher = get_option_chain_fetcher()
        self._analyzer = get_oi_analyzer()
        self._ensure_table()

    def _ensure_table(self) -> None:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS pcr_snapshots (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        snapshot_date TEXT NOT NULL,
                        symbol TEXT NOT NULL,
                        pcr_oi REAL NOT NULL,
                        pcr_vol REAL NOT NULL,
                        total_ce_oi REAL NOT NULL,
                        total_pe_oi REAL NOT NULL,
                        created_at TEXT NOT NULL,
                        UNIQUE(snapshot_date, symbol)
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_pcr_snapshots_symbol_date ON pcr_snapshots(symbol, snapshot_date)"))

    async def get_current_pcr(self, symbol: str, expiry: str | None = None) -> dict[str, Any]:
        """Current PCR (OI-based and volume-based) with signal."""
        chain = await self._fetcher.get_option_chain(symbol, expiry=expiry, strike_range=20)
        pcr = self._analyzer.get_pcr(chain)
        totals = chain.get("totals") if isinstance(chain.get("totals"), dict) else {}
        return {
            "symbol": chain.get("symbol"),
            "expiry_date": chain.get("expiry_date"),
            "timestamp": chain.get("timestamp"),
            "pcr_oi": pcr.get("pcr_oi", 0.0),
            "pcr_vol": pcr.get("pcr_volume", 0.0),
            "pcr_oi_change": pcr.get("pcr_oi_change", 0.0),
            "signal": pcr.get("signal", "Neutral"),
            "total_ce_oi": totals.get("ce_oi_total", 0),
            "total_pe_oi": totals.get("pe_oi_total", 0),
        }

    async def get_pcr_by_strike(self, symbol: str, expiry: str | None = None) -> list[dict[str, Any]]:
        """PCR at each individual strike."""
        chain = await self._fetcher.get_option_chain(symbol, expiry=expiry, strike_range=50)
        out: list[dict[str, Any]] = []
        for row in chain.get("strikes", []) if isinstance(chain.get("strikes"), list) else []:
            if not isinstance(row, dict):
                continue
            ce = row.get("ce") if isinstance(row.get("ce"), dict) else {}
            pe = row.get("pe") if isinstance(row.get("pe"), dict) else {}
            ce_oi = float(ce.get("oi") or 0.0)
            pe_oi = float(pe.get("oi") or 0.0)
            ce_vol = float(ce.get("volume") or 0.0)
            pe_vol = float(pe.get("volume") or 0.0)
            out.append(
                {
                    "strike": row.get("strike_price"),
                    "ce_oi": ce_oi,
                    "pe_oi": pe_oi,
                    "pcr_oi": round((pe_oi / ce_oi), 4) if ce_oi > 0 else 0.0,
                    "ce_vol": ce_vol,
                    "pe_vol": pe_vol,
                    "pcr_vol": round((pe_vol / ce_vol), 4) if ce_vol > 0 else 0.0,
                }
            )
        return out

    async def store_snapshot(self, symbol: str, expiry: str | None = None, snapshot_date: str | None = None) -> dict[str, Any]:
        snapshot_day = snapshot_date or date.today().isoformat()
        current = await self.get_current_pcr(symbol, expiry=expiry)
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO pcr_snapshots(snapshot_date, symbol, pcr_oi, pcr_vol, total_ce_oi, total_pe_oi, created_at)
                    VALUES (:snapshot_date, :symbol, :pcr_oi, :pcr_vol, :total_ce_oi, :total_pe_oi, :created_at)
                    ON CONFLICT(snapshot_date, symbol) DO UPDATE SET
                        pcr_oi=excluded.pcr_oi,
                        pcr_vol=excluded.pcr_vol,
                        total_ce_oi=excluded.total_ce_oi,
                        total_pe_oi=excluded.total_pe_oi,
                        created_at=excluded.created_at
                    """
                ),
                {
                    "snapshot_date": snapshot_day,
                    "symbol": str(current.get("symbol") or symbol).upper(),
                    "pcr_oi": float(current.get("pcr_oi") or 0.0),
                    "pcr_vol": float(current.get("pcr_vol") or 0.0),
                    "total_ce_oi": float(current.get("total_ce_oi") or 0.0),
                    "total_pe_oi": float(current.get("total_pe_oi") or 0.0),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            )
        return current

    async def seed_history_from_bhavcopy(self, symbol: str, days: int = 30) -> None:
        """Best-effort history seeding from nsepython bhavcopy helper."""
        try:
            import nsepython  # type: ignore
        except Exception:
            return

        nsefin = getattr(nsepython, "nsefin", None)
        get_fn = getattr(nsefin, "get_fno_bhav_copy", None) if nsefin is not None else None
        if not callable(get_fn):
            return

        end = date.today()
        start = end - timedelta(days=max(days, 1))
        try:
            rows = get_fn(start.strftime("%d-%m-%Y"), end.strftime("%d-%m-%Y"))
        except Exception:
            return
        if not isinstance(rows, list):
            return

        daily: dict[str, dict[str, float]] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sym = str(row.get("SYMBOL") or "").upper()
            if sym != symbol.upper():
                continue
            d = str(row.get("TIMESTAMP") or "")
            try:
                d_iso = datetime.strptime(d, "%d-%b-%Y").date().isoformat()
            except Exception:
                continue
            inst = str(row.get("INSTRUMENT") or "").upper()
            oi = float(row.get("OPEN_INT") or 0.0)
            vol = float(row.get("CONTRACTS") or 0.0)
            slot = daily.setdefault(d_iso, {"ce_oi": 0.0, "pe_oi": 0.0, "ce_vol": 0.0, "pe_vol": 0.0})
            if inst.endswith("CE"):
                slot["ce_oi"] += oi
                slot["ce_vol"] += vol
            elif inst.endswith("PE"):
                slot["pe_oi"] += oi
                slot["pe_vol"] += vol

        with engine.begin() as conn:
            for day, vals in daily.items():
                ce_oi = vals["ce_oi"]
                pe_oi = vals["pe_oi"]
                ce_vol = vals["ce_vol"]
                pe_vol = vals["pe_vol"]
                conn.execute(
                    text(
                        """
                        INSERT INTO pcr_snapshots(snapshot_date, symbol, pcr_oi, pcr_vol, total_ce_oi, total_pe_oi, created_at)
                        VALUES (:snapshot_date, :symbol, :pcr_oi, :pcr_vol, :total_ce_oi, :total_pe_oi, :created_at)
                        ON CONFLICT(snapshot_date, symbol) DO NOTHING
                        """
                    ),
                    {
                        "snapshot_date": day,
                        "symbol": symbol.upper(),
                        "pcr_oi": (pe_oi / ce_oi) if ce_oi > 0 else 0.0,
                        "pcr_vol": (pe_vol / ce_vol) if ce_vol > 0 else 0.0,
                        "total_ce_oi": ce_oi,
                        "total_pe_oi": pe_oi,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    },
                )

    async def get_pcr_history(self, symbol: str, days: int = 30) -> list[dict[str, Any]]:
        """
        Historical PCR values.
        """
        self._ensure_table()
        symbol_u = symbol.strip().upper()
        cutoff = (date.today() - timedelta(days=max(days, 1) - 1)).isoformat()
        with engine.begin() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT snapshot_date, pcr_oi, pcr_vol
                    FROM pcr_snapshots
                    WHERE symbol = :symbol AND snapshot_date >= :cutoff
                    ORDER BY snapshot_date ASC
                    """
                ),
                {"symbol": symbol_u, "cutoff": cutoff},
            ).fetchall()

        if not rows:
            await self.seed_history_from_bhavcopy(symbol_u, days=days)
            with engine.begin() as conn:
                rows = conn.execute(
                    text(
                        """
                        SELECT snapshot_date, pcr_oi, pcr_vol
                        FROM pcr_snapshots
                        WHERE symbol = :symbol AND snapshot_date >= :cutoff
                        ORDER BY snapshot_date ASC
                        """
                    ),
                    {"symbol": symbol_u, "cutoff": cutoff},
                ).fetchall()

        if not rows:
            current = await self.store_snapshot(symbol_u)
            rows = [(date.today().isoformat(), current.get("pcr_oi", 0.0), current.get("pcr_vol", 0.0))]

        out = []
        for row in rows:
            day = str(row[0])
            pcr_oi = float(row[1] or 0.0)
            pcr_vol = float(row[2] or 0.0)
            signal = "Bullish" if pcr_oi > 1.0 else ("Bearish" if pcr_oi < 0.7 else "Neutral")
            out.append({"date": day, "pcr_oi": round(pcr_oi, 4), "pcr_vol": round(pcr_vol, 4), "signal": signal})
        return out

    def snapshot_universe(self) -> list[str]:
        return list(self.DEFAULT_SYMBOLS)


_pcr_tracker = PCRTracker()


def get_pcr_tracker() -> PCRTracker:
    return _pcr_tracker
