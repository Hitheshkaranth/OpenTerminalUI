from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from backend.models import Holding
from backend.risk_engine.compute import calculate_beta
from backend.risk_engine.engine import compute_parametric_var_es

PREDEFINED_SCENARIOS: dict[str, dict[str, Any]] = {
    "gfc_2008": {
        "name": "2008 Global Financial Crisis",
        "description": "Lehman collapse, credit freeze, equity meltdown",
        "severity": "extreme",
        "shocks": {"equity": -0.40, "rates": -0.02, "volatility": 1.5, "credit_spread": 0.04, "gold": 0.15, "fx_inr": -0.12},
    },
    "covid_2020": {
        "name": "2020 COVID Crash",
        "description": "Pandemic selloff, March 2020",
        "severity": "extreme",
        "shocks": {"equity": -0.35, "rates": -0.015, "volatility": 2.0, "gold": 0.10, "fx_inr": -0.06},
    },
    "rate_shock_200bps": {
        "name": "Rate Shock +200bps",
        "description": "Sudden rate hike cycle, duration impact",
        "severity": "high",
        "shocks": {"equity": -0.10, "rates": 0.02, "volatility": 0.3, "credit_spread": 0.01},
    },
    "inr_depreciation": {
        "name": "INR Depreciation 10%",
        "description": "Currency stress, capital outflows",
        "severity": "medium",
        "shocks": {"equity": -0.08, "fx_inr": -0.10, "volatility": 0.2},
    },
    "tech_rotation": {
        "name": "Tech Sector Rotation",
        "description": "Growth to value rotation, tech selloff",
        "severity": "high",
        "shocks": {"equity": -0.05, "sector_tech": -0.25, "sector_value": 0.15},
    },
    "commodity_spike": {
        "name": "Commodity Price Spike",
        "description": "Oil +50%, inflation surge",
        "severity": "high",
        "shocks": {"equity": -0.12, "rates": 0.01, "gold": 0.20, "crude_oil": 0.50},
    },
}

HISTORICAL_EVENT_SHOCKS: dict[tuple[str, str], dict[str, float]] = {
    ("2008-09-15", "2009-03-09"): PREDEFINED_SCENARIOS["gfc_2008"]["shocks"],
    ("2020-02-19", "2020-03-23"): PREDEFINED_SCENARIOS["covid_2020"]["shocks"],
    ("2022-01-03", "2022-10-12"): PREDEFINED_SCENARIOS["rate_shock_200bps"]["shocks"],
}


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
    Scenario engine for both the legacy stress-test math and the newer
    portfolio-level scenario analysis endpoints.
    """

    def __init__(self) -> None:
        self.default_sensitivities = {
            "equity_beta": 1.0,
            "rate_sensitivity": -0.15,
            "vol_sensitivity": -0.05,
        }
        self._factor_vols = {
            "equity": 0.025,
            "rates": 0.0035,
            "volatility": 0.18,
            "credit_spread": 0.004,
            "gold": 0.02,
            "fx_inr": 0.015,
            "crude_oil": 0.06,
            "sector_tech": 0.03,
            "sector_value": 0.025,
        }
        self._sector_profiles = {
            "technology": {
                "equity": 1.28,
                "rates": -0.55,
                "volatility": -0.32,
                "credit_spread": -0.12,
                "gold": 0.02,
                "fx_inr": -0.18,
                "crude_oil": -0.04,
                "sector_tech": 1.0,
                "sector_value": -0.35,
            },
            "financials": {
                "equity": 1.05,
                "rates": -0.95,
                "volatility": -0.24,
                "credit_spread": -0.65,
                "gold": 0.0,
                "fx_inr": -0.06,
                "crude_oil": 0.03,
                "sector_tech": -0.1,
                "sector_value": 0.32,
            },
            "energy": {
                "equity": 1.1,
                "rates": -0.22,
                "volatility": -0.16,
                "credit_spread": -0.21,
                "gold": 0.05,
                "fx_inr": -0.04,
                "crude_oil": 1.1,
                "sector_tech": -0.08,
                "sector_value": 0.2,
            },
            "consumer": {
                "equity": 0.92,
                "rates": -0.28,
                "volatility": -0.18,
                "credit_spread": -0.11,
                "gold": 0.0,
                "fx_inr": -0.08,
                "crude_oil": -0.08,
                "sector_tech": -0.02,
                "sector_value": 0.08,
            },
            "healthcare": {
                "equity": 0.78,
                "rates": -0.16,
                "volatility": -0.1,
                "credit_spread": -0.07,
                "gold": 0.02,
                "fx_inr": -0.05,
                "crude_oil": 0.0,
                "sector_tech": -0.02,
                "sector_value": 0.12,
            },
            "industrials": {
                "equity": 1.0,
                "rates": -0.4,
                "volatility": -0.2,
                "credit_spread": -0.16,
                "gold": 0.0,
                "fx_inr": -0.12,
                "crude_oil": 0.18,
                "sector_tech": -0.04,
                "sector_value": 0.15,
            },
            "materials": {
                "equity": 0.98,
                "rates": -0.22,
                "volatility": -0.18,
                "credit_spread": -0.12,
                "gold": 0.2,
                "fx_inr": -0.05,
                "crude_oil": 0.24,
                "sector_tech": -0.03,
                "sector_value": 0.18,
            },
            "utilities": {
                "equity": 0.72,
                "rates": -0.62,
                "volatility": -0.08,
                "credit_spread": -0.06,
                "gold": 0.0,
                "fx_inr": -0.02,
                "crude_oil": 0.05,
                "sector_tech": -0.02,
                "sector_value": 0.2,
            },
            "value": {
                "equity": 0.88,
                "rates": -0.35,
                "volatility": -0.12,
                "credit_spread": -0.08,
                "gold": 0.0,
                "fx_inr": -0.03,
                "crude_oil": 0.04,
                "sector_tech": -0.2,
                "sector_value": 1.0,
            },
            "unknown": {
                "equity": 1.0,
                "rates": -0.25,
                "volatility": -0.18,
                "credit_spread": -0.1,
                "gold": 0.0,
                "fx_inr": -0.06,
                "crude_oil": 0.03,
                "sector_tech": 0.0,
                "sector_value": 0.0,
            },
        }
        self._ticker_sector_map = {
            "AAPL": "technology",
            "MSFT": "technology",
            "NVDA": "technology",
            "GOOGL": "technology",
            "META": "technology",
            "TCS": "technology",
            "INFY": "technology",
            "WIPRO": "technology",
            "JPM": "financials",
            "BAC": "financials",
            "WFC": "financials",
            "HDFCBANK": "financials",
            "ICICIBANK": "financials",
            "SBIN": "financials",
            "RELIANCE": "energy",
            "RELIANCE.NS": "energy",
            "XOM": "energy",
            "CVX": "energy",
            "ONGC": "energy",
            "ITC": "consumer",
            "HINDUNILVR": "consumer",
            "AMZN": "consumer",
            "PFE": "healthcare",
            "JNJ": "healthcare",
            "TSLA": "industrials",
            "LT": "industrials",
        }

    def list_predefined_scenarios(self) -> list[dict[str, Any]]:
        return [
            {
                "id": scenario_id,
                "name": item["name"],
                "description": item["description"],
                "severity": item["severity"],
                "shocks": dict(item["shocks"]),
            }
            for scenario_id, item in PREDEFINED_SCENARIOS.items()
        ]

    def get_predefined_scenario(self, scenario_id: str) -> dict[str, Any]:
        try:
            return PREDEFINED_SCENARIOS[scenario_id]
        except KeyError as exc:
            raise KeyError("Scenario not found") from exc

    def apply_scenario(self, holdings: list[dict[str, Any]], shocks: dict[str, float]) -> dict[str, Any]:
        normalized_holdings = [self._normalize_holding(holding) for holding in holdings]
        if not normalized_holdings:
            return {
                "total_impact_pct": 0.0,
                "total_impact_value": 0.0,
                "by_holding": [],
                "by_sector": [],
                "worst_holdings": [],
            }

        portfolio_value = sum(item["current_value"] for item in normalized_holdings)
        if portfolio_value <= 0:
            portfolio_value = 1.0

        by_holding: list[dict[str, Any]] = []
        sector_totals: dict[str, dict[str, float]] = {}
        total_impact_value = 0.0

        for item in normalized_holdings:
            factor_map = self._factor_exposures_for(item)
            impact_pct = self._impact_pct_from_factors(factor_map, shocks)
            impact_value = item["current_value"] * impact_pct
            total_impact_value += impact_value
            new_value = item["current_value"] + impact_value
            weight = item["current_value"] / portfolio_value

            by_holding.append(
                {
                    "symbol": item["symbol"],
                    "sector": item["sector"],
                    "weight": weight,
                    "current_value": item["current_value"],
                    "impact_pct": impact_pct,
                    "impact_value": impact_value,
                    "new_value": new_value,
                }
            )

            sector_row = sector_totals.setdefault(
                item["sector"],
                {"current_value": 0.0, "impact_value": 0.0, "weight": 0.0},
            )
            sector_row["current_value"] += item["current_value"]
            sector_row["impact_value"] += impact_value
            sector_row["weight"] += weight

        by_holding.sort(key=lambda row: row["impact_pct"])
        by_sector = [
            {
                "sector": sector,
                "weight": values["weight"],
                "impact_pct": (values["impact_value"] / values["current_value"]) if values["current_value"] else 0.0,
                "impact_value": values["impact_value"],
            }
            for sector, values in sector_totals.items()
        ]
        by_sector.sort(key=lambda row: row["impact_value"])

        return {
            "total_impact_pct": total_impact_value / portfolio_value,
            "total_impact_value": total_impact_value,
            "by_holding": by_holding,
            "by_sector": by_sector,
            "worst_holdings": [
                {
                    "symbol": row["symbol"],
                    "sector": row["sector"],
                    "current_value": row["current_value"],
                    "impact_pct": row["impact_pct"],
                    "impact_value": row["impact_value"],
                }
                for row in by_holding[:5]
            ],
        }

    def run_monte_carlo_stress(self, holdings: list[dict[str, Any]], n_simulations: int = 1000) -> dict[str, Any]:
        normalized_holdings = [self._normalize_holding(holding) for holding in holdings]
        if not normalized_holdings:
            return {
                "percentiles": {"p5": 0.0, "p25": 0.0, "p50": 0.0, "p75": 0.0, "p95": 0.0},
                "worst_case": 0.0,
                "best_case": 0.0,
                "paths": [],
            }

        rng = np.random.default_rng(42)
        horizons = 21
        simulations = max(100, min(int(n_simulations or 1000), 5000))
        terminal_impacts: list[float] = []
        all_paths: list[list[float]] = []

        for _ in range(simulations):
            cumulative_return = 0.0
            path = [0.0]
            for _step in range(horizons):
                shocks = {
                    factor: float(rng.normal(0.0, volatility))
                    for factor, volatility in self._factor_vols.items()
                }
                scenario = self.apply_scenario(normalized_holdings, shocks)
                daily_return = float(scenario["total_impact_pct"])
                cumulative_return = (1.0 + cumulative_return) * (1.0 + daily_return) - 1.0
                path.append(cumulative_return)
            terminal_impacts.append(cumulative_return)
            if len(all_paths) < 100:
                all_paths.append(path)

        percentiles = {
            "p5": float(np.percentile(terminal_impacts, 5)),
            "p25": float(np.percentile(terminal_impacts, 25)),
            "p50": float(np.percentile(terminal_impacts, 50)),
            "p75": float(np.percentile(terminal_impacts, 75)),
            "p95": float(np.percentile(terminal_impacts, 95)),
        }
        return {
            "percentiles": percentiles,
            "worst_case": float(min(terminal_impacts)),
            "best_case": float(max(terminal_impacts)),
            "paths": all_paths,
        }

    def historical_replay(self, holdings: list[dict[str, Any]], event_start: str, event_end: str) -> dict[str, Any]:
        normalized_holdings = [self._normalize_holding(holding) for holding in holdings]
        if not normalized_holdings:
            return {"daily_pnl": [], "max_drawdown": 0.0, "recovery_days": 0}

        start = pd.Timestamp(event_start).date()
        end = pd.Timestamp(event_end).date()
        if end < start:
            raise ValueError("event_end must be on or after event_start")

        business_days = pd.bdate_range(start=start, end=end)
        if len(business_days) == 0:
            business_days = pd.DatetimeIndex([pd.Timestamp(start)])

        event_shocks = HISTORICAL_EVENT_SHOCKS.get((start.isoformat(), end.isoformat()), {"equity": -0.12, "volatility": 0.35, "rates": -0.005})
        base_result = self.apply_scenario(normalized_holdings, event_shocks)
        total_impact_pct = float(base_result["total_impact_pct"])
        total_impact_value = float(base_result["total_impact_value"])

        ramp = np.linspace(0.35, 1.0, len(business_days))
        shape = 0.55 + 0.45 * np.sin(np.linspace(-np.pi / 2, np.pi / 2, len(business_days)))
        weights = ramp * shape
        weights = weights / weights.sum()

        cumulative = 0.0
        cumulative_values: list[float] = []
        daily_pnl: list[dict[str, Any]] = []

        for idx, dt in enumerate(business_days):
            pnl = total_impact_value * float(weights[idx])
            cumulative += pnl
            cumulative_values.append(cumulative)
            daily_pnl.append(
                {
                    "date": dt.date().isoformat(),
                    "pnl": pnl,
                    "cumulative": cumulative,
                }
            )

        running_peak = 0.0
        max_drawdown = 0.0
        trough_index = 0
        for idx, value in enumerate(cumulative_values):
            running_peak = max(running_peak, value)
            drawdown = value - running_peak
            if drawdown < max_drawdown:
                max_drawdown = drawdown
                trough_index = idx

        recovery_days = 0
        if max_drawdown < 0:
            target = max(cumulative_values[: trough_index + 1])
            recovery_index = next((idx for idx, value in enumerate(cumulative_values[trough_index + 1 :], start=trough_index + 1) if value >= target), None)
            if recovery_index is not None:
                recovery_days = recovery_index - trough_index

        portfolio_value = sum(item["current_value"] for item in normalized_holdings) or 1.0
        return {
            "daily_pnl": daily_pnl,
            "max_drawdown": max_drawdown / portfolio_value,
            "recovery_days": recovery_days,
            "total_impact_pct": total_impact_pct,
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
        weights = self._get_weights(holdings)
        portfolio_returns = (returns_df * weights).sum(axis=1)
        base_beta = calculate_beta(portfolio_returns.to_numpy(), market_returns.to_numpy())
        base_var_metrics = compute_parametric_var_es(portfolio_returns.to_numpy())
        base_var = base_var_metrics["var"] * portfolio_value

        if scenario_type == "parallel_shift":
            return self._handle_parallel_shift(holdings, base_beta, base_var, portfolio_value, params)
        if scenario_type == "volatility_spike":
            return self._handle_volatility_spike(holdings, base_beta, base_var, portfolio_value, params)
        if scenario_type == "flash_crash":
            return self._handle_flash_crash(holdings, base_beta, base_var, portfolio_value, params)
        raise ValueError(f"Unknown scenario type: {scenario_type}")

    def _get_weights(self, holdings: list[Holding]) -> pd.Series:
        total_value = sum(float(h.quantity) * float(h.avg_buy_price) for h in holdings)
        weights: dict[str, float] = {}
        for holding in holdings:
            value = float(holding.quantity) * float(holding.avg_buy_price)
            weights[str(holding.ticker).upper()] = value / total_value if total_value > 0 else 0.0
        return pd.Series(weights)

    def _handle_parallel_shift(
        self,
        holdings: list[Holding],
        base_beta: float,
        base_var: float,
        portfolio_value: float,
        params: dict[str, Any],
    ) -> ScenarioImpact:
        shift_bps = params.get("shift_bps", 100)
        rate_shock = shift_bps / 10000.0
        equity_shock = -0.05 * (shift_bps / 100.0)

        total_pnl = 0.0
        for holding in holdings:
            value = float(holding.quantity) * float(holding.avg_buy_price)
            pnl = value * (self.default_sensitivities["rate_sensitivity"] * rate_shock * 100 + equity_shock)
            total_pnl += pnl

        return ScenarioImpact(
            scenario_name=f"Parallel Shift ({shift_bps}bps)",
            projected_pnl=total_pnl,
            projected_pnl_pct=total_pnl / portfolio_value if portfolio_value > 0 else 0.0,
            stressed_beta=base_beta * 1.05,
            stressed_var=base_var * 1.1,
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
        vol_increase = params.get("vol_increase", 0.50)
        equity_shock = -0.15 * (vol_increase / 0.50)

        total_pnl = 0.0
        for holding in holdings:
            value = float(holding.quantity) * float(holding.avg_buy_price)
            pnl = value * (self.default_sensitivities["vol_sensitivity"] * vol_increase + equity_shock)
            total_pnl += pnl

        return ScenarioImpact(
            scenario_name=f"Volatility Spike (+{int(vol_increase * 100)}%)",
            projected_pnl=total_pnl,
            projected_pnl_pct=total_pnl / portfolio_value if portfolio_value > 0 else 0.0,
            stressed_beta=base_beta * 1.2,
            stressed_var=base_var * (1.0 + vol_increase),
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
        drawdown = params.get("drawdown", -0.20)

        total_pnl = 0.0
        for holding in holdings:
            value = float(holding.quantity) * float(holding.avg_buy_price)
            pnl = value * (drawdown * self.default_sensitivities["equity_beta"])
            total_pnl += pnl

        return ScenarioImpact(
            scenario_name="Flash Crash",
            projected_pnl=total_pnl,
            projected_pnl_pct=total_pnl / portfolio_value if portfolio_value > 0 else 0.0,
            stressed_beta=base_beta * 1.5,
            stressed_var=base_var * 2.5,
            base_beta=base_beta,
            base_var=base_var,
        )

    def _normalize_holding(self, holding: dict[str, Any] | Holding) -> dict[str, Any]:
        if isinstance(holding, Holding):
            symbol = str(holding.ticker).upper()
            quantity = float(holding.quantity)
            current_price = float(holding.avg_buy_price)
            current_value = quantity * current_price
            sector = self._infer_sector(symbol)
            return {
                "symbol": symbol,
                "sector": sector,
                "quantity": quantity,
                "current_price": current_price,
                "current_value": current_value,
            }

        symbol = str(holding.get("symbol") or holding.get("ticker") or "UNKNOWN").upper()
        quantity = float(holding.get("quantity") or 0.0)
        current_price = float(holding.get("current_price") or holding.get("avg_buy_price") or 0.0)
        current_value_raw = holding.get("current_value")
        current_value = float(current_value_raw) if current_value_raw is not None else quantity * current_price
        sector = str(holding.get("sector") or self._infer_sector(symbol)).strip().lower() or "unknown"
        return {
            "symbol": symbol,
            "sector": sector,
            "quantity": quantity,
            "current_price": current_price,
            "current_value": current_value,
        }

    def _infer_sector(self, symbol: str) -> str:
        normalized = symbol.strip().upper()
        return self._ticker_sector_map.get(normalized, "unknown")

    def _factor_exposures_for(self, holding: dict[str, Any]) -> dict[str, float]:
        sector = holding["sector"]
        profile = dict(self._sector_profiles.get(sector, self._sector_profiles["unknown"]))
        if sector == "unknown" and holding["symbol"].endswith(".NS"):
            profile["fx_inr"] = -0.12
        return profile

    def _impact_pct_from_factors(self, factor_map: dict[str, float], shocks: dict[str, float]) -> float:
        impact_pct = 0.0
        for factor, shock_amount in shocks.items():
            exposure = factor_map.get(factor, 0.0)
            impact_pct += exposure * float(shock_amount)
        return float(np.clip(impact_pct, -0.95, 1.5))


scenario_engine = ScenarioEngine()
