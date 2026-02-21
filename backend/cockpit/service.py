import logging
import os
import time

from backend.cockpit.schemas import (
    CockpitSummary,
    EventsSummary,
    NewsSummary,
    PortfolioSnapshot,
    RiskSummary,
    SignalSummary,
)
from backend.shared.cache import cache

logger = logging.getLogger(__name__)


async def get_cockpit_summary() -> CockpitSummary:
    cache_key = "openterminalui:cockpit:summary:aggregator"
    start_time = time.perf_counter()

    cached_data = await cache.get(cache_key)
    if cached_data:
        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.info("cockpit_summary_request", extra={"cache_hit": True, "latency_ms": duration_ms})
        return CockpitSummary.model_validate_json(cached_data)

    # 1. Pull from existing portfolio (placeholder simulation if empty)
    portfolio_snapshot = PortfolioSnapshot(
        positions=[{"symbol": "AAPL", "qty": 10, "current_price": 150.0}],
        pnl=500.0,
    )

    # 2. Pull from signal/scanner
    signal_summary = SignalSummary(
        top_signals=[],
        unavailable_reason="Scanners not fully integrated into cockpit yet",
    )

    # 3. Pull from risk
    risk_summary = RiskSummary(
        summary={"ewma_vol": 0.15, "beta": 1.05},
    )

    # 4. Pull events
    events_summary = EventsSummary(
        events=[{"name": "FOMC Meeting", "date": "2026-03-18"}],
    )

    # 5. Pull news
    news_summary = NewsSummary(
        news=[],
    )

    summary = CockpitSummary(
        portfolio_snapshot=portfolio_snapshot,
        signal_summary=signal_summary,
        risk_summary=risk_summary,
        events=events_summary,
        news=news_summary,
    )

    ttl = int(os.getenv("COCKPIT_CACHE_TTL", "60"))
    await cache.set(cache_key, summary.model_dump_json(), ttl=ttl)

    duration_ms = (time.perf_counter() - start_time) * 1000
    logger.info("cockpit_summary_request", extra={"cache_hit": False, "latency_ms": duration_ms})

    return summary
