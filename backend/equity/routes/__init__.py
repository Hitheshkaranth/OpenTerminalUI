from __future__ import annotations

from fastapi import APIRouter

from backend.equity.routes import admin, alerts, backtest, chart, fundamentals, health, kite, news, peers, portfolio, quotes, reports, screener, search, stocks, stream, valuation

equity_router = APIRouter()
equity_router.include_router(stocks.router, prefix="/api", tags=["stocks"])
equity_router.include_router(chart.router, prefix="/api", tags=["chart"])
equity_router.include_router(screener.router, prefix="/api", tags=["screener"])
equity_router.include_router(valuation.router, prefix="/api", tags=["valuation"])
equity_router.include_router(fundamentals.router, prefix="/api", tags=["fundamentals"])
equity_router.include_router(peers.router, prefix="/api", tags=["peers"])
equity_router.include_router(search.router, prefix="/api", tags=["search"])
equity_router.include_router(quotes.router, prefix="/api", tags=["quotes"])
equity_router.include_router(portfolio.router, prefix="/api", tags=["portfolio"])
equity_router.include_router(backtest.router, prefix="/api", tags=["backtest"])
equity_router.include_router(alerts.router, prefix="/api", tags=["alerts"])
equity_router.include_router(reports.router, prefix="/api", tags=["reports"])
equity_router.include_router(news.router, prefix="/api", tags=["news"])
equity_router.include_router(health.router, prefix="/api", tags=["health"])
equity_router.include_router(kite.router, prefix="/api", tags=["kite"])
equity_router.include_router(admin.router, prefix="/api", tags=["admin"])
equity_router.include_router(stream.router, prefix="/api", tags=["stream"])

__all__ = ["equity_router"]
