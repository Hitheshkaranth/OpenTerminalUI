from __future__ import annotations

from fastapi import APIRouter

from backend.api.routes.ai import router as ai_router
from backend.api.routes.analytics import router as analytics_router
from backend.api.routes.bonds import router as bonds_router
from backend.api.routes.commodities import router as commodities_router
from backend.api.routes.correlation import router as correlation_router
from backend.api.routes.pair_trading import router as pair_trading_router
from backend.api.routes.economics import router as economics_router
from backend.api.routes.etf import router as etf_router
from backend.api.routes.factor_analysis import router as factor_analysis_router
from backend.api.routes.fixed_income import router as fixed_income_router
from backend.api.routes.forex import router as forex_router
from backend.api.routes.framework import router as framework_router
from backend.api.routes.heatmap import router as heatmap_router
from backend.api.routes.insider import router as insider_router
from backend.api.routes.journal import router as journal_router
from backend.api.routes.notifications import router as notifications_router
from backend.api.routes.portfolio_optimizer import router as portfolio_optimizer_router
from backend.api.routes.statlab import router as statlab_router
from backend.api.routes.stress_test import router as stress_test_router
from backend.api.routes.tape import router as tape_router
from backend.api.routes.watchlists import router as watchlists_router
from backend.cockpit.routes import router as cockpit_router
from backend.data_quality.admin_routes import router as admin_data_quality_router
from backend.data_quality.routes import router as data_quality_router
from backend.equity.routes import equity_router
from backend.experiments.routes import router as experiments_router
from backend.fno.routes import fno_router
from backend.fno.routes.flow import router as fno_flow_router
from backend.instruments.routes import router as instruments_router
from backend.nlp.routes import router as conviction_router
from backend.portfolio_backtests.routes import router as portfolio_backtests_router
from backend.reports.tearsheet_routes import tearsheet_router
from backend.screener.factor_routes import router as factor_ideas_router
from backend.risk_engine.routes import router as risk_router
from backend.routers.chart_workstation import router as chart_workstation_router
from backend.routers.charts import router as charts_router
from backend.saved_views.routes import router as saved_views_router
from backend.tca.routes import router as tca_router

api_router = APIRouter()

# Multi-watchlist routes must register BEFORE equity_router — its legacy portfolio
# router also defines GET /api/watchlists and would otherwise shadow the real handler.
api_router.include_router(watchlists_router)
api_router.include_router(equity_router)
api_router.include_router(fno_router)
api_router.include_router(commodities_router, prefix="/api")
api_router.include_router(forex_router, prefix="/api")
api_router.include_router(factor_analysis_router, prefix="/api")
api_router.include_router(ai_router, prefix="/api")
# These routers already carry their full "/api/..." prefix internally,
# so they must be included WITHOUT an extra prefix (avoids "/api/api/...").
api_router.include_router(analytics_router)
# correlation router carries its own "/api/correlation" prefix. It was imported but never
# mounted, leaving the Correlation Dashboard's POST /api/correlation/{matrix,rolling,clusters}
# a 405 (every matrix/rolling/cluster request failed).
api_router.include_router(correlation_router)
# pair trading router carries its own "/api/pairs" prefix.
api_router.include_router(pair_trading_router)
api_router.include_router(fno_flow_router)
api_router.include_router(heatmap_router, prefix="/api/heatmap")
api_router.include_router(journal_router, prefix="/api/journal")
api_router.include_router(notifications_router, prefix="/api/notifications")
api_router.include_router(stress_test_router, prefix="/api")
api_router.include_router(insider_router)
api_router.include_router(etf_router, prefix="/api")
api_router.include_router(tape_router, prefix="/api/tape")
api_router.include_router(admin_data_quality_router)

# Quant Feature Pack Routers (Swarm 0 Stubs)
api_router.include_router(cockpit_router, prefix="/api")
api_router.include_router(portfolio_backtests_router, prefix="/api")
api_router.include_router(risk_router, prefix="/api")
api_router.include_router(experiments_router, prefix="/api")
api_router.include_router(instruments_router, prefix="/api")
api_router.include_router(data_quality_router, prefix="/api")
api_router.include_router(tca_router, prefix="/api")
api_router.include_router(chart_workstation_router)
api_router.include_router(charts_router)

# Product Feature Pack (Wave 1): backtesting + stock-picking
api_router.include_router(tearsheet_router, prefix="/api")
api_router.include_router(factor_ideas_router, prefix="/api")
api_router.include_router(conviction_router, prefix="/api")
api_router.include_router(saved_views_router, prefix="/api")

# Fixed income & bonds: these routers already carry their full "/api/..." prefix
# internally, so include them WITHOUT an extra prefix. (Previously imported but
# never mounted, leaving every /api/fixed-income/* and /api/bonds/* endpoint a 404.)
api_router.include_router(fixed_income_router)
api_router.include_router(bonds_router)

# Lean-inspired Algorithm Framework (modular alpha/PC/risk/execution backtest pipeline).
# Router carries its own "/api/framework" prefix internally.
api_router.include_router(framework_router)

# Portfolio Optimizer API
api_router.include_router(portfolio_optimizer_router)

# Statlab API
api_router.include_router(statlab_router)

__all__ = ["api_router"]
