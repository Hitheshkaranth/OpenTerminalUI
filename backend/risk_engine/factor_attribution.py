from __future__ import annotations

import math
from typing import Optional

import numpy as np


class FactorAttributionEngine:
    """Fama-French style factor-based portfolio decomposition."""

    FACTORS = ["market", "size", "value", "momentum", "quality", "low_vol"]

    def __init__(self) -> None:
        self._last_factor_dates: list[str] = []
        self._last_portfolio_exposures: dict[str, dict[str, float]] = {
            factor: {"exposure": 0.0, "t_stat": 0.0, "confidence": 0.0} for factor in self.FACTORS
        }
        self._last_holding_exposures: dict[str, dict[str, float]] = {}

    @property
    def factor_dates(self) -> list[str]:
        return list(self._last_factor_dates)

    def compute_factor_returns(self, universe_data: list[dict], period: str = "1Y") -> dict:
        """
        Compute factor return series from universe data.
        - Market: universe equal-weight return
        - Size: small_cap_return - large_cap_return (split at median market_cap)
        - Value: high_pb_quintile_return - low_pb_quintile_return
        - Momentum: top_12m_return_quintile - bottom_quintile
        - Quality: high_roe_quintile - low_roe_quintile
        - Low Vol: low_beta_quintile - high_beta_quintile
        Returns: {factor_name: [daily_returns]}
        """
        del period
        prepared = self._prepare_universe(universe_data)
        if not prepared:
            self._last_factor_dates = []
            return {factor: [] for factor in self.FACTORS}

        returns_matrix = np.vstack([item["returns"] for item in prepared])
        self._last_factor_dates = list(prepared[0]["dates"])

        factor_returns = {
            "market": returns_matrix.mean(axis=0),
            "size": self._spread_from_metric(prepared, "market_cap", low_minus_high=True),
            "value": self._spread_from_metric(prepared, "pb_ratio", low_minus_high=False),
            "momentum": self._spread_from_metric(prepared, "momentum_12m", low_minus_high=False),
            "quality": self._spread_from_metric(prepared, "roe", low_minus_high=False),
            "low_vol": self._spread_from_metric(prepared, "beta", low_minus_high=True),
        }
        return {factor: series.astype(float).tolist() for factor, series in factor_returns.items()}

    def compute_factor_exposures(self, holdings: list[dict], universe_data: list[dict]) -> dict:
        """
        For each holding, compute factor loadings using rolling 60-day regression.
        Portfolio exposure = weighted average of holding exposures.
        Returns: {factor_name: {exposure: float, t_stat: float, confidence: float}}
        """
        factor_returns = self.compute_factor_returns(universe_data)
        asset_map = self._prepare_universe_map(universe_data)
        x = self._factor_matrix(factor_returns)
        if x.size == 0:
            self._last_holding_exposures = {}
            self._last_portfolio_exposures = {
                factor: {"exposure": 0.0, "t_stat": 0.0, "confidence": 0.0} for factor in self.FACTORS
            }
            return self._last_portfolio_exposures

        weights = self._holding_weights(holdings)
        portfolio = {factor: {"exposure": 0.0, "t_stat": 0.0, "confidence": 0.0} for factor in self.FACTORS}
        holding_exposures: dict[str, dict[str, float]] = {}

        for holding in holdings:
            symbol = str(holding.get("symbol") or holding.get("ticker") or "").strip().upper()
            if not symbol or symbol not in asset_map:
                continue
            y = asset_map[symbol]["returns"]
            regression = self._ols_with_tstats(y, x)
            weight = weights.get(symbol, 0.0)
            row: dict[str, float] = {}
            for idx, factor in enumerate(self.FACTORS):
                beta = float(regression["betas"][idx])
                t_stat = float(regression["t_stats"][idx])
                confidence = self._confidence_from_tstat(t_stat)
                row[factor] = beta
                portfolio[factor]["exposure"] += weight * beta
                portfolio[factor]["t_stat"] += weight * t_stat
                portfolio[factor]["confidence"] += weight * confidence
            holding_exposures[symbol] = row

        self._last_holding_exposures = holding_exposures
        self._last_portfolio_exposures = {
            factor: {
                "exposure": float(values["exposure"]),
                "t_stat": float(values["t_stat"]),
                "confidence": float(min(max(values["confidence"], 0.0), 0.999)),
            }
            for factor, values in portfolio.items()
        }
        return self._last_portfolio_exposures

    def attribute_returns(self, holdings: list[dict], factor_returns: dict, period: str) -> dict:
        """
        Decompose portfolio return into factor contributions.
        portfolio_return = sum(exposure_i * factor_return_i) + alpha
        Returns: {
            total_return: float,
            factor_contributions: {factor_name: float},
            alpha: float,
            r_squared: float
        }
        """
        del period
        exposures = {
            factor: float(self._last_portfolio_exposures.get(factor, {}).get("exposure", 0.0))
            for factor in self.FACTORS
        }
        factor_totals = {
            factor: float(np.sum(np.asarray(factor_returns.get(factor, []), dtype=float)))
            for factor in self.FACTORS
        }
        contributions = {
            factor: float(exposures[factor] * factor_totals[factor]) for factor in self.FACTORS
        }

        total_return = self._portfolio_total_return(holdings)
        explained = float(sum(contributions.values()))
        alpha = float(total_return - explained)
        r_squared = self._r_squared_from_series(holdings, factor_returns, exposures, alpha)
        return {
            "total_return": float(total_return),
            "factor_contributions": contributions,
            "alpha": alpha,
            "r_squared": r_squared,
        }

    def rolling_exposures(self, holdings: list[dict], universe_data: list[dict], window: int = 60) -> dict:
        """
        Compute factor exposures over rolling windows.
        Returns: {factor_name: [{date, exposure}]}
        """
        factor_returns = self.compute_factor_returns(universe_data)
        asset_map = self._prepare_universe_map(universe_data)
        portfolio_returns = self._portfolio_daily_returns(holdings, asset_map)
        x = self._factor_matrix(factor_returns)
        dates = self.factor_dates
        n_obs = min(len(portfolio_returns), x.shape[0], len(dates))
        if n_obs == 0:
            return {factor: [] for factor in self.FACTORS}

        if window <= 0:
            window = 60
        window = min(window, n_obs)
        if window < len(self.FACTORS) + 2:
            window = min(n_obs, len(self.FACTORS) + 2)

        out = {factor: [] for factor in self.FACTORS}
        for end in range(window, n_obs + 1):
            regression = self._ols_with_tstats(portfolio_returns[end - window : end], x[end - window : end])
            date = dates[end - 1]
            for idx, factor in enumerate(self.FACTORS):
                out[factor].append({"date": date, "exposure": float(regression["betas"][idx])})
        return out

    def _prepare_universe(self, universe_data: list[dict]) -> list[dict[str, object]]:
        prepared: list[dict[str, object]] = []
        min_len: Optional[int] = None
        for row in universe_data:
            symbol = str(row.get("symbol") or row.get("ticker") or "").strip().upper()
            dates, returns = self._extract_return_series(row)
            if not symbol or returns.size == 0:
                continue
            min_len = len(returns) if min_len is None else min(min_len, len(returns))
            prepared.append(
                {
                    "symbol": symbol,
                    "dates": dates,
                    "returns": returns,
                    "market_cap": self._safe_float(row.get("market_cap")),
                    "pb_ratio": self._safe_float(
                        row.get("pb_ratio", row.get("pb_calc", row.get("pb", row.get("price_to_book"))))
                    ),
                    "roe": self._safe_float(row.get("roe", row.get("roe_pct"))),
                    "beta": self._safe_float(row.get("beta")),
                    "momentum_12m": self._safe_float(row.get("momentum_12m", row.get("return_12m"))),
                }
            )

        if not prepared or min_len is None or min_len <= 0:
            return []

        normalized: list[dict[str, object]] = []
        for item in prepared:
            returns = np.asarray(item["returns"], dtype=float)[-min_len:]
            dates = list(item["dates"])[-min_len:]
            momentum_12m = float(item["momentum_12m"]) if float(item["momentum_12m"]) != 0.0 else float(np.sum(returns))
            normalized.append(
                {
                    **item,
                    "returns": returns,
                    "dates": dates,
                    "momentum_12m": momentum_12m,
                }
            )
        return normalized

    def _prepare_universe_map(self, universe_data: list[dict]) -> dict[str, dict[str, object]]:
        return {
            str(item["symbol"]): item
            for item in self._prepare_universe(universe_data)
        }

    def _extract_return_series(self, row: dict) -> tuple[list[str], np.ndarray]:
        raw_returns = row.get("returns")
        if isinstance(raw_returns, list) and raw_returns and isinstance(raw_returns[0], dict):
            dates = [str(item.get("date") or item.get("ts") or "") for item in raw_returns]
            values = np.asarray([self._safe_float(item.get("return")) for item in raw_returns], dtype=float)
            return dates, values
        if isinstance(raw_returns, list):
            values = np.asarray([self._safe_float(value) for value in raw_returns], dtype=float)
            dates = [str(value) for value in row.get("dates", [])] if isinstance(row.get("dates"), list) else []
            if len(dates) != len(values):
                dates = [f"t{i}" for i in range(len(values))]
            return dates, values
        return [], np.asarray([], dtype=float)

    def _spread_from_metric(self, prepared: list[dict[str, object]], metric: str, low_minus_high: bool) -> np.ndarray:
        n_assets = len(prepared)
        n_obs = len(prepared[0]["returns"]) if prepared else 0
        if n_assets == 0 or n_obs == 0:
            return np.asarray([], dtype=float)

        values = np.asarray([self._safe_float(item.get(metric)) for item in prepared], dtype=float)
        valid_mask = np.isfinite(values)
        if valid_mask.sum() < 2:
            return np.zeros(n_obs, dtype=float)

        if valid_mask.sum() < 5:
            threshold = float(np.median(values[valid_mask]))
            low_idx = np.where(valid_mask & (values <= threshold))[0]
            high_idx = np.where(valid_mask & (values > threshold))[0]
        else:
            low_cut = float(np.quantile(values[valid_mask], 0.2))
            high_cut = float(np.quantile(values[valid_mask], 0.8))
            low_idx = np.where(valid_mask & (values <= low_cut))[0]
            high_idx = np.where(valid_mask & (values >= high_cut))[0]

        if low_idx.size == 0 or high_idx.size == 0:
            return np.zeros(n_obs, dtype=float)

        low_ret = np.vstack([prepared[idx]["returns"] for idx in low_idx]).mean(axis=0)
        high_ret = np.vstack([prepared[idx]["returns"] for idx in high_idx]).mean(axis=0)
        return (low_ret - high_ret) if low_minus_high else (high_ret - low_ret)

    def _holding_weights(self, holdings: list[dict]) -> dict[str, float]:
        explicit = []
        for holding in holdings:
            symbol = str(holding.get("symbol") or holding.get("ticker") or "").strip().upper()
            if symbol and holding.get("weight") is not None:
                explicit.append((symbol, max(self._safe_float(holding.get("weight")), 0.0)))
        if explicit:
            total = sum(weight for _, weight in explicit)
            if total > 0:
                return {symbol: weight / total for symbol, weight in explicit}

        derived: list[tuple[str, float]] = []
        for holding in holdings:
            symbol = str(holding.get("symbol") or holding.get("ticker") or "").strip().upper()
            quantity = max(self._safe_float(holding.get("quantity"), 1.0), 0.0)
            price = max(
                self._safe_float(
                    holding.get("current_price", holding.get("price", holding.get("avg_buy_price")))
                ),
                0.0,
            )
            if symbol:
                derived.append((symbol, quantity * price if price > 0 else quantity))
        total = sum(weight for _, weight in derived)
        if total <= 0 and derived:
            equal = 1.0 / len(derived)
            return {symbol: equal for symbol, _ in derived}
        return {symbol: weight / total for symbol, weight in derived} if total > 0 else {}

    def _factor_matrix(self, factor_returns: dict) -> np.ndarray:
        series = [np.asarray(factor_returns.get(factor, []), dtype=float) for factor in self.FACTORS]
        if not series or any(item.size == 0 for item in series):
            return np.asarray([], dtype=float)
        n_obs = min(item.size for item in series)
        return np.column_stack([item[-n_obs:] for item in series])

    def _ols_with_tstats(self, y: np.ndarray, x: np.ndarray) -> dict[str, np.ndarray]:
        y_arr = np.asarray(y, dtype=float)
        x_arr = np.asarray(x, dtype=float)
        if y_arr.size == 0 or x_arr.size == 0:
            zeros = np.zeros(len(self.FACTORS), dtype=float)
            return {"betas": zeros, "t_stats": zeros}

        n_obs = min(len(y_arr), x_arr.shape[0])
        y_arr = y_arr[-n_obs:]
        x_arr = x_arr[-n_obs:]
        n_factors = x_arr.shape[1]
        design = np.column_stack([np.ones(n_obs), x_arr])

        if n_obs <= n_factors + 1:
            betas = np.asarray(
                [self._correlation_beta(y_arr, x_arr[:, idx]) for idx in range(n_factors)],
                dtype=float,
            )
            return {"betas": betas, "t_stats": np.zeros(n_factors, dtype=float)}

        coeffs, _, _, _ = np.linalg.lstsq(design, y_arr, rcond=None)
        residuals = y_arr - design @ coeffs
        dof = max(n_obs - design.shape[1], 1)
        sigma2 = float((residuals @ residuals) / dof)
        xtx_inv = np.linalg.pinv(design.T @ design)
        stderr = np.sqrt(np.maximum(np.diag(xtx_inv) * sigma2, 1e-12))
        betas = coeffs[1:]
        t_stats = betas / np.maximum(stderr[1:], 1e-12)
        return {"betas": betas.astype(float), "t_stats": t_stats.astype(float)}

    def _portfolio_total_return(self, holdings: list[dict]) -> float:
        weights = self._holding_weights(holdings)
        total = 0.0
        for holding in holdings:
            symbol = str(holding.get("symbol") or holding.get("ticker") or "").strip().upper()
            weight = weights.get(symbol, 0.0)
            if isinstance(holding.get("returns"), list):
                ret = float(np.sum(np.asarray(holding.get("returns"), dtype=float)))
            else:
                ret = self._safe_float(holding.get("return"))
            total += weight * ret
        return float(total)

    def _portfolio_daily_returns(self, holdings: list[dict], asset_map: dict[str, dict[str, object]]) -> np.ndarray:
        weights = self._holding_weights(holdings)
        if not asset_map:
            return np.asarray([], dtype=float)
        n_obs = min(len(np.asarray(item["returns"], dtype=float)) for item in asset_map.values())
        portfolio = np.zeros(n_obs, dtype=float)
        for holding in holdings:
            symbol = str(holding.get("symbol") or holding.get("ticker") or "").strip().upper()
            if symbol not in asset_map:
                continue
            portfolio += weights.get(symbol, 0.0) * np.asarray(asset_map[symbol]["returns"], dtype=float)[-n_obs:]
        return portfolio

    def _r_squared_from_series(
        self,
        holdings: list[dict],
        factor_returns: dict,
        exposures: dict[str, float],
        alpha: float,
    ) -> float:
        factor_matrix = self._factor_matrix(factor_returns)
        if factor_matrix.size == 0:
            return 0.0

        portfolio_series = None
        if holdings and isinstance(holdings[0].get("returns"), list):
            n_obs = min(len(holding.get("returns", [])) for holding in holdings if isinstance(holding.get("returns"), list))
            if n_obs > 0:
                weights = self._holding_weights(holdings)
                portfolio_series = np.zeros(n_obs, dtype=float)
                for holding in holdings:
                    symbol = str(holding.get("symbol") or holding.get("ticker") or "").strip().upper()
                    if not isinstance(holding.get("returns"), list):
                        continue
                    portfolio_series += weights.get(symbol, 0.0) * np.asarray(holding["returns"], dtype=float)[-n_obs:]
        if portfolio_series is None or portfolio_series.size == 0:
            return 0.0

        n_obs = min(len(portfolio_series), factor_matrix.shape[0])
        portfolio_series = portfolio_series[-n_obs:]
        factor_matrix = factor_matrix[-n_obs:]
        beta_vec = np.asarray([exposures[factor] for factor in self.FACTORS], dtype=float)
        predicted = factor_matrix @ beta_vec + (alpha / max(n_obs, 1))
        ss_res = float(np.sum((portfolio_series - predicted) ** 2))
        ss_tot = float(np.sum((portfolio_series - float(np.mean(portfolio_series))) ** 2))
        if ss_tot <= 1e-12:
            return 0.0
        return float(max(0.0, min(1.0, 1.0 - (ss_res / ss_tot))))

    def _correlation_beta(self, y: np.ndarray, x: np.ndarray) -> float:
        x_std = float(np.std(x, ddof=1)) if len(x) > 1 else 0.0
        y_std = float(np.std(y, ddof=1)) if len(y) > 1 else 0.0
        if x_std <= 1e-12 or y_std <= 1e-12:
            return 0.0
        corr = float(np.corrcoef(y, x)[0, 1])
        return corr * (y_std / x_std)

    def _confidence_from_tstat(self, t_stat: float) -> float:
        return float(min(max(abs(t_stat) / (abs(t_stat) + 2.0), 0.0), 0.999))

    def _safe_float(self, value: object, default: float = 0.0) -> float:
        try:
            if value is None:
                return default
            if isinstance(value, str) and not value.strip():
                return default
            return float(value)
        except (TypeError, ValueError):
            return default
