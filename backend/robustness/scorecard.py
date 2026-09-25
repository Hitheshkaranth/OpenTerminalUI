from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Any

import numpy as np

try:
    from scipy.stats import norm
except Exception:  # pragma: no cover - exercised only without scipy installed.
    norm = None


EULER_GAMMA = 0.5772156649


def compute_robustness(
    returns: Iterable[float],
    *,
    num_trials: int = 1,
    bootstrap_paths: int = 2000,
    block_size: int = 10,
    benchmark_sharpe: float = 0.0,
    periods_per_year: int = 252,
    seed: int | None = None,
) -> dict[str, Any]:
    """Compute a statistical robustness and overfitting scorecard for returns.

    Sharpe, Probabilistic Sharpe Ratio (PSR), and Minimum Track Record Length
    use Bailey & López de Prado, "The Sharpe Ratio Efficient Frontier" (2012).
    Deflated Sharpe Ratio (DSR) follows Bailey & López de Prado, "The Deflated
    Sharpe Ratio" (2014). DSR normally estimates Sharpe variance across trials;
    with one observed series, this implementation uses the asymptotic single
    series Sharpe estimator variance:
    ``(1 - skew * SR + (excess_kurtosis / 4) * SR**2) / (n - 1)``.
    """

    values = _clean_returns(returns)
    n = int(values.size)
    ppy = max(int(periods_per_year), 1)
    num_trials = max(int(num_trials), 1)
    bootstrap_paths = max(int(bootstrap_paths), 0)
    block_size = max(int(block_size), 1)
    benchmark_period_sharpe = float(benchmark_sharpe) / math.sqrt(ppy)

    if n < 2:
        return _insufficient_result(
            n=n,
            periods_per_year=ppy,
            benchmark_sharpe=benchmark_sharpe,
            reason="Need at least two returns to estimate dispersion.",
        )

    mean_return = float(np.mean(values))
    std_return = float(np.std(values, ddof=1))
    skew = _sample_skew(values)
    excess_kurtosis = _sample_excess_kurtosis(values)
    period_sharpe = _safe_div(mean_return, std_return)
    annual_sharpe = period_sharpe * math.sqrt(ppy) if period_sharpe is not None else None

    psr = _probabilistic_sharpe_ratio(
        period_sharpe,
        benchmark_period_sharpe,
        n=n,
        skew=skew,
        excess_kurtosis=excess_kurtosis,
    )
    variance_numerator = _sharpe_variance_numerator(period_sharpe, skew, excess_kurtosis)
    var_sr = variance_numerator / (n - 1) if variance_numerator is not None and n > 1 else None

    if num_trials == 1:
        deflated_benchmark_period_sharpe = benchmark_period_sharpe
    else:
        deflated_benchmark_period_sharpe = _deflated_benchmark(var_sr, num_trials)
    dsr = _probabilistic_sharpe_ratio(
        period_sharpe,
        deflated_benchmark_period_sharpe,
        n=n,
        skew=skew,
        excess_kurtosis=excess_kurtosis,
    )

    min_track_record_length = _minimum_track_record_length(
        period_sharpe,
        benchmark_period_sharpe,
        skew=skew,
        excess_kurtosis=excess_kurtosis,
        confidence=0.95,
    )
    bootstrap = _bootstrap_summary(
        values,
        paths=bootstrap_paths,
        block_size=block_size,
        periods_per_year=ppy,
        seed=seed,
    )
    stability = _rolling_sharpe_stability(values)
    verdict, verdict_reasons = _verdict(
        n=n,
        annual_sharpe=annual_sharpe,
        psr=psr,
        dsr=dsr,
        num_trials=num_trials,
        bootstrap=bootstrap,
    )

    return {
        "n_periods": n,
        "periods_per_year": ppy,
        "mean_return": mean_return,
        "std_return": std_return,
        "period_sharpe": period_sharpe,
        "annual_sharpe": annual_sharpe,
        "skew": skew,
        "kurtosis": excess_kurtosis,
        "excess_kurtosis": excess_kurtosis,
        "benchmark_sharpe": float(benchmark_sharpe),
        "benchmark_period_sharpe": benchmark_period_sharpe,
        "psr": psr,
        "dsr": dsr,
        "num_trials": num_trials,
        "deflated_benchmark_period_sharpe": deflated_benchmark_period_sharpe,
        "deflated_benchmark_annual_sharpe": (
            deflated_benchmark_period_sharpe * math.sqrt(ppy)
            if deflated_benchmark_period_sharpe is not None
            else None
        ),
        "sharpe_variance": var_sr,
        "min_track_record_length": min_track_record_length,
        "bootstrap": bootstrap,
        "stability": stability,
        "verdict": verdict,
        "verdict_reasons": verdict_reasons,
    }


def _clean_returns(returns: Iterable[float]) -> np.ndarray:
    try:
        arr = np.asarray(list(returns), dtype=float).reshape(-1)
    except Exception:
        return np.asarray([], dtype=float)
    return arr[np.isfinite(arr)]


def _insufficient_result(
    *,
    n: int,
    periods_per_year: int,
    benchmark_sharpe: float,
    reason: str,
) -> dict[str, Any]:
    return {
        "n_periods": n,
        "periods_per_year": periods_per_year,
        "mean_return": None,
        "std_return": None,
        "period_sharpe": None,
        "annual_sharpe": None,
        "skew": None,
        "kurtosis": None,
        "excess_kurtosis": None,
        "benchmark_sharpe": float(benchmark_sharpe),
        "benchmark_period_sharpe": float(benchmark_sharpe) / math.sqrt(periods_per_year),
        "psr": None,
        "dsr": None,
        "num_trials": None,
        "deflated_benchmark_period_sharpe": None,
        "deflated_benchmark_annual_sharpe": None,
        "sharpe_variance": None,
        "min_track_record_length": None,
        "bootstrap": None,
        "stability": {
            "rolling_window": None,
            "num_windows": 0,
            "pct_windows_positive_sharpe": None,
            "sharpe_stability": None,
        },
        "verdict": "insufficient",
        "verdict_reasons": [reason],
    }


def _sample_skew(values: np.ndarray) -> float:
    n = values.size
    if n < 3:
        return 0.0
    centered = values - np.mean(values)
    std = float(np.std(values, ddof=1))
    if std <= 0:
        return 0.0
    return float((n / ((n - 1) * (n - 2))) * np.sum((centered / std) ** 3))


def _sample_excess_kurtosis(values: np.ndarray) -> float:
    n = values.size
    if n < 4:
        return 0.0
    centered = values - np.mean(values)
    std = float(np.std(values, ddof=1))
    if std <= 0:
        return 0.0
    z4_sum = float(np.sum((centered / std) ** 4))
    return float((n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * z4_sum - (3 * (n - 1) ** 2 / ((n - 2) * (n - 3))))


def _safe_div(numerator: float, denominator: float) -> float | None:
    if not math.isfinite(numerator) or not math.isfinite(denominator) or denominator <= 0:
        return None
    return float(numerator / denominator)


def _probabilistic_sharpe_ratio(
    sr: float | None,
    benchmark_sr: float | None,
    *,
    n: int,
    skew: float,
    excess_kurtosis: float,
) -> float | None:
    if sr is None or benchmark_sr is None or n < 2:
        return None
    numerator = (sr - benchmark_sr) * math.sqrt(n - 1)
    variance_numerator = _sharpe_variance_numerator(sr, skew, excess_kurtosis)
    if variance_numerator is None or variance_numerator <= 0:
        return 1.0 if sr > benchmark_sr else 0.0 if sr < benchmark_sr else 0.5
    z_score = numerator / math.sqrt(variance_numerator)
    return _normal_cdf(z_score)


def _sharpe_variance_numerator(
    sr: float | None,
    skew: float,
    excess_kurtosis: float,
) -> float | None:
    if sr is None:
        return None
    value = 1.0 - skew * sr + (excess_kurtosis / 4.0) * sr**2
    if not math.isfinite(value):
        return None
    return max(float(value), 0.0)


def _deflated_benchmark(var_sr: float | None, num_trials: int) -> float | None:
    if var_sr is None or var_sr < 0:
        return None
    n_trials = max(int(num_trials), 1)
    if n_trials == 1:
        return 0.0
    p1 = 1.0 - (1.0 / n_trials)
    p2 = 1.0 - (1.0 / (n_trials * math.e))
    expected_max = (1.0 - EULER_GAMMA) * _normal_ppf(p1) + EULER_GAMMA * _normal_ppf(p2)
    return float(math.sqrt(var_sr) * expected_max)


def _minimum_track_record_length(
    sr: float | None,
    benchmark_sr: float,
    *,
    skew: float,
    excess_kurtosis: float,
    confidence: float,
) -> int | None:
    if sr is None or sr <= benchmark_sr:
        return None
    variance_numerator = _sharpe_variance_numerator(sr, skew, excess_kurtosis)
    if variance_numerator is None:
        return None
    z = _normal_ppf(confidence)
    required = 1.0 + variance_numerator * (z / (sr - benchmark_sr)) ** 2
    if not math.isfinite(required):
        return None
    return max(2, int(math.ceil(required)))


def _bootstrap_summary(
    values: np.ndarray,
    *,
    paths: int,
    block_size: int,
    periods_per_year: int,
    seed: int | None,
) -> dict[str, Any]:
    metric_names = ("sharpe", "cagr", "sortino", "max_drawdown")
    if paths <= 0 or values.size < 2:
        return {
            "method": "block_bootstrap",
            "paths": 0,
            **{name: _metric_summary(np.asarray([], dtype=float)) for name in metric_names},
        }

    rng = np.random.default_rng(seed)
    metrics = {name: np.empty(paths, dtype=float) for name in metric_names}
    for i in range(paths):
        sample = _moving_block_resample(values, block_size=block_size, rng=rng)
        metrics["sharpe"][i] = _annual_sharpe(sample, periods_per_year)
        metrics["cagr"][i] = _cagr(sample, periods_per_year)
        metrics["sortino"][i] = _sortino(sample, periods_per_year)
        metrics["max_drawdown"][i] = _max_drawdown(sample)
    return {
        "method": "block_bootstrap",
        "paths": paths,
        **{name: _metric_summary(series) for name, series in metrics.items()},
    }


def _moving_block_resample(values: np.ndarray, *, block_size: int, rng: np.random.Generator) -> np.ndarray:
    n = values.size
    if n == 0:
        return values.copy()
    if block_size <= 1:
        return rng.choice(values, size=n, replace=True)
    starts = rng.integers(0, n, size=math.ceil(n / block_size))
    pieces = [values[(start + np.arange(block_size)) % n] for start in starts]
    return np.concatenate(pieces)[:n]


def _annual_sharpe(values: np.ndarray, periods_per_year: int) -> float:
    std = float(np.std(values, ddof=1)) if values.size > 1 else 0.0
    sr = _safe_div(float(np.mean(values)), std)
    return float(sr * math.sqrt(periods_per_year)) if sr is not None else float("nan")


def _cagr(values: np.ndarray, periods_per_year: int) -> float:
    compounded = float(np.prod(1.0 + values))
    if compounded <= 0 or not math.isfinite(compounded):
        return float("nan")
    return float(compounded ** (periods_per_year / values.size) - 1.0)


def _sortino(values: np.ndarray, periods_per_year: int) -> float:
    downside = values[values < 0.0]
    downside_std = float(np.std(downside, ddof=1)) if downside.size > 1 else 0.0
    ratio = _safe_div(float(np.mean(values)), downside_std)
    return float(ratio * math.sqrt(periods_per_year)) if ratio is not None else float("nan")


def _max_drawdown(values: np.ndarray) -> float:
    equity = np.cumprod(1.0 + values)
    peaks = np.maximum.accumulate(equity)
    # A path wiped out before any positive peak has equity == peak == 0: a 100% loss, not NaN.
    drawdowns = np.where(peaks > 0, equity / np.where(peaks > 0, peaks, 1.0) - 1.0, -1.0)
    return float(np.min(drawdowns))


def _metric_summary(values: np.ndarray) -> dict[str, float | None]:
    clean = values[np.isfinite(values)]
    if clean.size == 0:
        return {"mean": None, "ci_low": None, "ci_high": None, "p_positive": None}
    return {
        "mean": float(np.mean(clean)),
        "ci_low": float(np.percentile(clean, 2.5)),
        "ci_high": float(np.percentile(clean, 97.5)),
        "p_positive": float(np.mean(clean > 0.0)),
    }


def _rolling_sharpe_stability(values: np.ndarray) -> dict[str, float | int | None]:
    n = values.size
    if n < 4:
        return {
            "rolling_window": None,
            "num_windows": 0,
            "pct_windows_positive_sharpe": None,
            "sharpe_stability": None,
        }
    window = max(2, min(63, n // 4))
    if n < window:
        return {
            "rolling_window": window,
            "num_windows": 0,
            "pct_windows_positive_sharpe": None,
            "sharpe_stability": None,
        }
    sharpes = []
    for start in range(0, n - window + 1):
        segment = values[start : start + window]
        sr = _safe_div(float(np.mean(segment)), float(np.std(segment, ddof=1)))
        if sr is not None:
            sharpes.append(sr)
    if not sharpes:
        return {
            "rolling_window": window,
            "num_windows": 0,
            "pct_windows_positive_sharpe": None,
            "sharpe_stability": None,
        }
    series = np.asarray(sharpes, dtype=float)
    mean_abs = abs(float(np.mean(series)))
    stability = 1.0 - (float(np.std(series, ddof=1)) if series.size > 1 else 0.0) / (mean_abs + 1e-9)
    return {
        "rolling_window": window,
        "num_windows": int(series.size),
        "pct_windows_positive_sharpe": float(np.mean(series > 0.0)),
        "sharpe_stability": float(np.clip(stability, 0.0, 1.0)),
    }


def _verdict(
    *,
    n: int,
    annual_sharpe: float | None,
    psr: float | None,
    dsr: float | None,
    num_trials: int,
    bootstrap: dict[str, Any],
) -> tuple[str, list[str]]:
    if n < 60:
        return "insufficient", ["Fewer than 60 returns; statistical estimates are unstable."]
    if annual_sharpe is not None and annual_sharpe > 1.0 and dsr is not None and dsr < 0.5:
        return "overfit", ["Annualized Sharpe is high, but Deflated Sharpe confidence is below 0.50."]

    sharpe_ci_low = bootstrap.get("sharpe", {}).get("ci_low")
    is_robust = (
        psr is not None
        and psr >= 0.95
        and sharpe_ci_low is not None
        and sharpe_ci_low > 0.0
        and (num_trials == 1 or (dsr is not None and dsr >= 0.9))
    )
    if is_robust:
        return "robust", ["PSR is high, bootstrap Sharpe confidence interval is positive, and DSR passes the trial adjustment."]

    reasons = []
    if psr is None or psr < 0.95:
        reasons.append("PSR is below 0.95.")
    if sharpe_ci_low is None or sharpe_ci_low <= 0.0:
        reasons.append("Bootstrap Sharpe confidence interval includes or falls below zero.")
    if num_trials > 1 and (dsr is None or dsr < 0.9):
        reasons.append("DSR is below 0.90 after accounting for multiple trials.")
    return "fragile", reasons or ["Robustness criteria were not fully met."]


def _normal_cdf(value: float) -> float:
    if norm is not None:
        return float(norm.cdf(value))
    return float(0.5 * (1.0 + math.erf(value / math.sqrt(2.0))))


def _normal_ppf(probability: float) -> float:
    clipped = min(max(float(probability), 1e-12), 1.0 - 1e-12)
    if norm is not None:
        return float(norm.ppf(clipped))
    return _acklam_normal_ppf(clipped)


def _acklam_normal_ppf(p: float) -> float:
    """Rational approximation of the inverse standard normal CDF by Peter Acklam."""

    a = [
        -3.969683028665376e01,
        2.209460984245205e02,
        -2.759285104469687e02,
        1.383577518672690e02,
        -3.066479806614716e01,
        2.506628277459239e00,
    ]
    b = [
        -5.447609879822406e01,
        1.615858368580409e02,
        -1.556989798598866e02,
        6.680131188771972e01,
        -1.328068155288572e01,
    ]
    c = [
        -7.784894002430293e-03,
        -3.223964580411365e-01,
        -2.400758277161838e00,
        -2.549732539343734e00,
        4.374664141464968e00,
        2.938163982698783e00,
    ]
    d = [
        7.784695709041462e-03,
        3.224671290700398e-01,
        2.445134137142996e00,
        3.754408661907416e00,
    ]
    plow = 0.02425
    phigh = 1.0 - plow
    if p < plow:
        q = math.sqrt(-2.0 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
            (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0
        )
    if p <= phigh:
        q = p - 0.5
        r = q * q
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)
        )
    q = math.sqrt(-2.0 * math.log(1.0 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / (
        (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0
    )
