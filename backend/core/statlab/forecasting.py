import pandas as pd
import numpy as np
import warnings
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.holtwinters import ExponentialSmoothing

# Suppress statsmodels warnings
warnings.filterwarnings("ignore")

def _safe_float(val):
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return 0.0
        return round(f, 6)
    except:
        return 0.0

def _to_json_list(dates, values):
    return [{"date": d.strftime("%Y-%m-%d"), "value": _safe_float(v)} for d, v in zip(dates, values)]

def forecast_series(prices, *, method: str = "arima", horizon: int = 30) -> dict:
    if len(prices) < 30:
        raise ValueError("Series too short (minimum 30 points required)")

    # Ensure DatetimeIndex
    if not isinstance(prices.index, pd.DatetimeIndex):
        prices.index = pd.to_datetime(prices.index)
    
    # Sort and handle duplicates
    prices = prices.sort_index()
    prices = prices[~prices.index.duplicated(keep='last')]
    
    last_val = float(prices.iloc[-1])
    history_subset = prices.iloc[-250:]
    history_json = [{"date": d.strftime("%Y-%m-%d"), "value": _safe_float(v)} for d, v in history_subset.items()]
    
    future_dates = pd.bdate_range(start=prices.index[-1] + pd.Timedelta(days=1), periods=horizon)
    
    res_forecast = []
    model_info = {"aic": 0.0, "order": "N/A"}
    rmse_in_sample = 0.0
    
    success = False
    
    if method == "arima":
        for order in [(5, 1, 0), (1, 1, 0), (0, 1, 1)]:
            try:
                model = ARIMA(prices, order=order)
                model_fit = model.fit()
                forecast_res = model_fit.get_forecast(horizon)
                mean = forecast_res.predicted_mean
                conf_int = forecast_res.conf_int(alpha=0.05)
                
                res_forecast = [
                    {
                        "date": d.strftime("%Y-%m-%d"),
                        "mean": _safe_float(mean.iloc[i]),
                        "lower": _safe_float(conf_int.iloc[i, 0]),
                        "upper": _safe_float(conf_int.iloc[i, 1])
                    }
                    for i, d in enumerate(future_dates)
                ]
                model_info = {"aic": _safe_float(model_fit.aic), "order": str(order)}
                rmse_in_sample = _safe_float(np.sqrt(np.mean(model_fit.resid**2)))
                success = True
                break
            except Exception:
                continue
                
    elif method == "ets":
        try:
            model = ExponentialSmoothing(prices, trend="add", seasonal=None)
            model_fit = model.fit()
            mean = model_fit.forecast(horizon)
            resid_std = np.std(model_fit.resid)
            
            res_forecast = [
                {
                    "date": d.strftime("%Y-%m-%d"),
                    "mean": _safe_float(mean.iloc[i]),
                    "lower": _safe_float(mean.iloc[i] - 1.96 * resid_std),
                    "upper": _safe_float(mean.iloc[i] + 1.96 * resid_std)
                }
                for i, d in enumerate(future_dates)
            ]
            model_info = {"aic": _safe_float(model_fit.aic), "order": "ETS(add)"}
            rmse_in_sample = _safe_float(np.sqrt(np.mean(model_fit.resid**2)))
            success = True
        except Exception:
            pass

    if not success:
        # Naive fallback
        std = np.std(prices.diff().dropna())
        res_forecast = [
            {
                "date": d.strftime("%Y-%m-%d"),
                "mean": _safe_float(last_val),
                "lower": _safe_float(last_val - (i + 1) * 0.1 * std * 1.96),
                "upper": _safe_float(last_val + (i + 1) * 0.1 * std * 1.96)
            }
            for i, d in enumerate(future_dates)
        ]
        model_info = {"aic": 0.0, "order": "Naive Fallback"}
        rmse_in_sample = 0.0

    return {
        "method": method,
        "history": history_json,
        "forecast": res_forecast,
        "model": model_info,
        "metrics": {"rmse_in_sample": rmse_in_sample}
    }
