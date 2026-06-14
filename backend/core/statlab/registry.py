def list_methods() -> dict:
    return {
        "forecast_methods": [
            {"id": "arima", "label": "ARIMA (5,1,0)"},
            {"id": "ets", "label": "Holt-Winters (ETS)"}
        ],
        "stationarity_methods": [
            {"id": "adf", "label": "Augmented Dickey-Fuller"},
            {"id": "kpss", "label": "KPSS"}
        ],
        "decomposition_methods": [
            {"id": "stl", "label": "STL Decomposition"}
        ]
    }
