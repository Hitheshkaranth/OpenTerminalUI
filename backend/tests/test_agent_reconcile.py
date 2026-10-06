from __future__ import annotations

from datetime import datetime, timedelta, timezone

import backend.agent.reconcile as reconcile_mod
from backend.agent.grounding import GroundingLedger
from backend.agent.reconcile import find_conflicts, find_stale, reconcile

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)


def _prov(source: str, quality: str, as_of: str | None = None) -> dict:
    return {"source": source, "quality": quality, "as_of": as_of, "note": None}


def _snapshot(ledger: GroundingLedger, ticker: str, as_of: str | None = None, **fields) -> None:
    ledger.add("get_stock_snapshot", {**fields, "provenance": _prov("yahoo", "delayed", as_of)},
               args={"ticker": ticker})


def _screen(ledger: GroundingLedger, rows: list[dict], as_of: str | None = None) -> None:
    ledger.add("screen_stocks", {"results": rows, "provenance": _prov("screener fundamentals store", "cached", as_of)},
               args={"query": "roe > 15", "limit": 5})


# --- conflicts -----------------------------------------------------------------------
def test_roe_disagreement_between_yahoo_and_screener_is_a_high_conflict():
    ledger = GroundingLedger(prompt="Is AAPL's ROE above 18?")
    _snapshot(ledger, "AAPL", roe_pct=148.75, price=331.6)
    _screen(ledger, [{"ticker": "AAPL", "roe": 18, "price": 331.6}])

    conflicts = find_conflicts(ledger)
    assert len(conflicts) == 1
    c = conflicts[0]
    assert (c["subject"], c["metric"], c["severity"]) == ("AAPL", "roe", "high")
    assert c["spread_pct"] == 87.9
    assert c["values"] == [
        {"source_id": "S1", "path": "roe_pct", "value": 148.75, "provider": "yahoo", "quality": "delayed"},
        {"source_id": "S2", "path": "results[0].roe", "value": 18.0,
         "provider": "screener fundamentals store", "quality": "cached"},
    ]


def test_fraction_stored_roe_matches_percent_roe():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", roe=0.482)
    _screen(ledger, [{"ticker": "AAPL", "roe": 48.2}])
    assert find_conflicts(ledger) == []


def test_fraction_normalisation_still_reports_original_value_on_real_conflict():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", roe=0.30)
    _screen(ledger, [{"ticker": "AAPL", "roe": 48.2}])
    (c,) = find_conflicts(ledger)
    assert [v["value"] for v in c["values"]] == [0.30, 48.2]
    assert c["spread_pct"] == round((48.2 - 30.0) / 48.2 * 100, 1)


def test_values_within_tolerance_and_medium_severity():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", price=331.6, pe=30.0)
    _screen(ledger, [{"ticker": "AAPL", "price": 332.0, "pe": 27.0}])
    conflicts = find_conflicts(ledger)
    assert [c["metric"] for c in conflicts] == ["pe"]  # price within 5% is not flagged
    assert conflicts[0]["severity"] == "medium" and conflicts[0]["spread_pct"] == 10.0


def test_different_subjects_never_conflict():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", pe=30.0)
    _snapshot(ledger, "MSFT", pe=12.0)
    assert find_conflicts(ledger) == []


def test_excluded_metrics_parameters_and_prompt_are_ignored():
    ledger = GroundingLedger(prompt="AAPL pe 99")
    ledger.add("get_stock_snapshot", {"change_pct": 1.2, "pe": 30.0, "provenance": _prov("yahoo", "delayed")},
               args={"ticker": "AAPL", "pe": 5})
    ledger.add("get_quote", {"change_pct": -3.4, "pe": 30.1, "provenance": _prov("finnhub", "live")},
               args={"ticker": "AAPL", "pe": 80})
    ledger.add("computed:consensus", {"ticker": "AAPL", "pe": 60.0},
               provenance=_prov("computed by the agent", "computed"))
    assert find_conflicts(ledger) == []


def test_conflicts_sorted_high_first_then_by_spread():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", pe=30.0, roe_pct=148.75)
    _snapshot(ledger, "MSFT", pe=35.0)
    _screen(ledger, [{"ticker": "AAPL", "pe": 27.0, "roe": 18}, {"ticker": "MSFT", "pe": 20.0}])
    assert [(c["subject"], c["metric"], c["severity"]) for c in find_conflicts(ledger)] == [
        ("AAPL", "roe", "high"), ("MSFT", "pe", "high"), ("AAPL", "pe", "medium")]


# --- staleness -----------------------------------------------------------------------
def test_stale_market_depth_and_fresh_snapshot():
    ledger = GroundingLedger()
    ledger.add("get_market_depth", {"bids": [{"price": 331.5}], "provenance": _prov("synthetic book", "synthetic",
               (NOW - timedelta(days=6)).isoformat())}, args={"ticker": "AAPL"})
    _snapshot(ledger, "AAPL", as_of=NOW.isoformat(), price=331.6)
    stale = find_stale(ledger, now=NOW)
    assert stale == [{"source_id": "S1", "tool": "get_market_depth", "as_of": (NOW - timedelta(days=6)).isoformat(),
                      "age_hours": 144.0, "threshold_hours": 24.0}]


def test_date_only_as_of_two_days_old_is_within_weekend_budget():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", as_of=(NOW - timedelta(days=2)).date().isoformat(), price=331.6)
    assert find_stale(ledger, now=NOW) == []


def test_date_only_is_end_of_day_and_z_suffix_parses():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", as_of="2026-09-30", price=1.0)              # 23:59:59 -> 132.0h
    _snapshot(ledger, "MSFT", as_of="2026-10-01T00:00:00.123456Z", price=1.0)  # 132.0h
    stale = find_stale(ledger, now=NOW)
    assert [s["age_hours"] for s in stale] == [132.0, 132.0]
    assert all(s["threshold_hours"] == 96.0 for s in stale)


def test_cached_source_ten_days_old_is_stale_at_week_budget():
    ledger = GroundingLedger()
    _screen(ledger, [{"ticker": "AAPL", "roe": 18}], as_of=(NOW - timedelta(days=10)).isoformat())
    _screen(ledger, [{"ticker": "AAPL", "roe": 18}], as_of=(NOW - timedelta(days=6)).isoformat())
    stale = find_stale(ledger, now=NOW)
    assert [(s["source_id"], s["threshold_hours"], s["age_hours"]) for s in stale] == [("S1", 168.0, 240.0)]


def test_naive_timestamp_is_utc_and_garbage_or_missing_is_skipped():
    ledger = GroundingLedger(prompt="AAPL")
    ledger.add("get_option_chain", {"iv": 0.3, "provenance": _prov("nse", "delayed", "2026-10-05T11:00:00")},
               args={"ticker": "AAPL"})
    ledger.add("get_fno_flow", {"oi": 10, "provenance": _prov("nse", "delayed", "yesterday-ish")},
               args={"ticker": "AAPL"})
    ledger.add("get_fno_flow", {"oi": 10, "provenance": _prov("nse", "delayed", None)}, args={"ticker": "AAPL"})
    ledger.add("computed:x", {"v": 1}, provenance=_prov("agent", "computed", "2020-01-01"))
    stale = find_stale(ledger, now=NOW)
    assert [(s["source_id"], s["age_hours"]) for s in stale] == [("S1", 25.0)]


def test_stale_sorted_oldest_first():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", as_of="2026-09-20T12:00:00+00:00", price=1.0)
    _snapshot(ledger, "MSFT", as_of="2026-09-01T12:00:00+00:00", price=1.0)
    assert [s["source_id"] for s in find_stale(ledger, now=NOW)] == ["S2", "S1"]


# --- reconcile -----------------------------------------------------------------------
def test_reconcile_combines_both():
    ledger = GroundingLedger()
    _snapshot(ledger, "AAPL", as_of="2026-09-01", roe_pct=148.75)
    _screen(ledger, [{"ticker": "AAPL", "roe": 18}])
    out = reconcile(ledger, now=NOW)
    assert len(out["conflicts"]) == 1 and [s["source_id"] for s in out["stale"]] == ["S1"]


def test_reconcile_never_raises(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("bad ledger")

    monkeypatch.setattr(reconcile_mod, "find_conflicts", boom)
    assert reconcile(GroundingLedger(), now=NOW) == {"conflicts": [], "stale": []}
    assert reconcile(None) == {"conflicts": [], "stale": []}  # type: ignore[arg-type]
