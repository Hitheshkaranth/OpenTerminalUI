from __future__ import annotations

import asyncio
import json

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.agent import events
from backend.agent import memory as memory_service
from backend.agent.grounding import GroundingLedger, extract_figures, ground_stream, ground_text
from backend.shared.db import Base


def _snapshot_ledger(quality: str = "delayed") -> GroundingLedger:
    ledger = GroundingLedger("Compare TCS with INFY")
    ledger.add(
        "get_stock_snapshot",
        {"symbol": "TCS", "current_price": 3456.75, "pe": 27.43, "roe_pct": 0.482, "market_cap": 1.25e13,
         "high_52w": 4592.25, "provenance": {"source": "yahoo", "quality": quality, "as_of": "2026-10-06T09:00:00Z"}},
        args={"ticker": "TCS"}, call_id="c1",
    )
    ledger.add("compare_stocks", {"rows": [{"symbol": "TCS", "pe": 27.43}, {"symbol": "INFY", "pe": 24.1}]},
               args={"tickers": ["TCS", "INFY"]}, call_id="c2")
    return ledger


def _by_text(report: dict) -> dict[str, dict]:
    return {c["text"]: c for c in report["claims"]}


def test_verified_figures_cite_their_source_and_provenance():
    report = ground_text("TCS trades at ₹3,456.8 with a P/E of 27.4 and ROE 48.2%.", _snapshot_ledger())
    claims = _by_text(report)
    assert claims["₹3,456.8"]["status"] == "verified"
    assert claims["₹3,456.8"]["path"] == "current_price"
    assert claims["27.4"]["source_id"] == "S1" and claims["27.4"]["metric"] == "pe"
    assert claims["48.2%"]["status"] == "verified"  # source stores ROE as a fraction
    s1 = next(s for s in report["sources"] if s["id"] == "S1")
    assert (s1["tool"], s1["provider"], s1["quality"]) == ("get_stock_snapshot", "yahoo", "delayed")
    assert s1["as_of"] == "2026-10-06T09:00:00Z"
    assert report["summary"] == {"total": 3, "verified": 3, "mismatch": 0, "unsourced": 0, "low_quality": 0}
    assert "₹3,456.8⟦v:S1⟧" in report["annotated"]


def test_wrong_figure_for_a_named_metric_is_a_mismatch_with_the_source_value():
    report = ground_text("INFY's P/E is 25.0.", _snapshot_ledger())
    claim = report["claims"][0]
    assert claim["status"] == "mismatch"
    assert claim["source_id"] == "S2" and claim["subject"] == "INFY"
    assert claim["expected"] == "24.1"
    assert "25.0⟦x:S2:24.1⟧" in report["annotated"]


def test_figure_absent_from_every_source_is_unsourced():
    report = ground_text("Analysts see revenue reaching 98,765 next year.", _snapshot_ledger())
    assert report["claims"][0]["status"] == "unsourced"
    assert report["annotated"].endswith("98,765⟦u⟧ next year.")


def test_table_cells_use_the_column_header_and_row_ticker():
    text = "| Symbol | P/E |\n|---|---|\n| TCS | 27.43 |\n| INFY | 23 |"
    claims = ground_text(text, _snapshot_ledger())["claims"]
    assert [c["status"] for c in claims] == ["verified", "mismatch"]
    assert claims[1]["subject"] == "INFY"


def test_forward_looking_figures_are_not_contradicted_by_live_data():
    claim = ground_text("A target price around 4,000 is plausible.", _snapshot_ledger())["claims"][0]
    assert claim["status"] == "unsourced"


def test_percent_distance_from_a_level_is_not_compared_to_the_level():
    ledger = _snapshot_ledger()
    ledger.add("get_stock_snapshot", {"symbol": "TCS", "pct_below_52w_high": 24.7}, args={"ticker": "TCS"})
    claim = ground_text("TCS is 24.7% below its 52-week high.", ledger)["claims"][0]
    assert claim["status"] == "verified" and claim["path"] == "pct_below_52w_high"


def test_indian_and_scaled_units():
    claim = ground_text("TCS market cap is ₹12.5 lakh crore.", _snapshot_ledger())["claims"][0]
    assert claim["status"] == "verified" and claim["path"] == "market_cap"


def test_non_data_numbers_are_skipped():
    text = (
        "1. As of 2026-10-06 the Nifty 50 member is above its 50-day EMA (RSI14, Q2 FY26), "
        "3 of 5 screens pass, 3B / 1B / 2N.\nDECISION: BUY | CONVICTION: 70 | strong"
    )
    assert extract_figures(text) == []


def test_code_spans_are_checked_but_not_annotated_inline():
    report = ground_text('metrics: `{"pe": 27.43}`', _snapshot_ledger())
    assert report["claims"][0]["status"] == "verified" and report["claims"][0]["in_code"]
    assert "⟦" not in report["annotated"]


def test_low_quality_sources_are_flagged_even_when_figures_match():
    report = ground_text("P/E 27.4", _snapshot_ledger(quality="synthetic"))
    assert report["claims"][0]["warning"] == "source quality is synthetic"
    assert report["summary"]["low_quality"] == 1
    assert "⟦w:S1⟧" in report["annotated"]


def test_envelope_and_legacy_results_get_provenance():
    ledger = GroundingLedger()
    env = ledger.add("get_yield_curve", {"ok": True, "data": {"y10": 4.12},
                                         "provenance": {"source": "fred", "quality": "live", "as_of": "2026-10-05"}})
    legacy = ledger.add("some_legacy_tool", {"value": 1.5})
    assert (env.provider, env.quality) == ("fred", "live")
    assert [leaf.path for leaf in env.leaves] == ["y10"]  # data is unwrapped from the envelope
    assert legacy.quality == "unreported" and legacy.note


def test_ground_stream_orders_events_and_indexes_roles():
    async def stream():
        yield events.tool_call("c1", "get_stock_snapshot", {"ticker": "TCS"})
        yield events.tool_result("c1", "get_stock_snapshot", {"symbol": "TCS", "pe": 27.43})
        yield events.role_message("bull", "P/E 27.4 is fair.")
        yield events.final("P/E 30.0 now.")

    async def collect():
        return [e async for e in ground_stream(stream())]

    out = asyncio.run(collect())
    kinds = [e["type"] for e in out]
    assert kinds == ["tool_call", "tool_result", "role_message", "grounding", "grounding", "final"]
    role_report, final_report = out[3], out[4]
    assert role_report["target"] == "role" and role_report["role_index"] == 0
    assert role_report["claims"][0]["status"] == "verified"
    assert final_report["target"] == "final" and final_report["claims"][0]["status"] == "mismatch"
    assert role_report["sources"][0]["args"] == {"ticker": "TCS"}  # arguments come from the tool_call


def test_errored_tool_results_are_not_sources():
    ledger = GroundingLedger()
    ledger.observe(events.tool_result("c1", "get_stock_snapshot", {"error": "boom"}, is_error=True))
    ledger.observe(events.tool_result("c2", "get_option_chain", {"ok": False, "error": {"message": "x"}}))
    assert ledger.sources == []


def test_grounding_is_persisted_and_returned_with_the_thread():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    memory_service.get_or_create_thread(db, "u1", "t1")
    memory_service.create_run(db, "u1", "r1", "t1", "standard", "q")
    memory_service.append_message(db, "u1", "t1", "user", "q", "r1")
    memory_service.append_message(db, "u1", "t1", "assistant", "P/E 27.4", "r1")
    report = ground_text("P/E 27.4", _snapshot_ledger())
    memory_service.finish_run(db, "r1", "P/E 27.4", "done", report)
    db.commit()
    thread = memory_service.get_thread(db, "u1", "t1")
    assistant = [m for m in thread["messages"] if m["role"] == "assistant"][0]
    assert assistant["grounding"]["annotated"] == "P/E 27.4⟦v:S1⟧"
    assert "grounding" not in [m for m in thread["messages"] if m["role"] == "user"][0]
    json.dumps(thread, default=str)


# --- regressions found grounding live Ornith answers --------------------------------------
def _live_ledger() -> GroundingLedger:
    ledger = GroundingLedger()
    ledger.add("get_stock_snapshot", {"symbol": "AAPL", "current_price": 331.6, "previous_close": 332.89,
                                      "change_pct": -0.3875, "pct_below_52w_high": 4.0, "high_52w": 345.34,
                                      "range_52w_position_pct": 86.5}, args={"ticker": "AAPL"})
    ledger.add("analyze_technicals", {"ticker": "AAPL", "momentum": {"rsi_14": 52.23, "roc_20": 4.86},
                                      "distance_from_20d_high_pct": 3.98}, args={"ticker": "AAPL"})
    ledger.add("compare_stocks", {"rows": [
        {"symbol": "MSFT", "pe": 29.66, "roe_pct": 34.039, "net_margin_pct": 40.305},
        {"symbol": "GOOGL", "pe": 17.43, "roe_pct": 48.676, "op_margin_pct": 34.033}]})
    return ledger


def test_previous_close_and_change_are_their_own_fields():
    claims = _by_text(ground_text("$331.60, down 0.39% on the day (prev close $332.89)", _live_ledger()))
    assert claims["$332.89"]["path"] == "previous_close"
    assert claims["0.39%"]["path"] == "change_pct"


def test_indicator_periods_in_parentheses_are_not_figures():
    claims = ground_text("RSI (14): 52.23", _live_ledger())["claims"]
    assert [c["text"] for c in claims] == ["52.23"]


def test_distance_from_52w_high_uses_the_52w_field_not_the_20d_one():
    report = ground_text("4.0% below the high of $345.34, only ~4% off its high, at the 86.5th percentile", _live_ledger())
    claims = report["claims"]
    assert [c["path"] for c in claims] == ["pct_below_52w_high", "high_52w", "pct_below_52w_high", "range_52w_position_pct"]
    assert "86.5th⟦w:S1⟧ percentile" in report["annotated"]  # test ledger reports no provider


def test_metric_carries_through_a_sentence_and_the_nearest_ticker_wins():
    claims = ground_text("GOOGL wins on ROE too, at 48.68% vs. MSFT's 34.04%.", _live_ledger())["claims"]
    assert (claims[1]["subject"], claims[1]["path"]) == ("MSFT", "rows[0].roe_pct")


def test_derived_approximate_figures_do_not_borrow_an_unrelated_field():
    claim = ground_text("GOOGL's P/E of 17.43 is below MSFT's 29.66, roughly 41% cheaper.", _live_ledger())["claims"][-1]
    assert claim["status"] == "unsourced"


def test_json_keys_pick_the_field_but_prose_labels_do_not():
    ledger = GroundingLedger()
    ledger.add("backtest_symbol", {"metrics": {"total_return_pct": 21.88, "sharpe": 0.45, "trades": 21}})
    ledger.add("computed:signal_table", {"consensus": [{"symbol": "AAPL", "score": 80.52}], "avg_score": 80.2})
    code = ground_text('`{"total_return_pct": 21.88, "sharpe": 0.45, "trades": 21}`', ledger)["claims"]
    assert [c["path"] for c in code] == ["metrics.total_return_pct", "metrics.sharpe", "metrics.trades"]
    prose = ground_text("**Consensus: BUY** (avg score: 80.2)", ledger)["claims"][0]
    assert (prose["status"], prose["path"]) == ("verified", "avg_score")


def test_debate_regressions_periods_ev_ebitda_and_fraction_scaling():
    ledger = GroundingLedger()
    ledger.add("get_stock_snapshot", {"symbol": "NVDA", "pe": 30.4, "forward_pe": 15.22, "ev_ebitda": 28.49,
                                      "enterprise_value": 5.73e12, "market_cap": 5.81e12, "ps": 19.2, "pb": 25.35})
    ledger.add("analyze_technicals", {"ticker": "NVDA", "momentum": {"rsi_14": 68.07, "roc_10": 5.06},
                                      "trend": {"ema_9": 232.37, "ema_21": 227.28, "ema_200": 205.84},
                                      "volume": {"rvol_20": 0.4978}})
    ledger.add("get_news_sentiment", {"ticker": "NVDA", "headlines": [{"sentiment": {"score": 1.0}}]})
    text = ("EMA 9 **232.37**, 21 **227.28**, 200 **205.84**. RSI 14 at 68.07, ROC 10: +5.06%. "
            "Forward P/E 15.2 vs trailing 30.4, EV/EBITDA 28.49, P/S 19.2. EV $5.73T < market cap $5.81T. "
            "Quote delayed ~15 min. A ~50% step-up. PEG = P/E / growth = 15.2 / 127.8.")
    claims = ground_text(text, ledger)["claims"]
    paths = {c["text"]: c["path"] for c in claims}
    assert paths["232.37"] == "trend.ema_9" and paths["227.28"] == "trend.ema_21" and paths["205.84"] == "trend.ema_200"
    assert paths["68.07"] == "momentum.rsi_14" and paths["+5.06%"] == "momentum.roc_10"
    assert paths["30.4"] == "pe" and paths["28.49"] == "ev_ebitda" and paths["19.2"] == "ps"
    assert paths["$5.73T"] == "enterprise_value" and paths["$5.81T"] == "market_cap"
    assert {"14", "10", "21", "200", "9", "15"}.isdisjoint(paths)  # period labels and "~15 min" aren't figures
    step_up = next(c for c in claims if c["text"] == "50%")
    assert step_up["status"] == "unsourced"  # not rvol 0.4978×100, not a sentiment score
    peg = [c for c in claims if c["text"] == "15.2"][-1]
    assert peg["status"] == "verified" and peg["warning"] == "labelled pe but the value is forward_pe"


def test_strategy_proposals_never_contradict_the_previous_run():
    async def stream():
        yield events.tool_call("c1", "backtest_symbol", {"ticker": "AAPL", "short_window": 20, "long_window": 50})
        yield events.tool_result("c1", "backtest_symbol", {"params": {"short_window": 20, "long_window": 50}})
        yield events.role_message("strategy_researcher", '{"short_window": 20, "long_window": 100}')

    async def collect():
        return [e async for e in ground_stream(stream())]

    report = [e for e in asyncio.run(collect()) if e["type"] == "grounding"][0]
    assert [c["status"] for c in report["claims"]] == ["verified", "unsourced"]


def test_metric_right_after_a_figure_beats_one_named_far_before():
    ledger = GroundingLedger()
    ledger.add("get_stock_snapshot", {"symbol": "NVDA", "forward_pe": 15.23, "net_margin_pct": 63.66, "op_margin_pct": 66.24})
    text = ("the forward P/E already bakes in the earnings surge, and margins at 63.7% net have room; "
            "elite margins: 66.2% operating")
    claims = ground_text(text, ledger)["claims"]
    assert [(c["status"], c["path"]) for c in claims] == [("verified", "net_margin_pct"), ("verified", "op_margin_pct")]


def test_words_starting_with_a_month_are_not_dates():
    figures = [f.text for f in extract_figures(
        "Operating margin 66.2%, a decline 15.5%; reported Aug 26, 2026 and Oct 6; 6 Oct 2026.")]
    assert figures == ["66.2%", "15.5%"]
