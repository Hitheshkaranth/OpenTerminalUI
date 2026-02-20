from __future__ import annotations

from backend.shared.data_integrity import run_integrity_checks


def test_detects_gap_outlier_and_split():
    candles = [
        {"t": 1_700_000_000, "o": 100, "h": 101, "l": 99, "c": 100, "v": 1000},
        {"t": 1_700_086_400, "o": 101, "h": 102, "l": 100, "c": 101, "v": 1100},
        {"t": 1_700_172_800, "o": 102, "h": 103, "l": 101, "c": 102, "v": 1200},
        {"t": 1_700_432_000, "o": 101, "h": 102, "l": 100, "c": 101, "v": 1000},  # gap (3 days)
        {"t": 1_700_518_400, "o": 50, "h": 51, "l": 49, "c": 50, "v": 3000},      # split-like
        {"t": 1_700_604_800, "o": 80, "h": 151, "l": 79, "c": 150, "v": 8000},     # outlier jump
    ]

    report = run_integrity_checks(candles, expected_interval_sec=86_400, outlier_z=1.8)
    assert report.checks_run == ["gaps", "outliers", "splits"]
    assert len(report.gaps) >= 1
    assert len(report.splits) >= 1
    assert len(report.outliers) >= 1
