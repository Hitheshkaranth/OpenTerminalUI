"""Per-run context the agent's tools can read (set once by the orchestrator at the start of a run)."""
from __future__ import annotations

from contextvars import ContextVar

# The market the user is looking at (NSE, NASDAQ…). Bare tickers are ambiguous across exchanges:
# "CCL" is CCL Products on NSE but Carnival on NYSE, and the news tool returned Carnival's headlines
# for a user on the CCL Products page.
active_market: ContextVar[str | None] = ContextVar("agent_active_market", default=None)
