from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import Holding, PortfolioDefinition, User
from backend.risk_engine.scenario_engine import scenario_engine

router = APIRouter()

_RUN_HISTORY: deque[dict[str, Any]] = deque(maxlen=50)


class ScenarioRunRequest(BaseModel):
    portfolio_id: str = Field(default="current", min_length=1)
    scenario_id: str | None = None
    custom_shocks: dict[str, float] | None = None

    @model_validator(mode="after")
    def validate_request(self) -> "ScenarioRunRequest":
        if not self.scenario_id and not self.custom_shocks:
            raise ValueError("scenario_id or custom_shocks is required")
        return self


class MonteCarloRequest(BaseModel):
    portfolio_id: str = Field(default="current", min_length=1)
    n_simulations: int = Field(default=1000, ge=100, le=5000)


def _validate_portfolio_id(db: Session, portfolio_id: str) -> None:
    normalized = portfolio_id.strip().lower()
    if normalized in {"", "current", "portfolio", "default"}:
        return
    exists = db.query(PortfolioDefinition).filter(PortfolioDefinition.id == portfolio_id).first()
    if exists is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")


def _infer_sector(ticker: str) -> str:
    return scenario_engine._infer_sector(ticker).replace("_", " ").title()  # noqa: SLF001


def _load_holdings(db: Session, portfolio_id: str) -> list[dict[str, Any]]:
    _validate_portfolio_id(db, portfolio_id)
    rows = db.query(Holding).all()
    if not rows:
        raise HTTPException(status_code=404, detail="No holdings available")
    holdings: list[dict[str, Any]] = []
    for row in rows:
        current_value = float(row.quantity) * float(row.avg_buy_price)
        holdings.append(
            {
                "symbol": str(row.ticker).upper(),
                "ticker": str(row.ticker).upper(),
                "quantity": float(row.quantity),
                "avg_buy_price": float(row.avg_buy_price),
                "current_price": float(row.avg_buy_price),
                "current_value": current_value,
                "sector": _infer_sector(str(row.ticker)),
            }
        )
    return holdings


def _record_history(scenario_name: str, total_impact_pct: float) -> None:
    _RUN_HISTORY.appendleft(
        {
            "id": f"run_{datetime.now(timezone.utc).timestamp():.6f}",
            "scenario_name": scenario_name,
            "run_date": datetime.now(timezone.utc).isoformat(),
            "total_impact_pct": total_impact_pct,
        }
    )


@router.get("/risk/scenarios/predefined")
def get_predefined_scenarios(_: User = Depends(get_current_user)) -> list[dict[str, Any]]:
    return scenario_engine.list_predefined_scenarios()


@router.post("/risk/scenarios/run")
def run_scenario(
    payload: ScenarioRunRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    holdings = _load_holdings(db, payload.portfolio_id)

    if payload.custom_shocks:
        scenario_name = "Custom Scenario"
        shocks = payload.custom_shocks
    else:
        scenario = scenario_engine.get_predefined_scenario(payload.scenario_id or "")
        scenario_name = str(scenario["name"])
        shocks = dict(scenario["shocks"])

    result = scenario_engine.apply_scenario(holdings, shocks)
    result["scenario_name"] = scenario_name
    result["shocks"] = shocks
    _record_history(scenario_name, float(result["total_impact_pct"]))
    return result


@router.post("/risk/scenarios/monte-carlo")
def run_monte_carlo(
    payload: MonteCarloRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    holdings = _load_holdings(db, payload.portfolio_id)
    return scenario_engine.run_monte_carlo_stress(holdings, n_simulations=payload.n_simulations)


@router.get("/risk/scenarios/history")
def get_scenario_history(_: User = Depends(get_current_user)) -> list[dict[str, Any]]:
    return list(_RUN_HISTORY)
