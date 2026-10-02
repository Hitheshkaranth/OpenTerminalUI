from __future__ import annotations

import re
from typing import Final


class FinancialSentimentAnalyzer:
    """Lightweight keyword-dictionary financial sentiment scorer."""

    bullish_terms: Final[set[str]] = {
        "beat",
        "beats",
        "beating",
        "outperform",
        "outperformed",
        "outperformance",
        "upgrade",
        "upgraded",
        "buy",
        "strong buy",
        "accumulate",
        "bullish",
        "rally",
        "surge",
        "jump",
        "soar",
        "gain",
        "gains",
        "record high",
        "all-time high",
        "breakout",
        "profit growth",
        "revenue growth",
        "margin expansion",
        "expansion",
        "guidance raised",
        "order win",
        "order book",
        "defence order",
        "contract win",
        "capex",
        "deleveraging",
        "debt reduction",
        "promoter buying",
        "stake increase",
        "fii inflow",
        "dii buying",
        "mutual fund buying",
        "positive outlook",
        "strong demand",
        "market share gain",
        "valuation comfort",
        "supportive policy",
        "tax benefit",
        "pli approval",
        "nclt approval",
        "sebi nod",
        "special dividend",
        "buyback",
        "rights issue subscribed",
        "oversubscribed",
        "ipo subscribed",
    }

    bearish_terms: Final[set[str]] = {
        "miss",
        "missed",
        "underperform",
        "underperformed",
        "downgrade",
        "downgraded",
        "sell",
        "strong sell",
        "bearish",
        "slump",
        "plunge",
        "crash",
        "drop",
        "decline",
        "fall",
        "loss",
        "losses",
        "profit warning",
        "weak guidance",
        "guidance cut",
        "margin pressure",
        "margin contraction",
        "default",
        "insolvency",
        "nclt case",
        "bankruptcy",
        "fraud",
        "probe",
        "sebi action",
        "penalty",
        "pledge increase",
        "promoter pledge",
        "fii outflow",
        "dii selling",
        "stake sale",
        "dilution",
        "rights issue discount",
        "layoffs",
        "demand slowdown",
        "order cancellation",
        "regulatory risk",
        "litigation",
        "delisting risk",
        "debt burden",
        "rating downgrade",
        "strike",
        "plant shutdown",
        "cost inflation",
        "rupee depreciation",
    }

    negations: Final[set[str]] = {
        "not",
        "no",
        "never",
        "none",
        "without",
        "hardly",
        "rarely",
        "isnt",
        "isn't",
        "wasnt",
        "wasn't",
        "dont",
        "don't",
        "didnt",
        "didn't",
        "wont",
        "won't",
        "cant",
        "can't",
    }

    intensifiers: Final[set[str]] = {
        "sharply",
        "massive",
        "strongly",
        "significantly",
        "materially",
        "substantially",
        "steep",
        "steeply",
        "robust",
        "solid",
        "major",
        "majorly",
    }

    def __init__(self) -> None:
        self._token_re = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)?")

    def score(self, text: str) -> dict[str, float | str]:
        """Returns {"score": float, "label": str, "confidence": float}."""
        cleaned = (text or "").strip().lower()
        if not cleaned:
            return {"score": 0.0, "label": "Neutral", "confidence": 0.0}

        bull_score = 0.0
        bear_score = 0.0
        tokens = self._token_re.findall(cleaned)

        if not tokens:
            return {"score": 0.0, "label": "Neutral", "confidence": 0.0}

        phrases: list[tuple[str, int, int]] = []
        for phrase in self.bullish_terms | self.bearish_terms:
            parts = phrase.split()
            n = len(parts)
            if n == 1:
                continue
            for i in range(0, max(0, len(tokens) - n + 1)):
                if tokens[i : i + n] == parts:
                    phrases.append((phrase, i, i + n - 1))

        phrase_token_indexes = {idx for _, start, end in phrases for idx in range(start, end + 1)}

        def _has_negation(start_idx: int) -> bool:
            left = max(0, start_idx - 3)
            return any(tok in self.negations for tok in tokens[left:start_idx])

        def _has_intensifier(start_idx: int) -> bool:
            left = max(0, start_idx - 2)
            return any(tok in self.intensifiers for tok in tokens[left:start_idx])

        def _apply(term: str, start_idx: int, weight: float = 1.0) -> None:
            nonlocal bull_score, bear_score
            is_bull = term in self.bullish_terms
            is_bear = term in self.bearish_terms
            if not is_bull and not is_bear:
                return
            if _has_intensifier(start_idx):
                weight *= 1.5
            negated = _has_negation(start_idx)
            if is_bull:
                if negated:
                    bear_score += weight
                else:
                    bull_score += weight
            elif negated:
                bull_score += weight
            else:
                bear_score += weight

        for phrase, start, _ in phrases:
            _apply(phrase, start, 1.0)

        for i, tok in enumerate(tokens):
            if i in phrase_token_indexes:
                continue
            _apply(tok, i, 1.0)

        raw = (bull_score - bear_score) / (bull_score + bear_score + 1.0)
        score = max(-1.0, min(1.0, raw))
        if score > 0.1:
            label = "Bullish"
        elif score < -0.1:
            label = "Bearish"
        else:
            label = "Neutral"
        confidence = min(1.0, (bull_score + bear_score) / 6.0)
        return {
            "score": round(score, 4),
            "label": label,
            "confidence": round(confidence, 4),
        }


_analyzer = FinancialSentimentAnalyzer()


def score_financial_sentiment(text: str) -> dict[str, float | str]:
    return _analyzer.score(text)
