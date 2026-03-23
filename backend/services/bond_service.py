from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.shared.cache import cache

logger = logging.getLogger(__name__)

class BondService:
    def __init__(self):
        # In a real app, this might connect to RBI, FRED, or a paid data provider
        pass

    async def get_bond_screener(
        self,
        maturity_min: Optional[float] = None,
        maturity_max: Optional[float] = None,
        rating: Optional[str] = None,
        issuer_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Filterable bond screener data."""
        # Mock data for demonstration
        bonds = [
            {"isin": "INE001A07ST5", "issuer": "Reliance Industries", "coupon": 8.5, "maturity_date": "2028-10-15", "rating": "AAA", "yield": 7.8, "price": 102.5, "type": "Corporate"},
            {"isin": "INE040A08726", "issuer": "HDFC Bank", "coupon": 7.9, "maturity_date": "2030-03-20", "rating": "AAA", "yield": 7.6, "price": 101.2, "type": "Banking"},
            {"isin": "IN0020230085", "issuer": "Government of India", "coupon": 7.18, "maturity_date": "2033-07-24", "rating": "SOV", "yield": 7.2, "price": 99.8, "type": "G-Sec"},
            {"isin": "INE121A07NE4", "issuer": "TATA Motors", "coupon": 9.2, "maturity_date": "2026-06-12", "rating": "AA", "yield": 8.9, "price": 100.5, "type": "Corporate"},
            {"isin": "INE261F07632", "issuer": "NABARD", "coupon": 7.5, "maturity_date": "2032-11-05", "rating": "AAA", "yield": 7.4, "price": 100.8, "type": "PSU"},
        ]

        filtered = bonds
        if rating:
            filtered = [b for b in filtered if b["rating"] == rating]
        if issuer_type:
            filtered = [b for b in filtered if b["type"].lower() == issuer_type.lower()]

        return filtered

    async def get_credit_spreads(self) -> Dict[str, Any]:
        """Fetch timeline of IG vs HY spreads."""
        # Mock timeline
        history = []
        start_date = datetime.now() - timedelta(days=90)
        for i in range(90):
            d = (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
            history.append({
                "date": d,
                "ig_yield": 7.5 + (i * 0.005),
                "hy_yield": 10.2 + (i * 0.01),
                "spread": 2.7 + (i * 0.005)
            })
        return {"history": history}

    async def get_ratings_migration(self) -> List[Dict[str, Any]]:
        """Track recent upgrades/downgrades."""
        return [
            {"issuer": "JSW Steel", "old_rating": "AA", "new_rating": "AA+", "date": "2025-02-10", "action": "Upgrade"},
            {"issuer": "Vedanta Ltd", "old_rating": "AA-", "new_rating": "A+", "date": "2025-02-05", "action": "Downgrade"},
            {"issuer": "L&T Finance", "old_rating": "AA+", "new_rating": "AAA", "date": "2025-01-28", "action": "Upgrade"},
        ]

_bond_service: Optional[BondService] = None

def get_bond_service() -> BondService:
    global _bond_service
    if _bond_service is None:
        _bond_service = BondService()
    return _bond_service
