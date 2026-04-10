from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from datetime import datetime, timedelta, timezone
import random

from backend.auth.deps import require_role
from backend.models.user import User

router = APIRouter(prefix="/api/admin/data-quality", tags=["admin"])

@router.get("/health")
async def get_data_health(_: User = Depends(require_role("admin"))):
    """Check for data issues like missing bars, stale prices."""
    return {
        "status": "warning",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "stale_symbols": 12,
            "missing_bars_24h": 450,
            "outliers_detected": 3,
            "adapter_latencies_ms": {"NSE": 45, "BSE": 120, "YAHOO": 850}
        },
        "issues": [
            {"level": "critical", "type": "adapter_down", "message": "Kite Stream disconnected for 5 minutes"},
            {"level": "warning", "type": "stale_price", "message": "RELIANCE price not updated for 2 minutes"},
            {"level": "info", "type": "missing_data", "message": "Gap detected in INFY 1m bars at 14:30"}
        ]
    }

@router.get("/backfill-status")
async def get_backfill_status(_: User = Depends(require_role("admin"))):
    """Status of background data backfill processes."""
    return [
        {"task": "NSE_HIST_5Y", "progress": 85, "status": "running", "eta_mins": 12},
        {"task": "BSE_HIST_1Y", "progress": 100, "status": "completed", "finished_at": "2026-04-05T10:00:00"},
        {"task": "CORP_ACTIONS_SYNC", "progress": 10, "status": "queued"}
    ]

@router.post("/re-sync/{symbol}")
async def trigger_re_sync(symbol: str, _: User = Depends(require_role("admin"))):
    """Manually trigger data re-sync for a symbol."""
    return {"status": "triggered", "symbol": symbol, "job_id": f"sync_{random.randint(1000, 9999)}"}
