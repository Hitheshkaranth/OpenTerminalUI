from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from hashlib import sha256
from typing import Any

from sqlalchemy.orm import Session

from backend.models import Holding, PortfolioDefinition


@dataclass(frozen=True)
class StressScenario:
    key: str
    name: str
    description: str
    start_date: date
    end_date: date
    shocks: dict[str, float]

    @property
    def period(self) -> str:
        return f"{self.start_date.isoformat()} to {self.end_date.isoformat()}"

    def to_payload(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["start_date"] = self.start_date.isoformat()
        payload["end_date"] = self.end_date.isoformat()
        payload["period"] = self.period
        return payload


@dataclass(frozen=True)
class HoldingImpact:
    symbol: str
    sector: str
    current_value: float
    stressed_value: float
    pnl: float
    pnl_pct: float
    contribution_pct: float
    equity_beta: float
    rate_sensitivity: float
    commodity_beta: float
    fx_exposure: float
    credit_sensitivity: float


@dataclass(frozen=True)
class StressResult:
    scenario: str
    scenario_key: str
    portfolio_id: str
    portfolio_value: float
    stressed_value: float
    total_pnl: float
    total_pnl_pct: float
    holdings: list[HoldingImpact]
    sector_summary: list[dict[str, Any]]

    def to_payload(self) -> dict[str, Any]:
        return {
            "scenario": self.scenario,
            "scenario_key": self.scenario_key,
            "portfolio_id": self.portfolio_id,
            "portfolio_value": self.portfolio_value,
            "stressed_value": self.stressed_value,
            "total_pnl": self.total_pnl,
            "total_pnl_pct": self.total_pnl_pct,
            "holdings": [asdict(item) for item in self.holdings],
            "sector_summary": self.sector_summary,
        }


@dataclass(frozen=True)
class ReplayPoint:
    date: str
    portfolio_value: float
    pnl: float
    pnl_pct: float
    drawdown_pct: float


@dataclass(frozen=True)
class ReplayResult:
    scenario: str
    scenario_key: str
    portfolio_id: str
    starting_value: float
    ending_value: float
    max_drawdown_pct: float
    recovery_days: int
    timeline: list[ReplayPoint]

    def to_payload(self) -> dict[str, Any]:
        return {
            "scenario": self.scenario,
            "scenario_key": self.scenario_key,
            "portfolio_id": self.portfolio_id,
            "starting_value": self.starting_value,
            "ending_value": self.ending_value,
            "max_drawdown_pct": self.max_drawdown_pct,
            "recovery_days": self.recovery_days,
            "timeline": [asdict(point) for point in self.timeline],
        }


class StressTestService:
    _DEFAULT_SCENARIOS: tuple[StressScenario, ...] = (
        StressScenario(
            key="2008_gfc",
            name="2008 Global Financial Crisis",
            description="Broad risk-off shock with equity, credit, and FX stress.",
            start_date=date(2008, 9, 15),
            end_date=date(2009, 3, 9),
            shocks={"equity": -0.38, "rates": -0.025, "oil": -0.54, "fx_usd": 0.12, "credit_spread": 0.035},
        ),
        StressScenario(
            key="2020_covid",
            name="2020 COVID-19 Crash",
            description="Fast equity drawdown with rates, oil, and credit widening.",
            start_date=date(2020, 2, 19),
            end_date=date(2020, 3, 23),
            shocks={"equity": -0.34, "rates": -0.015, "oil": -0.65, "fx_usd": 0.08, "credit_spread": 0.025},
        ),
        StressScenario(
            key="2013_taper",
            name="2013 Taper Tantrum",
            description="Rates repricing with moderate equity and FX spillover.",
            start_date=date(2013, 5, 22),
            end_date=date(2013, 9, 5),
            shocks={"equity": -0.06, "rates": 0.013, "oil": -0.05, "fx_usd": 0.04, "credit_spread": 0.008},
        ),
        StressScenario(
            key="2022_rates",
            name="2022 Rate Hiking Cycle",
            description="Tightening cycle with equity compression and credit spread widening.",
            start_date=date(2022, 1, 3),
            end_date=date(2022, 10, 12),
            shocks={"equity": -0.25, "rates": 0.03, "oil": 0.2, "fx_usd": 0.15, "credit_spread": 0.015},
        ),
    )

    _SECTOR_PRESETS: dict[str, dict[str, float]] = {
        "technology": {"equity_beta": 1.18, "rate_sensitivity": -0.18, "commodity_beta": -0.02, "fx_exposure": 0.22, "credit_sensitivity": 0.05},
        "financials": {"equity_beta": 1.05, "rate_sensitivity": -0.75, "commodity_beta": 0.0, "fx_exposure": 0.12, "credit_sensitivity": 0.26},
        "energy": {"equity_beta": 1.22, "rate_sensitivity": 0.08, "commodity_beta": 1.2, "fx_exposure": 0.1, "credit_sensitivity": 0.12},
        "healthcare": {"equity_beta": 0.86, "rate_sensitivity": -0.08, "commodity_beta": 0.0, "fx_exposure": 0.15, "credit_sensitivity": 0.08},
        "consumer": {"equity_beta": 0.97, "rate_sensitivity": -0.12, "commodity_beta": 0.1, "fx_exposure": 0.09, "credit_sensitivity": 0.07},
        "industrials": {"equity_beta": 1.08, "rate_sensitivity": -0.15, "commodity_beta": 0.18, "fx_exposure": 0.08, "credit_sensitivity": 0.07},
        "materials": {"equity_beta": 1.1, "rate_sensitivity": -0.06, "commodity_beta": 0.72, "fx_exposure": 0.07, "credit_sensitivity": 0.09},
        "utilities": {"equity_beta": 0.78, "rate_sensitivity": -0.32, "commodity_beta": 0.06, "fx_exposure": 0.05, "credit_sensitivity": 0.05},
        "real_estate": {"equity_beta": 1.14, "rate_sensitivity": -0.48, "commodity_beta": 0.02, "fx_exposure": 0.04, "credit_sensitivity": 0.14},
        "unknown": {"equity_beta": 1.0, "rate_sensitivity": -0.16, "commodity_beta": 0.1, "fx_exposure": 0.1, "credit_sensitivity": 0.1},
    }

    _TICKER_SECTOR_MAP: dict[str, str] = {
        "AAPL": "technology",
        "MSFT": "technology",
        "NVDA": "technology",
        "GOOGL": "technology",
        "AMZN": "consumer",
        "TSLA": "industrials",
        "JPM": "financials",
        "BAC": "financials",
        "WFC": "financials",
        "RELIANCE": "energy",
        "RELIANCE.NS": "energy",
        "XOM": "energy",
        "CVX": "energy",
        "PFE": "healthcare",
        "JNJ": "healthcare",
        "TCS": "technology",
        "INFY": "technology",
        "HDFCBANK": "financials",
        "ICICIBANK": "financials",
        "ITC": "consumer",
        "HINDUNILVR": "consumer",
        "LT": "industrials",
        "ONGC": "energy",
        "SBIN": "financials",
    }

    def list_scenarios(self) -> list[dict[str, Any]]:
        return [scenario.to_payload() for scenario in self._DEFAULT_SCENARIOS]

    def get_scenario(self, key: str) -> StressScenario:
        normalized = self._normalize_key(key)
        for scenario in self._DEFAULT_SCENARIOS:
            if scenario.key == normalized:
                return scenario
        raise KeyError(normalized)

    def resolve_portfolio_holdings(self, db: Session, portfolio_id: str) -> tuple[list[Holding], str]:
        normalized = self._normalize_portfolio_id(portfolio_id)
        if normalized not in {"current", "portfolio", "default", ""}:
            portfolio = db.query(PortfolioDefinition).filter(PortfolioDefinition.id == portfolio_id).first()
            if portfolio is None:
                raise LookupError("Portfolio not found")
        holdings = db.query(Holding).all()
        if not holdings:
            raise LookupError("No holdings available")
        return holdings, normalized or "current"

    def run_stress_test(
        self,
        db: Session,
        portfolio_id: str,
        scenario_key: str,
        custom_params: dict[str, float] | None = None,
    ) -> StressResult:
        holdings, resolved_portfolio = self.resolve_portfolio_holdings(db, portfolio_id)
        if self._normalize_key(scenario_key) == "custom":
            scenario_name = "Custom Stress Scenario"
            shocks = self._normalize_custom_params(custom_params or {})
        else:
            scenario = self.get_scenario(scenario_key)
            scenario_name = scenario.name
            shocks = dict(scenario.shocks)

        impacts = [self._impact_for_holding(h, shocks) for h in holdings]
        portfolio_value = sum(item.current_value for item in impacts)
        total_pnl = sum(item.pnl for item in impacts)
        stressed_value = portfolio_value + total_pnl
        total_abs_pnl = sum(abs(item.pnl) for item in impacts)
        if total_abs_pnl <= 0:
            contribution_map = {item.symbol: 1.0 / len(impacts) for item in impacts}
        else:
            contribution_map = {item.symbol: abs(item.pnl) / total_abs_pnl for item in impacts}

        holdings_payload = []
        sector_totals: dict[str, float] = {}
        for item in impacts:
            contribution_pct = contribution_map.get(item.symbol, 0.0)
            holdings_payload.append(
                HoldingImpact(
                    symbol=item.symbol,
                    sector=item.sector,
                    current_value=item.current_value,
                    stressed_value=item.stressed_value,
                    pnl=item.pnl,
                    pnl_pct=item.pnl_pct,
                    contribution_pct=contribution_pct,
                    equity_beta=item.equity_beta,
                    rate_sensitivity=item.rate_sensitivity,
                    commodity_beta=item.commodity_beta,
                    fx_exposure=item.fx_exposure,
                    credit_sensitivity=item.credit_sensitivity,
                )
            )
            sector_totals[item.sector] = sector_totals.get(item.sector, 0.0) + item.pnl

        sector_summary = [
            {
                "sector": sector,
                "pnl": pnl,
                "pnl_pct": (pnl / portfolio_value) if portfolio_value else 0.0,
                "weight_pct": (abs(pnl) / total_abs_pnl * 100.0) if total_abs_pnl > 0 else (100.0 / len(sector_totals) if sector_totals else 0.0),
            }
            for sector, pnl in sorted(sector_totals.items(), key=lambda item: abs(item[1]), reverse=True)
        ]

        total_pnl_pct = (total_pnl / portfolio_value) if portfolio_value else 0.0
        return StressResult(
            scenario=scenario_name,
            scenario_key=self._normalize_key(scenario_key),
            portfolio_id=resolved_portfolio,
            portfolio_value=portfolio_value,
            stressed_value=stressed_value,
            total_pnl=total_pnl,
            total_pnl_pct=total_pnl_pct,
            holdings=holdings_payload,
            sector_summary=sector_summary,
        )

    def run_historical_replay(
        self,
        db: Session,
        portfolio_id: str,
        scenario_key: str,
    ) -> ReplayResult:
        holdings, resolved_portfolio = self.resolve_portfolio_holdings(db, portfolio_id)
        scenario = self.get_scenario(scenario_key)
        impacts = [self._impact_for_holding(h, scenario.shocks) for h in holdings]
        starting_value = sum(item.current_value for item in impacts)
        days = max(1, (scenario.end_date - scenario.start_date).days + 1)

        timeline: list[ReplayPoint] = []
        cumulative_max = starting_value
        max_drawdown_pct = 0.0
        recovery_days = days - 1

        for idx in range(days):
            day = scenario.start_date + timedelta(days=idx)
            progress = idx / float(max(days - 1, 1))
            weight = 0.35 + 0.65 * self._stress_curve(progress)
            day_value = sum(item.current_value * (1.0 + item.pnl_pct_base * weight) for item in impacts)
            pnl = day_value - starting_value
            pnl_pct = (pnl / starting_value) if starting_value else 0.0
            cumulative_max = max(cumulative_max, day_value)
            drawdown_pct = ((day_value - cumulative_max) / cumulative_max) if cumulative_max else 0.0
            max_drawdown_pct = min(max_drawdown_pct, drawdown_pct)
            timeline.append(
                ReplayPoint(
                    date=day.isoformat(),
                    portfolio_value=day_value,
                    pnl=pnl,
                    pnl_pct=pnl_pct,
                    drawdown_pct=drawdown_pct,
                )
            )

        ending_value = timeline[-1].portfolio_value if timeline else starting_value
        trough_index = min(range(len(timeline)), key=lambda i: timeline[i].portfolio_value) if timeline else 0
        recovery_days = max(0, len(timeline) - trough_index - 1)
        return ReplayResult(
            scenario=scenario.name,
            scenario_key=scenario.key,
            portfolio_id=resolved_portfolio,
            starting_value=starting_value,
            ending_value=ending_value,
            max_drawdown_pct=max_drawdown_pct,
            recovery_days=recovery_days,
            timeline=timeline,
        )

    @dataclass(frozen=True)
    class _ImpactCore:
        symbol: str
        sector: str
        current_value: float
        stressed_value: float
        pnl: float
        pnl_pct: float
        pnl_pct_base: float
        equity_beta: float
        rate_sensitivity: float
        commodity_beta: float
        fx_exposure: float
        credit_sensitivity: float

    def _impact_for_holding(self, holding: Holding, shocks: dict[str, float]) -> "StressTestService._ImpactCore":
        symbol = self._normalize_symbol(str(holding.ticker))
        sector = self._resolve_sector(symbol)
        exposure = self._exposure_for_symbol(symbol, sector)
        current_value = float(holding.quantity) * float(holding.avg_buy_price)
        pnl_pct_base = (
            exposure["equity_beta"] * float(shocks.get("equity", 0.0))
            + exposure["rate_sensitivity"] * float(shocks.get("rates", 0.0))
            + exposure["commodity_beta"] * float(shocks.get("oil", 0.0))
            + exposure["fx_exposure"] * float(shocks.get("fx_usd", 0.0))
            + exposure["credit_sensitivity"] * float(shocks.get("credit_spread", 0.0))
        )
        stressed_value = current_value * (1.0 + pnl_pct_base)
        pnl = stressed_value - current_value
        pnl_pct = (pnl / current_value) if current_value else 0.0
        return self._ImpactCore(
            symbol=symbol,
            sector=sector,
            current_value=current_value,
            stressed_value=stressed_value,
            pnl=pnl,
            pnl_pct=pnl_pct,
            pnl_pct_base=pnl_pct_base,
            equity_beta=exposure["equity_beta"],
            rate_sensitivity=exposure["rate_sensitivity"],
            commodity_beta=exposure["commodity_beta"],
            fx_exposure=exposure["fx_exposure"],
            credit_sensitivity=exposure["credit_sensitivity"],
        )

    def _resolve_sector(self, ticker: str) -> str:
        if ticker in self._TICKER_SECTOR_MAP:
            return self._TICKER_SECTOR_MAP[ticker]
        base = ticker.split(".")[0]
        if base in self._TICKER_SECTOR_MAP:
            return self._TICKER_SECTOR_MAP[base]
        return self._infer_sector_from_hash(base)

    def _exposure_for_symbol(self, ticker: str, sector: str) -> dict[str, float]:
        base = dict(self._SECTOR_PRESETS.get(sector, self._SECTOR_PRESETS["unknown"]))
        digest = sha256(ticker.encode("utf-8")).digest()
        jitter = lambda idx, scale: (((digest[idx] / 255.0) - 0.5) * scale)
        exposure = {
            "equity_beta": round(max(0.2, base["equity_beta"] + jitter(0, 0.22)), 4),
            "rate_sensitivity": round(base["rate_sensitivity"] + jitter(1, 0.16), 4),
            "commodity_beta": round(base["commodity_beta"] + jitter(2, 0.2), 4),
            "fx_exposure": round(base["fx_exposure"] + jitter(3, 0.14), 4),
            "credit_sensitivity": round(base["credit_sensitivity"] + jitter(4, 0.12), 4),
        }
        return exposure

    def _normalize_custom_params(self, params: dict[str, float]) -> dict[str, float]:
        return {
            "equity": float(params.get("equity", 0.0)),
            "rates": float(params.get("rates", params.get("rate", 0.0))),
            "oil": float(params.get("oil", 0.0)),
            "fx_usd": float(params.get("fx_usd", params.get("fx", 0.0))),
            "credit_spread": float(params.get("credit_spread", params.get("credit", 0.0))),
        }

    def _stress_curve(self, progress: float) -> float:
        progress = max(0.0, min(1.0, progress))
        return math.sin(math.pi * progress)

    def _normalize_symbol(self, symbol: str) -> str:
        return symbol.strip().upper()

    def _normalize_key(self, key: str) -> str:
        return key.strip().lower()

    def _normalize_portfolio_id(self, portfolio_id: str) -> str:
        return portfolio_id.strip().lower()

    def _infer_sector_from_hash(self, base: str) -> str:
        sectors = [sector for sector in self._SECTOR_PRESETS if sector != "unknown"]
        if not sectors:
            return "unknown"
        digest = sha256(base.encode("utf-8")).digest()
        return sectors[digest[0] % len(sectors)]


stress_test_service = StressTestService()
