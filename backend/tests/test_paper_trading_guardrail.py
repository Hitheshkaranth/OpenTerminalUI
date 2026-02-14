from __future__ import annotations

from backend.api.routes import portfolio


def test_portfolio_route_keeps_basic_buy_sell_endpoints() -> None:
    paths = {route.path for route in portfolio.router.routes}
    assert "/portfolio/holdings" in paths
    assert "/portfolio/holdings/{holding_id}" in paths
    assert "/watchlists/items" in paths
    assert all("/backtests" not in p for p in paths)


def test_portfolio_module_not_coupled_to_backtest_jobs() -> None:
    names = set(dir(portfolio))
    assert "get_backtest_job_service" not in names
