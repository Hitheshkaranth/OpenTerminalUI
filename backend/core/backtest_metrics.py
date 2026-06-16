from __future__ import annotations
import numpy as np
import pandas as pd

def _safe_float(val) -> float:
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except Exception:
        return 0.0

def _equity_series(equity_curve: list[dict]) -> pd.Series:
    if not equity_curve:
        return pd.Series(dtype=float)
    df = pd.DataFrame(equity_curve)
    if "date" not in df or "equity" not in df:
        return pd.Series(dtype=float)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["equity"] = pd.to_numeric(df["equity"], errors="coerce")
    df = df.dropna(subset=["date", "equity"]).sort_values("date")
    if df.empty:
        return pd.Series(dtype=float)
    return df.set_index("date")["equity"]

def compute_performance_metrics(equity_curve: list[dict], *, risk_free_rate: float = 0.0, periods_per_year: int = 252) -> dict:
    eq = _equity_series(equity_curve)
    
    empty_result = {
        "total_return": 0.0, "years": 0.0, "cagr": 0.0, "volatility": 0.0,
        "downside_deviation": 0.0, "sharpe": 0.0, "sortino": 0.0, "max_drawdown": 0.0,
        "calmar": 0.0, "recovery_factor": 0.0, "ulcer_index": 0.0, "var_95": 0.0,
        "cvar_95": 0.0, "omega_ratio": 0.0, "tail_ratio": 0.0, "skew": 0.0,
        "kurtosis": 0.0, "best_day": 0.0, "worst_day": 0.0, "win_rate_days": 0.0,
        "avg_up_day": 0.0, "avg_down_day": 0.0, "best_month": 0.0, "worst_month": 0.0,
        "positive_months_pct": 0.0, "avg_month": 0.0, "n_obs": 0
    }

    if len(eq) < 2:
        return empty_result

    r = eq.pct_change().dropna()
    if r.empty:
        return empty_result
    
    rf_daily = risk_free_rate / periods_per_year
    
    total_return = eq.iloc[-1] / eq.iloc[0] - 1
    years = max((eq.index[-1] - eq.index[0]).days / 365.25, 1e-9)
    cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / years) - 1 if eq.iloc[0] > 0 else 0.0
    volatility = r.std(ddof=1) * np.sqrt(periods_per_year)
    
    downside = r[r < 0]
    downside_deviation = downside.std(ddof=1) * np.sqrt(periods_per_year) if not downside.empty else 0.0
    
    sharpe = (r.mean() - rf_daily) / r.std(ddof=1) * np.sqrt(periods_per_year) if r.std(ddof=1) != 0 else 0.0
    sortino = (r.mean() - rf_daily) / downside.std(ddof=1) * np.sqrt(periods_per_year) if not downside.empty and downside.std(ddof=1) != 0 else 0.0
    
    cummax = eq.cummax()
    dd = eq / cummax - 1
    max_drawdown = dd.min()
    
    calmar = cagr / abs(max_drawdown) if max_drawdown != 0 else 0.0
    recovery_factor = total_return / abs(max_drawdown) if max_drawdown != 0 else 0.0
    ulcer_index = np.sqrt(np.mean((dd * 100) ** 2))
    
    var_95 = np.percentile(r, 5)
    cvar_95 = r[r <= var_95].mean() if not r[r <= var_95].empty else 0.0
    
    pos_sum = r[r > 0].sum()
    neg_sum = abs(r[r < 0].sum())
    omega_ratio = pos_sum / neg_sum if neg_sum != 0 else 0.0
    
    p95 = np.percentile(r, 95)
    p5 = np.percentile(r, 5)
    tail_ratio = abs(p95 / p5) if p5 != 0 else 0.0
    
    skew = r.skew()
    kurtosis = r.kurtosis()
    
    best_day = r.max()
    worst_day = r.min()
    win_rate_days = (r > 0).mean() * 100
    avg_up_day = r[r > 0].mean() * 100 if not r[r > 0].empty else 0.0
    avg_down_day = r[r < 0].mean() * 100 if not r[r < 0].empty else 0.0
    
    monthly = eq.resample("ME").last().pct_change().dropna()
    if not monthly.empty:
        best_month = monthly.max() * 100
        worst_month = monthly.min() * 100
        positive_months_pct = (monthly > 0).mean() * 100
        avg_month = monthly.mean() * 100
    else:
        best_month = 0.0
        worst_month = 0.0
        positive_months_pct = 0.0
        avg_month = 0.0

    return {
        "total_return": _safe_float(total_return),
        "years": _safe_float(years),
        "cagr": _safe_float(cagr),
        "volatility": _safe_float(volatility),
        "downside_deviation": _safe_float(downside_deviation),
        "sharpe": _safe_float(sharpe),
        "sortino": _safe_float(sortino),
        "max_drawdown": _safe_float(max_drawdown),
        "calmar": _safe_float(calmar),
        "recovery_factor": _safe_float(recovery_factor),
        "ulcer_index": _safe_float(ulcer_index),
        "var_95": _safe_float(var_95),
        "cvar_95": _safe_float(cvar_95),
        "omega_ratio": _safe_float(omega_ratio),
        "tail_ratio": _safe_float(tail_ratio),
        "skew": _safe_float(skew),
        "kurtosis": _safe_float(kurtosis),
        "best_day": _safe_float(best_day),
        "worst_day": _safe_float(worst_day),
        "win_rate_days": _safe_float(win_rate_days),
        "avg_up_day": _safe_float(avg_up_day),
        "avg_down_day": _safe_float(avg_down_day),
        "best_month": _safe_float(best_month),
        "worst_month": _safe_float(worst_month),
        "positive_months_pct": _safe_float(positive_months_pct),
        "avg_month": _safe_float(avg_month),
        "n_obs": int(len(r))
    }

def compute_scenario_projections(equity_curve: list[dict], *, periods_per_year: int = 252) -> dict:
    eq = _equity_series(equity_curve)
    if len(eq) < 2:
        return {
            "annual_return_mean": 0.0,
            "annual_volatility": 0.0,
            "current_equity": _safe_float(eq.iloc[-1]) if not eq.empty else 0.0,
            "scenarios": []
        }
    
    r = eq.pct_change().dropna()
    ann_mu = r.mean() * periods_per_year
    ann_sigma = r.std(ddof=1) * np.sqrt(periods_per_year)
    current = eq.iloc[-1]
    
    scenarios = []
    configs = [
        ("Very Good", 1.5),
        ("Good", 0.5),
        ("Average", 0.0),
        ("Bad", -0.5),
        ("Very Bad", -1.5)
    ]
    
    for label, k in configs:
        ret_pct = (ann_mu + k * ann_sigma) * 100
        proj_equity = current * (1 + ann_mu + k * ann_sigma)
        scenarios.append({
            "label": label,
            "return_pct": _safe_float(ret_pct),
            "projected_equity": _safe_float(proj_equity)
        })
        
    return {
        "annual_return_mean": _safe_float(ann_mu * 100),
        "annual_volatility": _safe_float(ann_sigma * 100),
        "current_equity": _safe_float(current),
        "scenarios": scenarios
    }

def compute_benchmark_comparison(strategy_equity: list[dict], benchmark_equity: list[dict], *, risk_free_rate: float = 0.0, periods_per_year: int = 252) -> dict:
    s_eq = _equity_series(strategy_equity)
    b_eq = _equity_series(benchmark_equity)
    
    empty_result = {
        "beta": 0.0, "correlation": 0.0, "alpha_annual": 0.0,
        "tracking_error": 0.0, "information_ratio": 0.0,
        "up_capture": 0.0, "down_capture": 0.0,
        "strategy_cagr": 0.0, "benchmark_cagr": 0.0, "n_obs": 0
    }
    
    if s_eq.empty or b_eq.empty:
        return empty_result
        
    combined = pd.DataFrame({"strategy": s_eq, "benchmark": b_eq}).dropna()
    if len(combined) < 2:
        return empty_result
        
    rs = combined["strategy"].pct_change().dropna()
    rb = combined["benchmark"].pct_change().dropna()
    
    if len(rs) < 1:
        return empty_result
        
    rf_daily = risk_free_rate / periods_per_year
    
    cov_matrix = np.cov(rs, rb)
    beta = cov_matrix[0, 1] / cov_matrix[1, 1] if cov_matrix[1, 1] != 0 else 0.0
    correlation = np.corrcoef(rs, rb)[0, 1] if np.std(rs) != 0 and np.std(rb) != 0 else 0.0
    
    alpha_annual = (rs.mean() - (rf_daily + beta * (rb.mean() - rf_daily))) * periods_per_year
    tracking_error = (rs - rb).std(ddof=1) * np.sqrt(periods_per_year)
    information_ratio = ((rs - rb).mean() * periods_per_year) / tracking_error if tracking_error != 0 else 0.0
    
    up_rs = rs[rb > 0]
    up_rb = rb[rb > 0]
    up_capture = up_rs.mean() / up_rb.mean() if not up_rb.empty and up_rb.mean() != 0 else 0.0
    
    down_rs = rs[rb < 0]
    down_rb = rb[rb < 0]
    down_capture = down_rs.mean() / down_rb.mean() if not down_rb.empty and down_rb.mean() != 0 else 0.0
    
    def calc_cagr(series):
        years = max((series.index[-1] - series.index[0]).days / 365.25, 1e-9)
        return (series.iloc[-1] / series.iloc[0]) ** (1 / years) - 1 if series.iloc[0] > 0 else 0.0
        
    strategy_cagr = calc_cagr(combined["strategy"])
    benchmark_cagr = calc_cagr(combined["benchmark"])
    
    return {
        "beta": _safe_float(beta),
        "correlation": _safe_float(correlation),
        "alpha_annual": _safe_float(alpha_annual),
        "tracking_error": _safe_float(tracking_error),
        "information_ratio": _safe_float(information_ratio),
        "up_capture": _safe_float(up_capture),
        "down_capture": _safe_float(down_capture),
        "strategy_cagr": _safe_float(strategy_cagr),
        "benchmark_cagr": _safe_float(benchmark_cagr),
        "n_obs": int(len(rs))
    }
