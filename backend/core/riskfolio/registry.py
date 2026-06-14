def list_methods() -> dict:
    """
    Return available optimization models, objectives, and risk measures.
    """
    return {
        "objectives": [
            {"id": "min_risk", "label": "Minimum Risk"},
            {"id": "max_sharpe", "label": "Maximum Sharpe"},
            {"id": "max_return", "label": "Maximum Return"},
            {"id": "utility", "label": "Maximum Utility"}
        ],
        "risk_measures": [
            {"id": "MV", "label": "Variance"},
            {"id": "MAD", "label": "Mean Absolute Deviation"},
            {"id": "CVaR", "label": "Conditional VaR"},
            {"id": "CDaR", "label": "Conditional Drawdown at Risk"},
            {"id": "MDD", "label": "Max Drawdown"},
            {"id": "ULCER", "label": "Ulcer Index"}
        ],
        "models": [
            {"id": "Classic", "label": "Mean-Risk (Classic)"},
            {"id": "HRP", "label": "Hierarchical Risk Parity"},
            {"id": "HERC", "label": "Hierarchical Equal Risk Contribution"},
            {"id": "BL", "label": "Black-Litterman"},
            {"id": "RP", "label": "Risk Parity (ERC)"},
            {"id": "NCO", "label": "Nested Clustered Optimization"}
        ],
        "covariance_methods": [
            {"id": "sample", "label": "Sample"},
            {"id": "ledoit_wolf", "label": "Ledoit-Wolf Shrinkage"},
            {"id": "ewma", "label": "EWMA"},
            {"id": "gerber", "label": "Gerber Statistic"}
        ]
    }
