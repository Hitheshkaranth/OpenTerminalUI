from __future__ import annotations

import asyncio
from types import SimpleNamespace

from backend.portfolio_lab import routes
from backend.portfolio_lab.schemas import PortfolioDefinitionCreate, PortfolioRunRequest, StrategyBlendCreate


# Route functions are called directly, so pass the auth/db dependencies explicitly.
_USER = SimpleNamespace(id="user-1", role="trader")
_DEPS = {"db": None, "current_user": _USER}


class _FakePortfolioLabService:
    async def create_portfolio(self, payload: PortfolioDefinitionCreate, owner_id=None) -> dict:  # noqa: ANN001
        return {
            "id": "pf_1",
            "name": payload.name,
            "description": payload.description,
            "tags": payload.tags,
            "benchmark_symbol": payload.benchmark_symbol,
            "start_date": payload.start_date,
            "end_date": payload.end_date,
            "rebalance_frequency": payload.rebalance_frequency,
            "weighting_method": payload.weighting_method,
            "created_at": "2026-02-20T00:00:00",
        }

    async def list_portfolios(self, tag=None, weighting_method=None, owner_id=None):  # noqa: ANN001
        del tag, weighting_method
        return [{
            "id": "pf_1",
            "name": "Core Portfolio",
            "description": "",
            "tags": ["core"],
            "benchmark_symbol": "NIFTY50",
            "start_date": "2025-01-01",
            "end_date": "2025-12-31",
            "rebalance_frequency": "WEEKLY",
            "weighting_method": "EQUAL",
            "created_at": "2026-02-20T00:00:00",
        }]

    async def get_portfolio(self, portfolio_id: str) -> dict:
        return {"id": portfolio_id, "name": "Core Portfolio", "runs": []}

    async def create_blend(self, payload: StrategyBlendCreate, owner_id=None) -> dict:  # noqa: ANN001
        return {"id": "blend_1", "name": payload.name, "strategies_json": payload.strategies_json, "blend_method": payload.blend_method}

    async def list_blends(self, owner_id=None) -> list[dict]:  # noqa: ANN001
        return [{"id": "blend_1", "name": "Blend", "strategies_json": [], "blend_method": "WEIGHTED_SUM_RETURNS"}]

    async def run_portfolio(self, portfolio_id: str, blend_id: str | None, force_refresh: bool = False) -> dict:
        del force_refresh
        return {
            "run_id": "pr_1",
            "portfolio_id": portfolio_id,
            "blend_id": blend_id,
            "status": "succeeded",
            "started_at": "2026-02-20T00:00:00",
            "finished_at": "2026-02-20T00:01:00",
            "error": None,
        }

    async def get_run(self, run_id: str) -> dict:
        return {
            "run_id": run_id,
            "portfolio_id": "pf_1",
            "blend_id": None,
            "status": "succeeded",
            "started_at": "2026-02-20T00:00:00",
            "finished_at": "2026-02-20T00:01:00",
            "error": None,
        }

    async def get_report(self, run_id: str, force_refresh: bool = False) -> dict:
        del force_refresh
        return {
            "run_id": run_id,
            "portfolio_id": "pf_1",
            "blend_id": None,
            "status": "succeeded",
            "metrics": {"cagr": 0.1},
            "series": {"portfolio_equity": []},
            "tables": {"top_contributors": []},
            "matrices": {"correlation": {"labels": [], "values": []}},
        }


def test_create_list_run_report(monkeypatch) -> None:
    monkeypatch.setattr(routes, "get_portfolio_lab_service", lambda: _FakePortfolioLabService())
    for guard in ("_ensure_portfolio_access", "_ensure_blend_access", "_ensure_run_access"):
        monkeypatch.setattr(routes, guard, lambda db, user, key: None)

    created = asyncio.run(routes.create_portfolio(PortfolioDefinitionCreate(name="Core", start_date="2025-01-01", end_date="2025-12-31"), current_user=_USER))
    assert created.id == "pf_1"

    listed = asyncio.run(routes.list_portfolios(tag=None, weighting_method=None, current_user=_USER))
    assert len(listed["items"]) == 1

    blend = asyncio.run(routes.create_blend(StrategyBlendCreate(name="Blend", strategies_json=[{"model_key": "sma_crossover", "weight": 1.0}]), current_user=_USER))
    assert blend["id"] == "blend_1"

    run = asyncio.run(routes.run_portfolio("pf_1", PortfolioRunRequest(), **_DEPS))
    assert run.status == "succeeded"

    status = asyncio.run(routes.run_status("pr_1", **_DEPS))
    assert status.status == "succeeded"

    report = asyncio.run(routes.run_report("pr_1", force_refresh=False, **_DEPS))
    assert report.metrics["cagr"] == 0.1
