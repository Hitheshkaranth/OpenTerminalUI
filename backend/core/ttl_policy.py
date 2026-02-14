from __future__ import annotations

from datetime import datetime, time, timedelta, timezone


def market_open_now() -> bool:
    try:
        from backend.services.prefetch_worker import is_market_hours

        return bool(is_market_hours())
    except Exception:
        # Fallback: simple NSE market window in IST (Mon-Fri, 09:15-15:30).
        now_ist = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
        if now_ist.weekday() >= 5:
            return False
        now_time = now_ist.time()
        return time(9, 15) <= now_time <= time(15, 30)


def ttl_seconds(data_type: str, market_open: bool) -> int:
    dt = (data_type or "").strip().lower()
    policy: dict[str, tuple[int, int]] = {
        # Keep snapshot behavior unchanged from current code path (60s).
        "snapshot": (60, 60),
        "chart": (60, 900),
        "futures_chain": (45, 300),
        "news_latest": (180, 600),
    }
    open_ttl, closed_ttl = policy.get(dt, (300, 900))
    return open_ttl if market_open else closed_ttl
