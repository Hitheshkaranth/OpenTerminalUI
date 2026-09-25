from backend.core.execution_model import estimate_slippage_bps, parse_execution_config


def test_explicit_zero_config_values_are_respected():
    cfg = parse_execution_config({"model": "impact_curve", "impact_coefficient_bps": 0, "volume_weighted_bps": 0, "max_bps": 0})
    assert cfg.impact_coefficient_bps == 0.0
    assert cfg.volume_weighted_bps == 0.0
    assert cfg.max_bps == 0.0
    assert estimate_slippage_bps(1000, bar_volume=10_000, config=cfg) == 0.0


def test_missing_config_values_use_defaults():
    cfg = parse_execution_config({})
    assert (cfg.volume_weighted_bps, cfg.impact_coefficient_bps, cfg.max_bps) == (25.0, 35.0, 500.0)
