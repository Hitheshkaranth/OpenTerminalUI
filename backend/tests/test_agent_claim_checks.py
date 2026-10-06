from __future__ import annotations

from backend.agent.claim_checks import check_statements
from backend.agent.grounding import GroundingLedger


def _aapl() -> GroundingLedger:
    ledger = GroundingLedger()
    ledger.add("get_stock_snapshot", {"symbol": "AAPL", "current_price": 331.6, "previous_close": 332.0,
                                      "change_pct": -0.12, "pct_below_52w_high": 4.0, "high_52w": 345.34,
                                      "low_52w": 220.0}, args={"ticker": "AAPL"})
    ledger.add("analyze_technicals", {"ticker": "AAPL", "price": 331.6,
                                      "trend": {"ema_9": 333.0, "ema_21": 329.5, "ema_50": 324.21, "ema_200": 298.08},
                                      "momentum": {"rsi_14": 53.3}}, args={"ticker": "AAPL"})
    return ledger


def _pair() -> GroundingLedger:
    ledger = GroundingLedger()
    ledger.add("compare_stocks", {"rows": [
        {"symbol": "MSFT", "pe": 29.66, "roe_pct": 34.039, "revenue_growth": 12.1, "price": 420.0, "change_pct": 0.8},
        {"symbol": "GOOGL", "pe": 17.43, "roe_pct": 48.676, "revenue_growth": 14.0, "price": 170.0, "change_pct": -1.1}]},
        args={"tickers": ["MSFT", "GOOGL"]})
    return ledger


def _one(text: str, ledger: GroundingLedger, kind: str | None = None, **kw) -> dict:
    found = [s for s in check_statements(text, ledger, **kw) if kind is None or s["kind"] == kind]
    assert len(found) == 1, found
    return found[0]


# --- 1. price vs moving averages ------------------------------------------------------------
def test_price_above_50_day_ema_is_verified_with_evidence():
    s = _one("AAPL price is above its 50-day EMA.", _aapl())
    assert (s["kind"], s["status"]) == ("comparison", "verified")
    assert s["explanation"] == "price 331.6 > 50-day EMA 324.21"
    assert {e["path"] for e in s["evidence"]} == {"price", "trend.ema_50"}
    assert all(e["source_id"] == "S2" for e in s["evidence"])  # latest source wins


def test_below_200_day_is_contradicted():
    s = _one("The stock trades below the 200-day.", _aapl())
    assert s["status"] == "contradicted"
    assert "298.08" in s["explanation"] and "below" in s["explanation"]


def test_both_mas_must_hold():
    ok = _one("It sits above both its 50-day and 200-day EMAs.", _aapl())
    assert ok["status"] == "verified" and len(ok["evidence"]) == 3
    bad = _one("It sits above both its 9-day and 50-day EMAs.", _aapl())  # 331.6 < ema_9 333.0
    assert bad["status"] == "contradicted"
    assert "9-day EMA 333" in bad["explanation"]


def test_ma_dma_and_ema_n_spellings():
    assert _one("Price is above the 50 DMA.", _aapl())["status"] == "verified"
    assert _one("Price is below EMA 200.", _aapl())["status"] == "contradicted"
    assert _one("Price holds above the 21-day EMA.", _aapl())["status"] == "verified"


def test_ma_vs_ma_golden_cross_compares_the_averages():
    s = _one("The 50-day EMA is above the 200-day EMA.", _aapl())
    assert s["status"] == "verified" and "50-day EMA 324.21 > 200-day EMA 298.08" in s["explanation"]


def test_missing_ema_is_unverifiable():
    s = _one("Price is above its 100-day moving average.", _aapl())
    assert s["status"] == "unverifiable" and "100-day EMA" in s["explanation"]


def test_unknown_ticker_is_unverifiable_not_attributed_to_the_lone_subject():
    s = _one("NVDA is trading above its 50-day EMA.", _aapl())
    assert s["status"] == "unverifiable" and "NVDA" in s["explanation"]


# --- 2. thresholds ----------------------------------------------------------------------------
def test_rsi_thresholds():
    neutral = _one("RSI is neutral at these levels.", _aapl())
    assert (neutral["kind"], neutral["status"]) == ("threshold", "verified")
    over = _one("RSI is overbought.", _aapl())
    assert over["status"] == "contradicted"
    assert over["explanation"] == "RSI 53.3 is not overbought (needs ≥ 70)"
    assert _one("RSI is not overbought.", _aapl())["status"] == "verified"
    assert _one("Momentum is approaching overbought.", _aapl())["status"] == "contradicted"


def test_rsi_missing_is_unverifiable():
    s = _one("MSFT looks oversold here.", _pair())
    assert s["status"] == "unverifiable" and "RSI" in s["explanation"]


def test_neutral_without_rsi_context_is_ignored():
    assert check_statements("Our stance is neutral.", _aapl()) == []


def test_near_52_week_high_and_low():
    high = _one("AAPL is near its 52-week high.", _aapl())
    assert high["status"] == "verified" and high["evidence"][0]["path"] == "pct_below_52w_high"
    low = _one("AAPL is near its 52-week low.", _aapl())
    assert low["status"] == "contradicted"
    s = _one("MSFT is near its 52-week high.", _pair())
    assert s["status"] == "unverifiable"


def test_near_high_falls_back_to_price_over_high():
    ledger = GroundingLedger()
    ledger.add("get_stock_snapshot", {"symbol": "TCS", "current_price": 3000.0, "high_52w": 4592.25},
               args={"ticker": "TCS.NS"})
    s = _one("TCS is trading near highs.", ledger)
    assert s["status"] == "contradicted" and len(s["evidence"]) == 2


# --- 3. direction -----------------------------------------------------------------------------
def test_direction_sign_must_match_the_verb():
    up = _one("AAPL was up 0.12% on the day.", _aapl())
    assert (up["kind"], up["status"]) == ("direction", "contradicted")
    assert up["explanation"] == "change_pct is −0.12 but text says up"
    assert _one("AAPL closed at $331.60, down -0.12% on the day.", _aapl(), "direction")["status"] == "verified"
    assert _one("Shares slipped 0.12% today.", _aapl())["status"] == "verified"


def test_revenue_growth_is_not_a_price_move():
    assert [s for s in check_statements("Revenue up 16% year over year.", _aapl()) if s["kind"] == "direction"] == []
    assert check_statements("The stock is up 16% this year.", _aapl()) == []


def test_direction_without_change_data_is_unverifiable():
    ledger = GroundingLedger()
    ledger.add("analyze_technicals", {"ticker": "AAPL", "momentum": {"rsi_14": 50.0}}, args={"ticker": "AAPL"})
    s = _one("AAPL fell 1.2% today.", ledger)
    assert s["status"] == "unverifiable"


def test_multi_ticker_sentence_picks_the_nearest_ticker():
    found = check_statements("MSFT rose 0.8% while GOOGL fell 1.1% on the day.", _pair())
    assert [(s["status"], s["evidence"][0]["value"]) for s in found] == [("verified", 0.8), ("verified", -1.1)]
    wrong = check_statements("MSFT is flat while GOOGL rose 1.1% today.", _pair())
    assert [s["status"] for s in wrong] == ["contradicted"]


# --- 4. two-ticker comparisons -------------------------------------------------------------
def test_cheaper_on_pe():
    s = _one("GOOGL is cheaper than MSFT on P/E.", _pair())
    assert (s["kind"], s["status"]) == ("comparison", "verified")
    assert s["explanation"] == "GOOGL P/E 17.43 < MSFT P/E 29.66"
    assert _one("MSFT is cheaper than GOOGL on a trailing basis.", _pair())["status"] == "contradicted"
    assert _one("MSFT is more expensive than GOOGL.", _pair())["status"] == "verified"


def test_metric_comparisons():
    assert _one("GOOGL has a higher ROE than MSFT.", _pair())["status"] == "verified"
    assert _one("MSFT's ROE is higher than GOOGL's.", _pair())["status"] == "contradicted"
    assert _one("GOOGL grows faster than MSFT.", _pair())["status"] == "verified"
    assert _one("MSFT is growing revenue faster than GOOGL.", _pair())["status"] == "contradicted"


def test_pair_unverifiable_when_ticker_or_metric_missing():
    s = _one("AMZN is cheaper than MSFT on P/E.", _pair())
    assert s["status"] == "unverifiable" and "AMZN" in s["explanation"]
    s = _one("GOOGL is cheaper than MSFT on a forward basis.", _pair())
    assert s["status"] == "unverifiable" and "forward P/E" in s["explanation"]


# --- 5. quotes ---------------------------------------------------------------------------------
_NEWS = [("S3", "items[0].summary", "The company said demand for  its AI servers “remains robust” , citing orders.")]


def test_real_quote_with_different_whitespace_and_curly_quotes_is_verified():
    s = _one("Management noted “demand for its AI servers remains robust, citing orders”.", _aapl(),
             "quote", source_texts=_NEWS)
    assert s["status"] == "verified"
    assert s["evidence"] == [{"source_id": "S3", "path": "items[0].summary", "value": None}]


def test_fabricated_quote_is_unverifiable_never_contradicted():
    s = _one('The CEO said "we expect record margins next year".', _aapl(), "quote", source_texts=_NEWS)
    assert s["status"] == "unverifiable" and s["explanation"] == "not found verbatim in any source"


def test_quotes_skipped_without_source_texts_and_short_quotes_ignored():
    assert check_statements('He said "we expect record margins next year".', _aapl()) == []
    assert check_statements('It was "very strong".', _aapl(), source_texts=_NEWS) == []


def test_statements_inside_quotes_are_not_the_agents_claims():
    found = check_statements('An analyst wrote "the stock is above its 50-day EMA again".', _aapl(),
                             source_texts=_NEWS)
    assert [s["kind"] for s in found] == ["quote"]


# --- offsets, ordering, robustness ---------------------------------------------------------
def test_offsets_point_at_the_statement_and_results_are_sorted():
    text = "Quick take. AAPL is overbought and its price is above its 50-day EMA, down 0.12% on the day."
    found = check_statements(text, _aapl())
    assert [s["start"] for s in found] == sorted(s["start"] for s in found)
    for s in found:
        assert text[s["start"]:s["end"]] == s["text"]
    by_kind = {s["kind"]: s for s in found}
    assert "overbought" in by_kind["threshold"]["text"]
    assert "above its 50-day EMA" in by_kind["comparison"]["text"]
    assert "down 0.12% on the day" in by_kind["direction"]["text"]


def test_hypotheticals_are_skipped():
    assert check_statements("If RSI turns overbought, trim the position.", _aapl()) == []


def test_garbage_and_empty_ledger_return_empty():
    assert check_statements("Price is above its 50-day EMA.", GroundingLedger()) == []
    assert check_statements("", _aapl()) == []
    assert check_statements(None, _aapl()) == []  # type: ignore[arg-type]
    assert check_statements("RSI overbought", None) == []  # type: ignore[arg-type]
    assert check_statements("x \"" * 500, _aapl(), source_texts=[("S1", "p", None)]) == []  # type: ignore[list-item]


def test_levels_and_support_are_not_price_statements():
    assert check_statements("Support sits at 320 below the 21-day EMA.", _aapl()) == []
    assert check_statements("Place a stop at 318 below the 21-day.", _aapl()) == []


def test_threshold_span_reaches_back_to_rsi_across_decimals():
    s = _one("RSI 14 at 53.3 is neutral.", _aapl())
    assert s["text"] == "RSI 14 at 53.3 is neutral" and s["status"] == "verified"


# --- regressions from live Ornith answers ---------------------------------------------------
def test_negated_states_are_not_contradictions():
    from backend.agent.claim_checks import check_statements
    ledger = _aapl()
    out = check_statements("RSI (14): 52.23 — neutral, no overbought/oversold reading. Neither overbought nor oversold.", ledger)
    assert out and all(s["status"] == "verified" for s in out), out


def test_unnamed_sentences_fall_back_to_the_runs_dominant_ticker():
    from backend.agent.claim_checks import check_statements
    ledger = GroundingLedger()
    ledger.add("analyze_technicals", {"ticker": "NVDA", "price": 240.4, "trend": {"ema_50": 221.0, "ema_200": 205.8},
                                      "momentum": {"rsi_14": 68.07}}, args={"ticker": "NVDA"})
    ledger.add("get_stock_snapshot", {"symbol": "NVDA", "current_price": 240.4, "pe": 30.4}, args={"ticker": "NVDA"})
    ledger.add("get_news_sentiment", {"headlines": [{"ticker": "AMD", "score": 0.4}]})
    out = check_statements("- Price above all MAs\n- RSI near overbought", ledger)
    assert [s["status"] for s in out] == ["verified", "verified"], out


def test_one_off_caps_word_is_not_a_ticker():
    from backend.agent.claim_checks import check_statements
    out = check_statements("**NEW** RSI near overbought", _aapl())
    assert out[0]["status"] != "unverifiable" or "NEW" not in out[0]["explanation"]


def test_pronoun_refers_to_the_moving_average_on_the_line():
    from backend.agent.claim_checks import check_statements
    ok = check_statements("- **50-day EMA:** 324.21 — price is above it (and above the 200-day EMA at 298.08)", _aapl())
    bad = check_statements("- **50-day EMA:** 324.21 — price is below it (and above the 200-day EMA at 298.08)", _aapl())
    assert [s["status"] for s in ok] == ["verified", "verified"], ok
    assert [s["status"] for s in bad] == ["contradicted", "verified"], bad
    assert "50-day" in bad[0]["explanation"] and "text says below" in bad[0]["explanation"]


def test_quantified_statements_check_every_named_ticker():
    from backend.agent.claim_checks import check_statements
    ledger = GroundingLedger()
    for t, price, ema, rsi in (("AAPL", 333.0, 324.27, 61.0), ("MSFT", 530.99, 486.79, 68.6)):
        ledger.add("analyze_technicals", {"ticker": t, "price": price, "trend": {"ema_50": ema},
                                          "momentum": {"rsi_14": rsi}}, args={"ticker": t})
    text = "AAPL and MSFT compared. Both trade above their 50-day EMA; neither is overbought."
    out = {s["kind"]: s for s in check_statements(text, ledger)}
    assert out["comparison"]["status"] == "verified" and "MSFT" in out["comparison"]["explanation"]
    assert out["threshold"]["status"] == "verified", out["threshold"]
    wrong = {s["kind"]: s for s in check_statements("AAPL and MSFT compared. Both are overbought.", ledger)}
    assert wrong["threshold"]["status"] == "contradicted"


def test_under_the_overbought_line_is_not_overbought():
    from backend.agent.claim_checks import check_statements
    ledger = GroundingLedger()
    ledger.add("analyze_technicals", {"ticker": "MSFT", "momentum": {"rsi_14": 68.7}}, args={"ticker": "MSFT"})
    out = check_statements("MSFT RSI(14) 68.70 (strong but still just under the 70 overbought threshold).", ledger)
    assert [s["status"] for s in out] == ["verified"], out


def test_definitions_of_overbought_are_not_claims():
    from backend.agent.claim_checks import check_statements
    ledger = GroundingLedger()
    ledger.add("analyze_technicals", {"ticker": "MSFT", "momentum": {"rsi_14": 68.8}}, args={"ticker": "MSFT"})
    text = "Overbought is conventionally RSI > 70. MSFT RSI(14) is 68.8 — approaching overbought."
    out = check_statements(text, ledger)
    assert [s["status"] for s in out] == ["verified"], out
