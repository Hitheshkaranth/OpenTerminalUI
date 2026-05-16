"""Gemma-powered AI insight endpoints.

Three read-only analytical endpoints that turn structured terminal data into a
concise, sectioned narrative via the locally hosted Gemma model:

* ``GET  /api/ai/briefing/{ticker}`` - investment briefing for a stock
* ``POST /api/ai/backtest-explain``  - plain-English assessment of a backtest
* ``POST /api/ai/risk-insights``     - narrative interpretation of portfolio risk

All three share one structured-output schema (``llm_insights.INSIGHT_SCHEMA``)
and degrade gracefully when LM Studio is unavailable.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Query

from backend.api.deps import cache_instance, fetch_stock_snapshot_coalesced
from backend.api.routes.news import _fetch_news_fallback, _ticker_fallback_terms
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.services.llm_insights import run_insight

router = APIRouter()


def _fmt(value: Any, suffix: str = "") -> str:
    if value is None or value == "":
        return "n/a"
    try:
        return f"{float(value):,.2f}{suffix}"
    except (TypeError, ValueError):
        return str(value)


@router.get("/ai/briefing/{ticker}")
async def stock_briefing(
    ticker: str,
    market: str | None = Query(default=None, description="Optional market context"),
) -> dict[str, Any]:
    """Return an AI investment briefing synthesizing fundamentals and news."""
    symbol = ticker.strip().upper()
    market_code = (market or "").strip().upper() or None
    cache_key = cache_instance.build_key("ai_insight", f"briefing:{symbol}", {"market": market_code or ""})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    snap = await fetch_stock_snapshot_coalesced(symbol) or {}
    headlines: list[str] = []
    for term in _ticker_fallback_terms(symbol, market_code):
        items = await _fetch_news_fallback(term, limit=6)
        if items:
            headlines = [str(i.get("title") or "").strip() for i in items[:6] if i.get("title")]
            break

    name = snap.get("company_name") or snap.get("name") or symbol
    facts = "\n".join(
        [
            f"Company: {name} ({symbol})",
            f"Sector: {snap.get('sector') or 'n/a'} | Industry: {snap.get('industry') or 'n/a'}",
            f"Price: {_fmt(snap.get('current_price'))} | Day change: {_fmt(snap.get('change_pct'), '%')}",
            f"Market cap: {_fmt(snap.get('market_cap'))}",
            f"P/E: {_fmt(snap.get('pe_ratio') or snap.get('pe'))} | "
            f"P/B: {_fmt(snap.get('pb_ratio') or snap.get('pb'))}",
            f"ROE: {_fmt(snap.get('roe'))} | Debt/Equity: {_fmt(snap.get('debt_to_equity'))}",
            f"52-week range: {_fmt(snap.get('week52_low'))} - {_fmt(snap.get('week52_high'))}",
        ]
    )
    news_block = "\n".join(f"- {h}" for h in headlines) or "- (no recent headlines available)"

    system_prompt = (
        "You are an equity research analyst. Produce a concise, balanced investment "
        "briefing for a professional trader from the data provided. Be specific and "
        "factual; do NOT give direct buy or sell advice. Provide exactly these "
        "sections: 'Bull Case' (tone positive), 'Bear Case' (tone negative), and "
        "'Key Risks' (tone negative or neutral)."
    )
    user_content = f"Fundamentals:\n{facts}\n\nRecent headlines:\n{news_block}"

    result = await run_insight(
        system_prompt,
        user_content,
        max_tokens=900,
        unavailable_summary=(
            f"AI briefing for {symbol} is unavailable - start LM Studio with a Gemma "
            "model to enable it."
        ),
    )
    payload = {"ticker": symbol, "company_name": name, **result}
    await cache_instance.set(cache_key, payload, ttl=ttl_seconds("news_latest", market_open_now()))
    return payload


@router.post("/ai/backtest-explain")
async def backtest_explain(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a plain-English assessment of a backtest result."""
    metrics = payload.get("metrics") if isinstance(payload, dict) else None
    metrics = metrics if isinstance(metrics, dict) else {}
    strategy = str((payload or {}).get("strategy") or "the strategy").strip() or "the strategy"

    system_prompt = (
        "You are a quantitative strategy analyst. Assess a backtest result for a "
        "professional trader. Judge return quality, risk-adjusted performance, "
        "drawdown severity, and sample robustness. Flag likely overfitting when the "
        "trade sample is small or metrics look unrealistically strong. Provide "
        "exactly these sections: 'Strengths' (tone positive), 'Weaknesses' (tone "
        "negative), and 'Overfitting & Robustness' (tone neutral or negative)."
    )
    user_content = (
        f"Strategy: {strategy}\n"
        f"Backtest metrics (JSON):\n{json.dumps(metrics, default=str)[:1600]}"
    )
    return await run_insight(
        system_prompt,
        user_content,
        max_tokens=900,
        unavailable_summary="AI backtest analysis is unavailable - start LM Studio with a Gemma model.",
    )


@router.post("/ai/risk-insights")
async def risk_insights(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a narrative interpretation of portfolio/ticker risk metrics."""
    metrics = payload.get("metrics") if isinstance(payload, dict) else None
    metrics = metrics if isinstance(metrics, dict) else {}
    scope = str((payload or {}).get("scope") or "the portfolio").strip() or "the portfolio"

    system_prompt = (
        "You are a portfolio risk analyst. Interpret the risk metrics for a "
        "professional trader in plain English. Highlight tail risk, volatility, "
        "concentration, correlation clustering, and factor exposure. Provide exactly "
        "these sections: 'Risk Posture' (tone neutral), 'Concentration & "
        "Correlation' (tone negative or neutral), and 'Recommendations' (tone neutral)."
    )
    user_content = (
        f"Scope: {scope}\n"
        f"Risk metrics (JSON):\n{json.dumps(metrics, default=str)[:2000]}"
    )
    return await run_insight(
        system_prompt,
        user_content,
        max_tokens=900,
        unavailable_summary="AI risk analysis is unavailable - start LM Studio with a Gemma model.",
    )
