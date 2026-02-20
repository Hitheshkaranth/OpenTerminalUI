"""Futures analytics: term structure, basis, carry calculations."""
from __future__ import annotations

from datetime import date

from backend.adapters.base import FuturesContract


def compute_term_structure(
    contracts: list[FuturesContract], spot: float
) -> list[dict]:
    """Return term structure data points for charting."""
    today = date.today()
    points = []
    for c in sorted(contracts, key=lambda x: x.expiry):
        try:
            exp = date.fromisoformat(c.expiry)
        except ValueError:
            continue
        dte = max(1, (exp - today).days)
        basis = c.ltp - spot
        basis_pct = basis / spot * 100 if spot else 0
        annualized = basis_pct / dte * 365

        points.append(
            {
                "expiry": c.expiry,
                "price": c.ltp,
                "basis": round(basis, 2),
                "basis_pct": round(basis_pct, 3),
                "annualized_carry_pct": round(annualized, 2),
                "oi": c.oi,
                "volume": c.volume,
                "dte": dte,
            }
        )
    return points


def compute_basis_history(
    futures_candles: list[dict],
    spot_candles: list[dict],
) -> list[dict]:
    """Compute historical basis = futures_close − spot_close, aligned by timestamp."""
    spot_map = {c["t"]: c["c"] for c in spot_candles}
    history = []
    for fc in futures_candles:
        sc = spot_map.get(fc["t"])
        if sc is None or sc == 0:
            continue
        basis = fc["c"] - sc
        history.append(
            {
                "t": fc["t"],
                "basis": round(basis, 2),
                "basis_pct": round(basis / sc * 100, 3),
            }
        )
    return history
