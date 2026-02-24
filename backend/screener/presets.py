from __future__ import annotations

from typing import Any


def _preset(
    key: str,
    name: str,
    category: str,
    query: str,
    description: str,
    model_scores: list[str] | None = None,
    default_sort: str | None = None,
    viz: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    return (
        key,
        {
            "id": key,
            "name": name,
            "category": category,
            "description": description,
            "query": query,
            "default_sort": default_sort or "market_cap DESC",
            "columns": [
                "ticker",
                "company",
                "sector",
                "market_cap",
                "pe",
                "roe",
                "roce",
                "debt_equity",
                "price_1y_return",
            ],
            "model_scores": model_scores or [],
            "viz_config": viz
            or {
                "primary": {"type": "scatter", "x": "pe", "y": "roe", "size": "market_cap"},
                "secondary": {"type": "histogram", "field": "roe", "bins": 20},
            },
        },
    )


_PRESETS = [
    _preset("buffett_quality_moat", "Warren Buffett Quality Moat", "guru", "ROE > 15 AND ROCE > 12 AND Debt to equity < 0.5 AND Revenue Growth > 8 AND OPM > 15 AND Free Cash Flow > 0 AND Market Capitalization > 500", "High-quality businesses with durable competitive advantages at fair valuations", ["buffett"], "quality_score DESC", {"primary": {"type": "radar", "axes": ["roe", "roce", "opm", "fcf_yield", "debt_equity", "revenue_growth"]}, "secondary": {"type": "line", "field": "roe", "periods": 10}}),
    _preset("greenblatt_magic_formula", "Joel Greenblatt Magic Formula", "guru", "Market Capitalization > 200", "Cheap stocks with high earnings yield and high return on capital", ["greenblatt"], "magic_combined_rank ASC", {"primary": {"type": "scatter", "x": "earnings_yield", "y": "return_on_capital", "color": "magic_combined_rank"}, "secondary": {"type": "histogram", "field": "magic_combined_rank", "bins": 20}}),
    _preset("graham_net_net", "Benjamin Graham Net-Net", "guru", "Current Ratio > 1.5", "Deep value NCAV discount screen", ["graham"], "market_cap ASC"),
    _preset("graham_defensive", "Benjamin Graham Defensive", "guru", "Market Capitalization > 1000 AND Current Ratio > 2 AND PE < 15 AND PB < 1.5", "Defensive investor checklist", ["graham"]),
    _preset("piotroski_f_score", "Piotroski F-Score >= 8", "guru", "Piotroski F-Score >= 8", "Financially strong value candidates", ["piotroski"], "piotroski_f_score DESC", {"primary": {"type": "scorecard_grid", "components": 9}, "secondary": {"type": "histogram", "field": "piotroski_f_score", "bins": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}}),
    _preset("peter_lynch_garp", "Peter Lynch GARP", "guru", "PEG < 1 AND EPS Growth > 15 AND PE < 25 AND Debt to equity < 0.8 AND Revenue Growth > 10", "Growth at reasonable price", ["lynch"]),
    _preset("can_slim", "CAN SLIM", "guru", "RSI > 50 AND Price_1Y_Return > 15", "CAN SLIM style growth + momentum", ["can_slim"]),
    _preset("altman_z_safe", "Altman Z-Score Safe Zone", "guru", "Altman Z-Score > 2.99", "Bankruptcy risk safe zone", ["altman"], "altman_z_score DESC"),
    _preset("dupont_leaders", "DuPont Analysis Leaders", "guru", "ROE > 20", "ROE decomposition leaders", ["dupont"]),
    _preset("dividend_aristocrats", "Dividend Aristocrats", "guru", "Dividend Yield > 2 AND Debt to equity < 1", "Long-term dividend consistency", ["dividend"]),
    _preset("cash_flow_machines", "Cash Flow Machines", "ideas", "FCF Yield > 5 AND Revenue Growth > 15", "Strong cash generation"),
    _preset("promoter_increasing_stake", "Promoter Increasing Stake", "ideas", "Promoter holding > 40", "Promoter conviction increasing"),
    _preset("smart_money_flow", "Smart Money Flow", "ideas", "Change in FII holding > 0.5 AND Change in DII holding > 0.5", "Institutional accumulation"),
    _preset("smallcap_compounders", "Small Cap Consistent Compounders", "ideas", "Market Capitalization > 500 AND Market Capitalization < 5000 AND Revenue Growth > 15 AND ROE > 15 AND Debt to equity < 0.5", "Small-cap growth consistency"),
    _preset("major_capex_expansion", "Major Capex Expansion", "ideas", "Debt to equity < 1.5 AND ROCE > 12", "Capacity expansion cycle"),
    _preset("superstar_favorites", "Superstar Investor Favorites", "ideas", "Market Capitalization < 10000", "Known investor-backed ideas"),
    _preset("turnaround_candidates", "Turnaround Candidates", "ideas", "Revenue Growth > 10 AND OPM > 8", "Loss to profit turnarounds"),
    _preset("hidden_gems", "Hidden Gems", "ideas", "Market Capitalization > 200 AND Market Capitalization < 3000 AND ROE > 15 AND Promoter holding > 50", "Under-researched quality names"),
    _preset("deep_value_multi_metric", "Deep Value Multi-Metric", "valuation", "PE < 12 AND PB < 1.5 AND EV/EBITDA < 8", "Multi-ratio value screen"),
    _preset("reverse_dcf", "Reverse DCF Implied Growth", "valuation", "Market Capitalization > 200", "Market-implied growth mismatch", ["reverse_dcf"]),
    _preset("peg_bargains", "PEG Bargains", "valuation", "PEG < 0.75 AND EPS Growth > 20 AND PE < 20", "Low PEG growth picks"),
    _preset("earnings_yield_vs_bond", "Earnings Yield vs Bond Yield", "valuation", "Earnings Yield > 10 AND ROCE > 15", "Equity yield spread candidates"),
    _preset("high_roce_compounders", "High ROCE Compounders", "quality", "ROCE > 25 AND Revenue Growth > 10 AND Debt to equity < 0.3", "Capital-efficient compounders"),
    _preset("asset_light_models", "Asset-Light Business Models", "quality", "ROE > 20 AND FCF Yield > 3", "Asset-light high return models"),
    _preset("working_capital_efficient", "Working Capital Efficient", "quality", "Current Ratio > 1.2", "Lower cash conversion cycle proxies"),
    _preset("margin_expanders", "Margin Expanders", "quality", "OPM > 15 AND Revenue Growth > 10", "Improving margin profile"),
    _preset("breakout_scanner", "Breakout Scanner", "technical", "Price_1Y_Return > 20 AND RSI > 55", "Price breakout with momentum", ["technical"], "price_1y_return DESC", {"primary": {"type": "candlestick"}, "secondary": {"type": "histogram", "field": "price_1y_return", "bins": 20}}),
    _preset("golden_cross", "Golden Cross", "technical", "Price > 0", "50DMA crossing 200DMA", ["technical"]),
    _preset("oversold_bounce", "Oversold Bounce Candidates", "technical", "RSI < 30 AND ROE > 12 AND Debt to equity < 1", "Oversold technical bounce"),
    _preset("rs_leaders", "Relative Strength Leaders", "technical", "Price_1Y_Return > 25 AND RSI > 50", "RS leadership list", ["technical"]),
    _preset("volume_climax", "Volume Climax Detector", "technical", "Delivery % > 60", "Unusual volume accumulation", ["technical"]),
    _preset("minervini_trend_template", "Trend Template (Minervini)", "technical", "Price > 0 AND RSI > 50", "Trend template compliance", ["technical"]),
    _preset("mf_fresh_entry", "Mutual Fund Fresh Entry", "shareholding", "Market Capitalization < 10000", "New mutual fund entry names"),
    _preset("pledge_reduction", "Pledge Reduction", "shareholding", "Promoter holding > 45", "Promoter pledge reducing"),
    _preset("bulk_block_deals", "Bulk/Block Deal Tracker", "shareholding", "Market Capitalization > 200", "Recent large institutional deals"),
    _preset("china_plus_one", "China+1 Beneficiaries", "thematic", "Revenue Growth > 20", "Export-oriented beneficiaries"),
    _preset("pli_beneficiaries", "PLI Beneficiaries", "thematic", "Revenue Growth > 15", "Policy-linked capex beneficiaries"),
    _preset("defense_aerospace", "Defense & Aerospace Pure Plays", "thematic", "OPM > 10 AND Revenue Growth > 15", "Defense order-book plays"),
    _preset("digital_india", "Digital India Efficiency", "thematic", "OPM > 20 AND Revenue Growth > 10", "Digital service efficiency leaders"),
    _preset("ev_clean_energy", "EV & Clean Energy", "thematic", "Revenue Growth > 25", "Clean energy transition names"),
    _preset("multi_factor_composite", "Multi-Factor Composite", "quant", "Market Capitalization > 500", "Quality + Value + Momentum blend", ["multi_factor"], "quality_score DESC", {"primary": {"type": "scatter", "x": "quality", "y": "value_score", "z": "momentum"}}),
    _preset("low_vol_high_div", "Low Volatility + High Dividend", "quant", "Beta < 0.8 AND Dividend Yield > 3", "Defensive income + low beta"),
    _preset("earnings_surprise_momentum", "Earnings Surprise Momentum", "quant", "EPS Growth > 10 AND Price_1Y_Return > 10", "Post-results momentum"),
    _preset("insider_tech_confluence", "Insider + Technical Confluence", "quant", "Promoter holding > 40 AND RSI > 50", "Insider buying with technical confirmation"),
    _preset("sector_rotation_alpha", "Sector Rotation Alpha", "quant", "ROE > 15 AND Revenue Growth > 10", "Leaders within leading sectors"),
]


PRESET_SCREENS: dict[str, dict[str, Any]] = dict(_PRESETS)


def list_presets() -> list[dict[str, Any]]:
    return list(PRESET_SCREENS.values())


def get_preset(screen_id: str) -> dict[str, Any] | None:
    return PRESET_SCREENS.get(screen_id)
