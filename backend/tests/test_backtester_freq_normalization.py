from backend.core.backtester import _normalize_rebalance_freq


def test_rebalance_frequency_normalization() -> None:
    assert _normalize_rebalance_freq("M") == "ME"
    assert _normalize_rebalance_freq("Q") == "QE"
    assert _normalize_rebalance_freq("Y") == "YE"
    assert _normalize_rebalance_freq("A") == "YE"
    assert _normalize_rebalance_freq("ME") == "ME"
    assert _normalize_rebalance_freq("W") == "W"
    assert _normalize_rebalance_freq("") == "ME"
