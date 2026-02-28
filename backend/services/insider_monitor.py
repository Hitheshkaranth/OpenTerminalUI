from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List

import httpx
from sqlalchemy.orm import Session
from backend.config.settings import get_settings
from backend.models.core import InsiderTrade

logger = logging.getLogger(__name__)

async def fetch_insider_trading(symbol: str, db: Session) -> List[Dict[str, Any]]:
    # In a real implementation, we would query FMP here.
    # For now, return mock data from the DB or synthetic if empty to avoid external dependency issues.

    # Check DB first
    trades = db.query(InsiderTrade).filter(InsiderTrade.symbol == symbol.upper()).order_by(InsiderTrade.date.desc()).all()
    if trades:
        return [
            {
                "id": t.id,
                "symbol": t.symbol,
                "insider_name": t.insider_name,
                "insider_title": t.insider_title,
                "transaction_type": t.transaction_type,
                "shares": t.shares,
                "price": t.price,
                "value": t.value,
                "date": t.date.isoformat(),
                "filing_date": t.filing_date.isoformat(),
                "source": t.source
            } for t in trades
        ]

    # Generate Synthetic Data for demonstration
    mock_data = []
    now = datetime.now()
    for i in range(5):
        mock_data.append({
            "id": i,
            "symbol": symbol.upper(),
            "insider_name": f"Mock Insider {i}",
            "insider_title": "Director",
            "transaction_type": "buy" if i % 2 == 0 else "sell",
            "shares": 1000 * (i + 1),
            "price": 150.0,
            "value": 150000.0 * (i + 1),
            "date": (now - timedelta(days=i)).isoformat(),
            "filing_date": (now - timedelta(days=i)).isoformat(),
            "source": "FMP_MOCK"
        })
    return mock_data

async def fetch_insider_clusters(db: Session) -> List[Dict[str, Any]]:
    # Mock cluster detection
    return [
        {
            "symbol": "AAPL",
            "event": "Cluster Buy",
            "insider_count": 3,
            "total_value": 5000000.0,
            "date": datetime.now().isoformat()
        }
    ]
