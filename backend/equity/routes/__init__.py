from __future__ import annotations

from fastapi import APIRouter

from backend.api.routes import options
from backend.equity.routes import admin, alerts, auth, backtest, backtests, chart, crypto, data, earnings, events, export, fundamentals, health, indicators, kite, mutual_funds, news, paper, peers, plugins, portfolio, quotes, reports, screener, scripting, search, shareholding, stocks, stream, valuation
from backend.api.routes import audit, data_layer, governance, oms, ops, risk
from backend.model_lab import router as model_lab_router
from backend.portfolio_lab import router as portfolio_lab_router
from backend.screener import legacy_router as screener_v1_router
from backend.screener.router import router as screener_revamped_router
equity_router = APIRouter()
equity_router.include_router(stocks.router, prefix="/api", tags=["stocks"])
equity_router.include_router(chart.router, prefix="/api", tags=["chart"])
equity_router.include_router(screener.router, prefix="/api", tags=["screener"])
equity_router.include_router(screener_revamped_router, prefix="/api", tags=["screener-revamped"])
equity_router.include_router(screener_v1_router, prefix="/api", tags=["screener-v1"])
equity_router.include_router(valuation.router, prefix="/api", tags=["valuation"])
equity_router.include_router(fundamentals.router, prefix="/api", tags=["fundamentals"])
equity_router.include_router(peers.router, prefix="/api", tags=["peers"])
equity_router.include_router(search.router, prefix="/api", tags=["search"])
equity_router.include_router(quotes.router, prefix="/api", tags=["quotes"])
equity_router.include_router(portfolio.router, prefix="/api", tags=["portfolio"])
equity_router.include_router(backtest.router, prefix="/api", tags=["backtest"])
equity_router.include_router(backtests.router, prefix="/api", tags=["backtests"])
equity_router.include_router(alerts.router, prefix="/api", tags=["alerts"])
equity_router.include_router(reports.router, prefix="/api", tags=["reports"])
equity_router.include_router(export.router, prefix="/api", tags=["export"])
equity_router.include_router(plugins.router, prefix="/api", tags=["plugins"])
equity_router.include_router(data.router, prefix="/api", tags=["data"])
equity_router.include_router(news.router, prefix="/api", tags=["news"])
equity_router.include_router(health.router, prefix="/api", tags=["health"])
equity_router.include_router(kite.router, prefix="/api", tags=["kite"])
equity_router.include_router(admin.router, prefix="/api", tags=["admin"])
equity_router.include_router(stream.router, prefix="/api", tags=["stream"])
equity_router.include_router(indicators.router, prefix="/api", tags=["indicators"])
equity_router.include_router(crypto.router, prefix="/api", tags=["crypto"])
equity_router.include_router(paper.router, prefix="/api", tags=["paper"])
equity_router.include_router(scripting.router, prefix="/api", tags=["scripting"])
equity_router.include_router(shareholding.router, prefix="/api", tags=["shareholding"])
equity_router.include_router(options.router)
equity_router.include_router(data_layer.router, prefix="/api", tags=["data-layer"])
equity_router.include_router(risk.router, prefix="/api", tags=["risk"])
equity_router.include_router(oms.router, prefix="/api", tags=["oms"])
equity_router.include_router(audit.router, prefix="/api", tags=["audit"])
equity_router.include_router(governance.router, prefix="/api", tags=["governance"])
equity_router.include_router(ops.router, prefix="/api", tags=["ops"])
equity_router.include_router(model_lab_router, prefix="/api", tags=["model-lab"])
equity_router.include_router(portfolio_lab_router, prefix="/api", tags=["portfolio-lab"])
equity_router.include_router(mutual_funds.router)
equity_router.include_router(events.router)
equity_router.include_router(earnings.router)
equity_router.include_router(auth.router)

__all__ = ["equity_router"]
