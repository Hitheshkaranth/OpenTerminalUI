from __future__ import annotations

from nlp.sentiment import FinancialSentimentAnalyzer


def test_sentiment_analyzer_bullish_text() -> None:
    analyzer = FinancialSentimentAnalyzer()
    out = analyzer.score("Company posted strong profit growth with massive order win and sebi nod.")
    assert out["label"] == "Bullish"
    assert float(out["score"]) > 0.1
    assert float(out["confidence"]) > 0.0


def test_sentiment_analyzer_bearish_text() -> None:
    analyzer = FinancialSentimentAnalyzer()
    out = analyzer.score("Stock crashed after weak guidance, fii outflow and rating downgrade.")
    assert out["label"] == "Bearish"
    assert float(out["score"]) < -0.1


def test_sentiment_analyzer_negation_flips_polarity() -> None:
    analyzer = FinancialSentimentAnalyzer()
    out = analyzer.score("Results were not bearish and there was no guidance cut.")
    assert out["score"] >= 0.0
