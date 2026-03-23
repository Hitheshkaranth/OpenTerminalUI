from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from backend.models import Holding
from backend.risk_engine.compute import calculate_beta
from backend.risk_engine.engine import compute_parametric_var_es


@dataclass
class ScenarioImpact:
    scenario_name: str
    projected_pnl: float
    projected_pnl_pct: float
    stressed_beta: float
    stressed_var: float
    base_beta: float
    base_var: float


class ScenarioEngine:
    """
    Scenario Engine for Stress Testing and Scenario Analysis.
    Implements Parallel Shift, Volatility Spike, and Flash Crash scenarios.
    """

    def __init__(self):
        # Default sensitivities if not provided by the model
        self.default_sensitivities = {
            "equity_beta": 1.0,
            "rate_sensitivity": -0.15,
            "vol_sensitivity": -0.05,
        }

    def run_stress_test(
        self,
        holdings: list[Holding],
        scenario_type: str,
        returns_df: pd.DataFrame,
        market_returns: pd.Series,
        portfolio_value: float,
        params: dict[str, Any] | None = None,
    ) -> ScenarioImpact:
        params = params or {}

        # Calculate base metrics
        weights = self._get_weights(holdings)
        portfolio_returns = (returns_df * weights).sum(axis=1)
        base_beta = calculate_beta(portfolio_returns.to_numpy(), market_returns.to_numpy())
        base_var_metrics = compute_parametric_var_es(portfolio_returns.to_numpy())
        base_var = base_var_metrics["var"] * portfolio_value

        if scenario_type == "parallel_shift":
            return self._handle_parallel_shift(
                holdings, base_beta, base_var, portfolio_value, params
            )
        elif scenario_type == "volatility_spike":
            return self._handle_volatility_spike(
                holdings, base_beta, base_var, portfolio_value, params
            )
        elif scenario_type == "flash_crash":
            return self._handle_flash_crash(
                holdings, base_beta, base_var, portfolio_value, params
            )
        else:
            raise ValueError(f"Unknown scenario type: {scenario_type}")

    def _get_weights(self, holdings: list[Holding]) -> pd.Series:
        total_value = sum(float(h.quantity) * float(h.avg_buy_price) for h in holdings)
        weights = {}
        for h in holdings:
            val = float(h.quantity) * float(h.avg_buy_price)
            weights[str(h.ticker).upper()] = val / total_value if total_value > 0 else 0
        return pd.Series(weights)

    def _handle_parallel_shift(
        self,
        holdings: list[Holding],
        base_beta: float,
        base_var: float,
        portfolio_value: float,
        params: dict[str, Any],
    ) -> ScenarioImpact:
        # Parallel Shift: Rates move by X bps, affecting equity and bonds.
        shift_bps = params.get("shift_bps", 100)
        rate_shock = shift_bps / 10000.0

        # Equity impact usually negative when rates rise
        equity_shock = -0.05 * (shift_bps / 100.0)

        total_pnl = 0.0
        for h in holdings:
            val = float(h.quantity) * float(h.avg_buy_price)
            # Simplified: Use a default rate sensitivity
            pnl = val * (self.default_sensitivities["rate_sensitivity"] * rate_shock * 100 + equity_shock)
            total_pnl += pnl

        # Beta impact: Rates up usually increases correlation to value/defensive
        stressed_beta = base_beta * 1.05
        # VaR impact: Higher rates can increase volatility
        stressed_var = base_var * 1.1

        return ScenarioImpact(
            scenario_name=f"Parallel Shift ({shift_bps}bps)",
            projected_pnl=total_pnl,
            projected_pnl_pct=total_pnl / portfolio_value if portfolio_value > 0 else 0,
            stressed_beta=stressed_beta,
            stressed_var=stressed_var,
            base_beta=base_beta,
            base_var=base_var,
        )

    def _handle_volatility_spike(
        self,
        holdings: list[Holding],
        base_beta: float,
        base_var: float,
        portfolio_value: float,
        params: dict[str, Any],
    ) -> ScenarioImpact:
        # Volatility Spike: VIX increases significantly
        vol_increase = params.get("vol_increase", 0.50) # 50% increase

        # Equity impact: Vol spike is usually associated with market drop
        equity_shock = -0.15 * (vol_increase / 0.50)

        total_pnl = 0.0
        for h in holdings:
            val = float(h.quantity) * float(h.avg_buy_price)
            pnl = val * (self.default_sensitivities["vol_sensitivity"] * vol_increase + equity_shock)
            total_pnl += pnl

        # Beta impact: Correlations spike to 1 in vol events
        stressed_beta = base_beta * 1.2
        # VaR impact: Direct impact from vol increase
        stressed_var = base_var * (1.0 + vol_increase)

        return ScenarioImpact(
            scenario_name=f"Volatility Spike (+{int(vol_increase*100)}%)",
            projected_pnl=total_pnl,
            projected_pnl_pct=total_pnl / portfolio_value if portfolio_value > 0 else 0,
            stressed_beta=stressed_beta,
            stressed_var=stressed_var,
            base_beta=base_beta,
            base_var=base_var,
        )

    def _handle_flash_crash(
        self,
        holdings: list[Holding],
        base_beta: float,
        base_var: float,
        portfolio_value: float,
        params: dict[str, Any],
    ) -> ScenarioImpact:
        # Flash Crash: Rapid deep drawdown
        drawdown = params.get("drawdown", -0.20)

        total_pnl = 0.0
        for h in holdings:
            val = float(h.quantity) * float(h.avg_buy_price)
            # In flash crash, beta often amplifies drawdown
            pnl = val * (drawdown * self.default_sensitivities["equity_beta"])
            total_pnl += pnl

        # Beta impact: Beta spikes as everything moves together
        stressed_beta = base_beta * 1.5
        # VaR impact: Extreme volatility
        stressed_var = base_var * 2.5

        return ScenarioImpact(
            scenario_name="Flash Crash",
            projected_pnl=total_pnl,
            projected_pnl_pct=total_pnl / portfolio_value if portfolio_value > 0 else 0,
            stressed_beta=stressed_beta,
            stressed_var=stressed_var,
            base_beta=base_beta,
            base_var=base_var,
        )

scenario_engine = ScenarioEngine()
