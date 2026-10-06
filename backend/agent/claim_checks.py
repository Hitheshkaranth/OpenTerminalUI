"""Deterministic checks for the *statements* an agent builds on its figures.

``ground_text`` proves that "P/E 38.1" matches a source, but users act on what the
answer concludes from those numbers: "price is above its 50-day EMA", "GOOGL is
cheaper than MSFT on P/E", "RSI is overbought", "down 0.39% on the day" (the figure
checker compares magnitudes, so a wrong direction slips through), "near its 52-week
high", and quoted text attributed to news or filings. Each such statement is
re-derived from the ledger's numeric leaves and marked:

- ``verified``      — the source values support the statement.
- ``contradicted``  — the source values say the opposite.
- ``unverifiable``  — a needed value (or the ticker) is not in any source, or a quote
  was not found verbatim (paraphrase is possible, so quotes are never contradicted).

No LLM judges the LLM: every check is a regex plus a comparison.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from backend.agent.grounding import (
    _FRACTION_METRICS,
    _SENTENCE_BREAK,
    GroundingLedger,
    Leaf,
    _last_key,
    _phrase_metric,
    _sentence_start,
)

# All-caps words that look like tickers but are vocabulary. An unknown ticker before a
# statement makes it unverifiable, so this list keeps prose from blocking real checks.
_NOT_TICKERS = {
    "EMA", "SMA", "DMA", "WMA", "MA", "MAS", "EMAS", "RSI", "MACD", "ADX", "ATR", "CCI", "OBV", "VWAP", "ROC",
    "PE", "PB", "PS", "EPS", "ROE", "ROCE", "ROA", "EV", "EBITDA", "EBIT", "PAT", "FCF", "DCF", "NAV", "AUM",
    "OPM", "NPM", "TTM", "YOY", "QOQ", "YTD", "MTD", "ATH", "ATL", "LTP", "OI", "PCR", "IV", "USD", "INR", "EUR",
    "GBP", "US", "UK", "EU", "GDP", "CPI", "AI", "CEO", "CFO", "CTO", "IPO", "ETF", "NSE", "BSE", "SEC", "SEBI",
    "RBI", "FED", "FII", "DII", "FPI", "BUY", "SELL", "HOLD", "NOTE", "TLDR", "DR", "TL", "OK", "AND", "OR", "NOT",
    "THE", "IS", "IT", "NO", "YES", "VS", "RVOL", "KPI", "API", "AGM", "QIP", "OFS", "MSCI", "NIFTY", "SENSEX",
    "BANK", "IT", "FMCG", "PSU", "SME", "GST", "Q", "H", "FY", "CY", "EST", "IST", "UTC", "AM", "PM", "TP", "SL",
}

_TICKER_TOKEN = re.compile(r"(?<![A-Za-z0-9])([A-Z][A-Z0-9&]{0,9}(?:\.[A-Z]{1,3})?)(?![A-Za-z0-9])")

# Hypotheticals and plans aren't claims about the current data.
_HYPOTHETICAL = re.compile(
    r"\b(?:if|unless|could|would|might|may|should|once|whether|watch\s+for|wait\s+for|needs?\s+to|target|"
    r"support|resistance|stop(?:-loss)?|entry|exit)\b", re.I)
# "not overbought", "no overbought/oversold reading", "neither overbought nor oversold", "without being oversold".
_NEGATED = re.compile(
    r"(?:\bnot|n't|\bno(?:\s+longer)?|\bnever|\bneither|\bnor|\bwithout(?:\s+being)?)\s+"
    r"(?:(?:is|are|was|were|being|looks?|appears?|seems?|yet|quite|trading|trade|currently|now|an?|any|sign\s+of)\s+){0,2}"
    r"(?:(?:overbought|oversold)\s*(?:/|\bor\b|\bnor\b|\band\b)\s*)?$", re.I)

# --- 1. price (or an MA) vs moving averages ------------------------------------------------
_MA_TOKEN = r"(?:\d{1,3}[\s-]?(?:day|d|dma|sma|ema|ma)\b|(?:ema|sma|dma|ma)[\s-]?\(?\d{1,3}\)?)"
_MA_NOUN = r"(?:\s+(?:emas?|smas?|dmas?|mas?|moving[\s-]averages?|lines?)\b)?"
_MA_ITEM = rf"{_MA_TOKEN}{_MA_NOUN}"
_MA_LIST = rf"{_MA_ITEM}(?:\s*(?:,\s*and|,|/|&|\band\b)\s*(?:(?:its|the)\s+)?{_MA_ITEM})*"
_MA_RE = re.compile(
    rf"\b(?P<verb>above|below|over|under|beneath)\s+"
    rf"(?:(?:both|all|each|of|its|the|their|key|rising|falling|declining|flat|flattening)\s+){{0,4}}"
    rf"(?P<mas>{_MA_LIST})", re.I)
_MA_ALL_RE = re.compile(
    r"\b(?P<verb>above|below)\s+(?:all|each)\s+(?:of\s+)?(?:(?:its|the|their)\s+)?(?:(?:key|major|main)\s+)?"
    r"(?:moving[\s-]averages|mas|emas|smas|dmas)\b", re.I)
_MA_LEFT_RE = re.compile(
    rf"({_MA_ITEM})\s+(?:(?:is|has|sits|remains|stays|crossed|moved|trades|holds|now|still|well|comfortably|just|already)\s+){{0,3}}$",
    re.I)
_CLAUSE_CHARS = r"(?:[^,;:.!?]|\.(?=\d))"  # a decimal point doesn't end the clause
_PRICE_LEAD = re.compile(rf"\b(?:the\s+)?(?:stock|share\s+price|price|shares|it)\b{_CLAUSE_CHARS}{{0,30}}$", re.I)

# --- 2. thresholds ---------------------------------------------------------------------------
_RSI_STATE_RE = re.compile(
    r"\b(?P<mod>(?:approaching|nearing|near(?:ly)?|close\s+to|bordering\s+on|edging\s+towards?)\s+)?"
    r"(?P<state>overbought|oversold)\b", re.I)
_DEFINITION = re.compile(
    r"\s+(?:is|means|refers\s+to)\s+(?:conventionally|typically|usually|generally|commonly|defined|considered|taken)\b"
    r"|\s+(?:is|means)\s+(?:an?\s+)?rsi\b|\s*(?:\(|=|:)\s*rsi\s*[<>≥≤]", re.I)
_NEUTRAL_RE = re.compile(r"\bneutral\b(?![-–]\s?to)", re.I)
_RSI_CONTEXT = re.compile(r"\b(?:rsi|momentum)\b", re.I)
_OTHER_OSCILLATOR = re.compile(r"\b(?:stoch\w*|williams|%r|cci|mfi)\b", re.I)
_RSI_WORD = re.compile(rf"\brsi\b{_CLAUSE_CHARS}{{0,40}}$", re.I)
_52W = r"52[\s-]?(?:week|wk|w)"
_NEAR_HIGH_RE = re.compile(
    rf"\b(?:near|nearing|close\s+to|approaching|just\s+(?:below|under|shy\s+of))\s+"
    rf"(?:(?:its|the|their)\s+(?:{_52W}\s+)?highs?|{_52W}\s+highs?|highs|record(?:\s+highs?)?|"
    rf"(?:an?\s+|its\s+)?all[\s-]time\s+highs?)\b", re.I)
_NEAR_LOW_RE = re.compile(
    rf"\b(?:near|nearing|close\s+to|approaching|just\s+above)\s+"
    rf"(?:(?:its|the|their)\s+(?:{_52W}\s+)?lows?|{_52W}\s+lows?|lows)\b", re.I)

# --- 3. day direction ------------------------------------------------------------------------
_UP_VERBS = ("up", "gained", "gaining", "gains", "rose", "rising", "risen", "added", "adding", "climbed", "climbing",
             "jumped", "advanced", "advancing", "rallied", "higher", "firmer", "surged", "ticked up")
_DOWN_VERBS = ("down", "fell", "falling", "fallen", "declined", "declining", "dropped", "dropping", "slipped",
               "slipping", "lost", "losing", "shed", "sank", "slid", "tumbled", "lower", "eased", "easing", "ticked down")
_VERB_ALT = "|".join(sorted((v.replace(" ", r"\s+") for v in _UP_VERBS + _DOWN_VERBS), key=len, reverse=True))
_DIR_RE = re.compile(
    rf"\b(?P<verb>{_VERB_ALT})\s+(?:by\s+)?(?:(?:about|roughly|around|nearly|almost|over|some|just)\s+)?~?"
    rf"(?P<num>[-+−]?\d+(?:\.\d+)?)\s?%", re.I)
_DIR_AFTER_RE = re.compile(r"(?<![\w.])(?P<num>\d+(?:\.\d+)?)\s?%\s+(?P<verb>higher|lower|up|down)\b", re.I)
_DAY_CTX = re.compile(
    r"\s*(?:on\s+the\s+day|today|in\s+(?:the|today's|this|the\s+latest|the\s+last)\s+session|on\s+the\s+session|"
    r"intraday|for\s+the\s+day|so\s+far\s+today|in\s+(?:early|late|today's)\s+trad(?:e|ing)|at\s+the\s+close|"
    r"day[\s-]over[\s-]day|d/d)\b", re.I)
_OTHER_PERIOD = re.compile(
    r"\s*(?:this|over|in\s+the\s+(?:past|last)|since|ytd|year|yoy|y/y|qoq|q/q|from|for\s+the\s+(?:year|quarter|month|week)|"
    r"last\s+(?:year|quarter|month|week)|in\s+(?:q\d|fy|h\d|\d{4}|the\s+(?:quarter|year|month|week)))\b", re.I)
_PRICE_WORDS = re.compile(r"\b(?:price|stock|shares?|it)\b", re.I)
_OTHER_SUBJECT_WORDS = re.compile(
    r"\b(?:revenue|sales|earnings|profits?|eps|income|margins?|ebitda|volumes?|holdings?|dividends?|orders|guidance|"
    r"deliveries|users|subscribers|growth|cash\s+flow|debt|assets|book\s+value|nav|aum|index|nifty|sensex|s&p|nasdaq|"
    r"dow|sector|market|benchmark|bitcoin|gold|oil|yields?|rupee|dollar)\b", re.I)

# --- 4. two-ticker comparisons -------------------------------------------------------------
_T = r"(?<![\w.])(?P<{g}>[A-Za-z][A-Za-z0-9&]{{0,9}}(?:\.[A-Za-z]{{1,3}})?)(?:'s|’s)?"
_A, _B = _T.format(g="a"), _T.format(g="b")
_INTENSITY = r"(?:(?:much|far|significantly|considerably|slightly|meaningfully|well|still|a\s+bit)\s+)?"
_CHEAPER_RE = re.compile(
    rf"{_A}\s+(?:(?:is|looks|trades|remains|appears|screens|stays)\s+)?{_INTENSITY}"
    rf"(?P<dir>cheaper|more\s+expensive|less\s+expensive|pricier|richer)\s+than\s+{_B}"
    rf"(?P<tail>\s+(?:on|by)\s+(?:a\s+|an\s+|the\s+)?(?:(?:forward|fwd|trailing|ttm)\s+)?"
    rf"(?:p/e|pe|p/b|pb|p/s|ps|ev/ebitda|earnings|book|sales|basis|valuation|multiples?)(?:\s+(?:basis|multiples?|ratio))?)?",
    re.I)
_METRIC_THAN_RE = re.compile(
    rf"{_A}\s+(?P<mw>[A-Za-z/&\- ]{{2,30}}?)\s+(?:(?:is|was|remains|stands|looks)\s+)?{_INTENSITY}"
    rf"(?P<dir>higher|lower|greater|larger|smaller|bigger)\s+than\s+(?:that\s+of\s+)?{_B}", re.I)
_HAS_THAN_RE = re.compile(
    rf"{_A}\s+(?:has|have|had|sports|boasts|carries|offers|shows|posts|delivers|generates|commands|enjoys)\s+"
    rf"(?:a\s+|an\s+|the\s+)?{_INTENSITY}(?P<dir>higher|lower|greater|larger|smaller|bigger|stronger|weaker)\s+"
    rf"(?P<mw>[A-Za-z/&\- ]{{2,30}}?)\s+than\s+{_B}", re.I)
_GROWS_RE = re.compile(
    rf"{_A}\s+(?:is\s+|has\s+)?(?:growing|grows|grew|grown|expanding|expands)\s+(?:its\s+)?"
    rf"(?P<mw>revenue|sales|top[\s-]line|earnings|eps)?\s*(?P<dir>faster|more\s+quickly|slower|more\s+slowly)\s+than\s+{_B}",
    re.I)
_VALUATION = {"pe", "forward_pe", "pb", "ps", "ev_ebitda"}
_GREATER = {"higher", "greater", "larger", "bigger", "stronger", "faster", "more quickly", "more expensive",
            "pricier", "richer"}

# --- 5. quotes --------------------------------------------------------------------------------
_QUOTE_RE = re.compile(r"\"([^\"\n]{8,800})\"|“([^“”\n]{8,800})”")
_CODE_RE = re.compile(r"```.*?```|`[^`\n]+`", re.S)
_ELLIPSIS = re.compile(r"\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…")

_LABELS = {
    "price": "price", "pe": "P/E", "forward_pe": "forward P/E", "pb": "P/B", "ps": "P/S", "ev_ebitda": "EV/EBITDA",
    "roe": "ROE", "roce": "ROCE", "rsi": "RSI", "change_pct": "day change %", "high_52w": "52-week high",
    "low_52w": "52-week low", "pct_below_52w_high": "% below 52-week high", "revenue_growth": "revenue growth",
    "eps_growth": "EPS growth", "op_margin": "operating margin", "net_margin": "net margin",
    "debt_equity": "debt/equity", "dividend_yield": "dividend yield", "market_cap": "market cap",
    "prev_close": "previous close", "pct_above_52w_low": "% above 52-week low",
}


def _label(metric: str) -> str:
    m = re.fullmatch(r"ema_(\d+)", metric)
    if m:
        return f"{m.group(1)}-day EMA"
    return _LABELS.get(metric, metric.replace("_", " "))


def _n(value: float) -> str:
    text = f"{value:,.2f}" if abs(value) >= 1000 else f"{value:.4f}"
    text = text.rstrip("0").rstrip(".") if "." in text else text
    return text.replace("-", "−")


def _src_num(source_id: str) -> int:
    try:
        return int(source_id[1:])
    except (ValueError, IndexError):
        return -1


@dataclass
class _Ctx:
    text: str
    subjects: set[str]
    by_metric: dict[tuple[str | None, str], list[Leaf]] = field(default_factory=dict)
    by_key: dict[tuple[str | None, str], list[Leaf]] = field(default_factory=dict)
    forced: str | None = None  # set while re-checking a "both/each/neither" statement per ticker

    @classmethod
    def build(cls, text: str, ledger: GroundingLedger) -> "_Ctx":
        leaves = [lf for lf in ledger.leaves if lf.kind == "value"]
        ctx = cls(text=text, subjects={lf.subject for lf in leaves if lf.subject})
        # Latest source first, so the first leaf of each bucket is the preferred one.
        for lf in sorted(leaves, key=lambda lf: -_src_num(lf.source_id)):
            if lf.metric:
                ctx.by_metric.setdefault((lf.subject, lf.metric), []).append(lf)
            ctx.by_key.setdefault((lf.subject, _last_key(lf.path)), []).append(lf)
        return ctx

    def resolve(self, token: str) -> str | None:
        up = token.upper()
        for subj in self.subjects:
            if up == subj or up == subj.split(".")[0] or up.split(".")[0] == subj:
                return subj
        return None

    def lookup(self, subject: str | None, metric: str) -> Leaf | None:
        hits = self.by_metric.get((subject, metric))
        if not hits and re.fullmatch(r"ema_\d+", metric):
            period = metric.split("_")[1]
            for key in (metric, f"sma_{period}", f"dma_{period}"):
                hits = self.by_key.get((subject, key))
                if hits:
                    break
        return hits[0] if hits else None


@dataclass
class _Subject:
    ticker: str | None
    ok: bool
    why: str = ""


def _is_ticker_like(token: str) -> bool:
    base = token.split(".")[0]
    if base in _NOT_TICKERS or len(re.sub(r"[^A-Z]", "", base)) < 2:
        return False
    return not re.fullmatch(r"(?:FY|CY|Q|H)\d+", base)


_AS_SUBJECT = re.compile(
    r"(?:'s|’s)?\s+(?:is|are|was|were|has|have|trades?|trading|shares|stock|sits|remains|closed|looks)\b", re.I)


def _used_as_ticker(text: str, token: str, _end: int) -> bool:
    """A caps word the tools never covered is a ticker if it recurs or acts as a subject ("NVDA is",
    "NVDA's", "$NVDA"); a one-off emphasis word ("**NEW**") is not."""
    pattern = rf"(?<![A-Za-z0-9]){re.escape(token)}(?![A-Za-z0-9])"
    hits = list(re.finditer(pattern, text))
    if len(hits) > 1:
        return True
    return any(_AS_SUBJECT.match(text, h.end()) or text[max(0, h.start() - 1):h.start()] == "$" for h in hits)


def _last_ticker(ctx: _Ctx, before: str, *, known_only: bool = False) -> _Subject | None:
    last: _Subject | None = None
    for m in _TICKER_TOKEN.finditer(before):
        token = m.group(1)
        resolved = ctx.resolve(token)
        if resolved:
            last = _Subject(resolved, True)
        elif not known_only and _is_ticker_like(token) and _used_as_ticker(ctx.text, token, m.end()):
            last = _Subject(None, False, f"{token} is not in any tool result")
    return last


def _dominant(ctx: _Ctx) -> str | None:
    """The run's main ticker: the one most labelled values belong to, if clearly ahead of the rest
    (a debate on NVDA also carries peers and headline tickers)."""
    counts: dict[str, int] = {}
    for (subject, _metric), leaves in ctx.by_metric.items():
        if subject:
            counts[subject] = counts.get(subject, 0) + len(leaves)
    ranked = sorted(counts.items(), key=lambda item: -item[1])
    if ranked and (len(ranked) == 1 or ranked[0][1] >= 2 * ranked[1][1]):
        return ranked[0][0]
    return None


_MULTI_WHY = "several tickers are in the sources and the answer names none"
_QUANTIFIER = re.compile(r"\b(?:both|each|neither|all\s+(?:two|three|four|of\s+them))\b", re.I)
_FAMILIES: tuple = ()  # filled once the family checks are defined


def _quantified(ctx: _Ctx, found: list[dict[str, Any]]) -> None:
    """"Both trade above their 50-day EMA" / "neither is overbought": re-check the statement for each
    ticker the answer names and combine — verified only if it holds for every one."""
    named: list[str] = []
    for m in _TICKER_TOKEN.finditer(ctx.text):
        t = ctx.resolve(m.group(1))
        if t and t not in named:
            named.append(t)
    tickers = named or sorted(ctx.subjects)
    for st in found:
        if st["status"] != "unverifiable" or st["explanation"] != _MULTI_WHY or len(tickers) < 2:
            continue
        if not _QUANTIFIER.search(ctx.text[_sentence_start(ctx.text, st["start"]):st["end"]]):
            continue
        per: list[tuple[str, dict[str, Any]]] = []
        for t in tickers:
            ctx.forced = t
            try:
                for check in _FAMILIES:
                    per += [(t, r) for r in check(ctx) if r["start"] == st["start"] and r["kind"] == st["kind"]]
            finally:
                ctx.forced = None
        if not per:
            continue
        statuses = {r["status"] for _t, r in per}
        st["status"] = ("contradicted" if "contradicted" in statuses
                        else "verified" if statuses == {"verified"} else "unverifiable")
        st["evidence"] = [e for _t, r in per for e in r["evidence"]]
        st["explanation"] = "; ".join(f"{t}: {r['explanation']}" for t, r in per)


def _subject(ctx: _Ctx, pos: int) -> _Subject:
    """Nearest ticker before ``pos`` in its sentence, else the last one named earlier in the answer,
    else the run's dominant ticker."""
    # Earlier sentences only lend a ticker the tools actually covered ("PEG", "AVOID" recur as words).
    if ctx.forced:
        return _Subject(ctx.forced, True)
    sentence_left = ctx.text[_sentence_start(ctx.text, pos):pos]
    in_sentence = _last_ticker(ctx, sentence_left)
    if in_sentence is None and _QUANTIFIER.search(sentence_left) and len(ctx.subjects) > 1:
        return _Subject(None, False, _MULTI_WHY)  # "both"/"neither": checked per ticker by _quantified
    found = (in_sentence
             or _last_ticker(ctx, ctx.text[:pos], known_only=True))
    if found is not None:
        return found
    if len(ctx.subjects) == 1:
        return _Subject(next(iter(ctx.subjects)), True)
    if not ctx.subjects:
        return _Subject(None, True)  # tools without a ticker: match leaves that have no subject
    dominant = _dominant(ctx)
    if dominant:
        return _Subject(dominant, True)
    return _Subject(None, False, _MULTI_WHY)


def _ev(leaf: Leaf) -> dict[str, Any]:
    return {"source_id": leaf.source_id, "path": leaf.path, "value": leaf.value}


def _stmt(ctx: _Ctx, start: int, end: int, kind: str, status: str, evidence: list[dict[str, Any]],
          explanation: str) -> dict[str, Any]:
    return {"text": ctx.text[start:end], "start": start, "end": end, "kind": kind, "status": status,
            "evidence": evidence, "explanation": explanation}


def _who(subject: str | None) -> str:
    return f" for {subject}" if subject else ""


def _sentence_end(text: str, pos: int) -> int:
    m = _SENTENCE_BREAK.search(text, pos)
    return m.start() if m else len(text)


def _skip(ctx: _Ctx, start: int) -> bool:
    return bool(_HYPOTHETICAL.search(ctx.text[_sentence_start(ctx.text, start):start]))


# --- family checks ---------------------------------------------------------------------------
def _ma_periods(mas: str) -> list[str]:
    seen: list[str] = []
    for p in re.findall(r"\d{1,3}", mas):
        metric = f"ema_{int(p)}"
        if metric not in seen:
            seen.append(metric)
    return seen


def _check_ma(ctx: _Ctx) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    text = ctx.text
    matches = [(m, None) for m in _MA_RE.finditer(text)] + [(m, "all") for m in _MA_ALL_RE.finditer(text)]
    for m, mode in matches:
        verb_start = m.start("verb")
        ss = _sentence_start(text, verb_start)
        left = text[ss:verb_start]
        if re.search(r"\d\s*$", left):
            continue  # "a stop at 320 below the 21-day": a level, not the price
        left_ma = _MA_LEFT_RE.search(left)
        lead = _PRICE_LEAD.search(left)
        if lead and re.search(r"\b(?:above|below|over|under|beneath)\b", left[lead.start():]):
            lead = None  # "price is below it (and above the 200-day)": that lead belongs to the first comparison
        start = ss + left_ma.start() if left_ma else (ss + lead.start() if lead else verb_start)
        if _skip(ctx, start):
            continue
        above = m.group("verb").lower() in ("above", "over")
        if _NEGATED.search(left):
            above = not above
        subj = _subject(ctx, start)
        if not subj.ok:
            out.append(_stmt(ctx, start, m.end(), "comparison", "unverifiable", [], subj.why))
            continue
        left_metric = _ma_periods(left_ma.group(1))[0] if left_ma else "price"
        if mode == "all":
            targets = sorted({k[1] for k in list(ctx.by_metric) + list(ctx.by_key)
                              if k[0] == subj.ticker and re.fullmatch(r"ema_\d+", k[1])},
                             key=lambda s: int(s.split("_")[1]))
        else:
            targets = _ma_periods(m.group("mas"))
        targets = [t for t in targets if t != left_metric]
        if not targets:
            continue
        base = ctx.lookup(subj.ticker, left_metric)
        if base is None:
            out.append(_stmt(ctx, start, m.end(), "comparison", "unverifiable", [],
                             f"no {_label(left_metric)}{_who(subj.ticker)} in any tool result"))
            continue
        evidence, parts, missing, failed = [_ev(base)], [], [], False
        for metric in targets:
            leaf = ctx.lookup(subj.ticker, metric)
            if leaf is None:
                missing.append(_label(metric))
                continue
            evidence.append(_ev(leaf))
            holds = base.value > leaf.value if above else base.value < leaf.value
            op = ">" if base.value > leaf.value else ("<" if base.value < leaf.value else "=")
            parts.append(f"{_label(left_metric)} {_n(base.value)} {op} {_label(metric)} {_n(leaf.value)}")
            failed = failed or not holds
        side = "above" if above else "below"
        if failed:
            status, expl = "contradicted", "; ".join(parts) + f", but text says {side}"
        elif missing:
            status = "unverifiable"
            expl = f"no {', '.join(missing)}{_who(subj.ticker)} in any tool result" + (
                f" ({'; '.join(parts)})" if parts else "")
        else:
            status, expl = "verified", "; ".join(parts)
        out.append(_stmt(ctx, start, m.end(), "comparison", status, evidence, expl))
    return out


_MA_PRONOUN_RE = re.compile(
    r"\b(?:the\s+)?(?:price|stock|shares|it)\s+(?:is|sits|trades|holds|remains|stays|closed)\s+"
    r"(?:(?:still|well|comfortably|just|now|slightly|firmly)\s+)?(?P<verb>above|below|under|over)\s+"
    r"(?:it|that|this(?:\s+level)?)\b", re.I)
_MA_ITEM_RE = re.compile(_MA_ITEM, re.I)


def _check_ma_pronoun(ctx: _Ctx) -> list[dict[str, Any]]:
    """"**50-day EMA:** 324.21 — price is above it": "it" is the moving average named earlier on the line."""
    out: list[dict[str, Any]] = []
    text = ctx.text
    for m in _MA_PRONOUN_RE.finditer(text):
        line_start = text.rfind("\n", 0, m.start()) + 1
        items = list(_MA_ITEM_RE.finditer(text, line_start, m.start()))
        if not items or _skip(ctx, m.start()):
            continue
        metric = _ma_periods(items[-1].group(0))[0]
        above = m.group("verb").lower() in ("above", "over")
        if _NEGATED.search(text[_sentence_start(text, m.start()):m.start("verb")]):
            above = not above
        subj = _subject(ctx, m.start())
        if not subj.ok:
            out.append(_stmt(ctx, m.start(), m.end(), "comparison", "unverifiable", [], subj.why))
            continue
        base, leaf = ctx.lookup(subj.ticker, "price"), ctx.lookup(subj.ticker, metric)
        if base is None or leaf is None:
            missing = "price" if base is None else _label(metric)
            out.append(_stmt(ctx, m.start(), m.end(), "comparison", "unverifiable", [],
                             f"no {missing}{_who(subj.ticker)} in any tool result"))
            continue
        holds = base.value > leaf.value if above else base.value < leaf.value
        op = ">" if base.value > leaf.value else ("<" if base.value < leaf.value else "=")
        expl = f"price {_n(base.value)} {op} {_label(metric)} {_n(leaf.value)}"
        if not holds:
            expl += f", but text says {'above' if above else 'below'}"
        out.append(_stmt(ctx, m.start(), m.end(), "comparison", "verified" if holds else "contradicted",
                         [_ev(base), _ev(leaf)], expl))
    return out


def _rsi_rule(mod: bool, state: str) -> tuple[float | None, float | None, bool, bool, str]:
    """(low, high, low inclusive, high inclusive, description) of the RSI band a phrase claims."""
    if state == "neutral":
        return 30, 70, False, False, "neutral (between 30 and 70)"
    if state == "overbought":
        return (60, 75, True, False, "approaching overbought (60–75)") if mod else (70, None, True, False, "overbought (≥ 70)")
    return (25, 40, False, True, "approaching oversold (25–40)") if mod else (None, 30, False, True, "oversold (≤ 30)")


def _check_thresholds(ctx: _Ctx) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    text = ctx.text
    found: list[tuple[int, int, bool, str]] = []
    for m in _RSI_STATE_RE.finditer(text):
        found.append((m.start(), m.end(), bool(m.group("mod")), m.group("state").lower()))
    for m in _NEUTRAL_RE.finditer(text):
        sent = text[_sentence_start(text, m.start()):_sentence_end(text, m.end())]
        if _RSI_CONTEXT.search(sent):
            found.append((m.start(), m.end(), False, "neutral"))
    for start, end, mod, state in found:
        if _DEFINITION.match(text, end):
            continue  # "Overbought is conventionally RSI > 70" defines the term, it claims nothing
        ss = _sentence_start(text, start)
        left = text[ss:start]
        if _OTHER_OSCILLATOR.search(left) and not re.search(r"\brsi\b", left, re.I):
            continue
        rsi_word = _RSI_WORD.search(left)
        span_start = ss + rsi_word.start() if rsi_word else start
        if _skip(ctx, span_start):
            continue
        negated = bool(_NEGATED.search(left))
        # "just under the 70 overbought threshold" / "above the 30 oversold line" deny the state.
        side = r"under|below|beneath|short\s+of" if state == "overbought" else r"above|over"
        if not mod and re.search(rf"\b(?:{side})\s+(?:the\s+|its\s+)?(?:\d{{2}}\s+)?$", left, re.I):
            negated = True
        subj = _subject(ctx, span_start)
        if not subj.ok:
            out.append(_stmt(ctx, span_start, end, "threshold", "unverifiable", [], subj.why))
            continue
        leaf = ctx.lookup(subj.ticker, "rsi")
        if leaf is None:
            out.append(_stmt(ctx, span_start, end, "threshold", "unverifiable", [],
                             f"no RSI{_who(subj.ticker)} in any tool result"))
            continue
        lo, hi, lo_inc, hi_inc, desc = _rsi_rule(mod, state)
        v = leaf.value
        inside = (lo is None or (v >= lo if lo_inc else v > lo)) and (hi is None or (v <= hi if hi_inc else v < hi))
        name = desc.split(" (")[0]
        if inside != negated:
            status = "verified"
            expl = f"RSI {_n(v)} is {desc}" if not negated else f"RSI {_n(v)} is not {name} ({desc.split('(')[1][:-1]})"
        else:
            status = "contradicted"
            expl = (f"RSI {_n(v)} is not {name} (needs {desc.split('(')[1][:-1]})" if not negated
                    else f"RSI {_n(v)} is {desc} but text says not")
        out.append(_stmt(ctx, span_start, end, "threshold", status, [_ev(leaf)], expl))

    for regex, high in ((_NEAR_HIGH_RE, True), (_NEAR_LOW_RE, False)):
        for m in regex.finditer(text):
            start, end = m.start(), m.end()
            if _skip(ctx, start):
                continue
            negated = bool(_NEGATED.search(text[_sentence_start(text, start):start]))
            subj = _subject(ctx, start)
            if not subj.ok:
                out.append(_stmt(ctx, start, end, "threshold", "unverifiable", [], subj.why))
                continue
            out.append(_near_extreme(ctx, subj.ticker, start, end, high, negated))
    return out


def _near_extreme(ctx: _Ctx, subject: str | None, start: int, end: int, high: bool, negated: bool) -> dict[str, Any]:
    word = "52-week high" if high else "52-week low"
    dist_leaf = ctx.lookup(subject, "pct_below_52w_high" if high else "pct_above_52w_low")
    price = ctx.lookup(subject, "price")
    level = ctx.lookup(subject, "high_52w" if high else "low_52w")
    if dist_leaf is not None:
        dist, evidence = abs(dist_leaf.value), [_ev(dist_leaf)]
    elif price is not None and level is not None and level.value > 0:
        dist = abs(price.value / level.value - 1) * 100
        evidence = [_ev(price), _ev(level)]
    else:
        return _stmt(ctx, start, end, "threshold", "unverifiable", [],
                     f"no {word} or distance from it{_who(subject)} in any tool result")
    near = dist <= 5.0 + 1e-9
    where = "below" if high else "above"
    fact = f"price is {_n(round(dist, 2))}% {where} its {word}"
    if near != negated:
        expl = f"{fact} (near = within 5%)" if near else f"{fact}, more than 5% away"
        return _stmt(ctx, start, end, "threshold", "verified", evidence, expl)
    expl = f"{fact}, not near it (needs within 5%)" if not near else f"{fact}, within 5%, but text says not near"
    return _stmt(ctx, start, end, "threshold", "contradicted", evidence, expl)


def _check_direction(ctx: _Ctx) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    text = ctx.text
    for regex, needs_day in ((_DIR_RE, False), (_DIR_AFTER_RE, True)):
        for m in regex.finditer(text):
            start, end = m.start(), m.end()
            after = text[end:end + 50]
            day = bool(_DAY_CTX.match(after))
            if needs_day and not day:
                continue
            if not day and _OTHER_PERIOD.match(after):
                continue
            ss = _sentence_start(text, start)
            seg = text[ss:start]
            clause = seg[max(seg.rfind(ch) for ch in ",;:(—") + 1:]
            last_other = max((x.end() for x in _OTHER_SUBJECT_WORDS.finditer(clause)), default=-1)
            last_price = max([x.end() for x in _PRICE_WORDS.finditer(clause)]
                             + [x.end() for x in _TICKER_TOKEN.finditer(clause)
                                if ctx.resolve(x.group(1)) or _is_ticker_like(x.group(1))], default=-1)
            if last_other > last_price:
                continue
            if last_price < 0 and not day:
                continue
            if day:
                end += _DAY_CTX.match(after).end()  # type: ignore[union-attr]
            if _skip(ctx, start):
                continue
            up = re.sub(r"\s+", " ", m.group("verb").lower()) in _UP_VERBS
            said = "up" if up else "down"
            subj = _subject(ctx, start)
            if not subj.ok:
                out.append(_stmt(ctx, start, end, "direction", "unverifiable", [], subj.why))
                continue
            leaf = ctx.lookup(subj.ticker, "change_pct")
            if leaf is not None:
                change, evidence, name = leaf.value, [_ev(leaf)], "change_pct"
            else:
                price, prev = ctx.lookup(subj.ticker, "price"), ctx.lookup(subj.ticker, "prev_close")
                if price is None or prev is None:
                    out.append(_stmt(ctx, start, end, "direction", "unverifiable", [],
                                     f"no day change or previous close{_who(subj.ticker)} in any tool result"))
                    continue
                change, evidence, name = price.value - prev.value, [_ev(price), _ev(prev)], "price − previous close"
            if change == 0:
                out.append(_stmt(ctx, start, end, "direction", "contradicted", evidence,
                                 f"{name} is 0 (unchanged) but text says {said}"))
            elif (change > 0) == up:
                out.append(_stmt(ctx, start, end, "direction", "verified", evidence,
                                 f"{name} is {_n(change)}, consistent with {said}"))
            else:
                out.append(_stmt(ctx, start, end, "direction", "contradicted", evidence,
                                 f"{name} is {_n(change)} but text says {said}"))
    return out


def _pair_values(metric: str, a: Leaf, b: Leaf) -> tuple[float, float]:
    """One provider may store a fraction (0.48) where another stores a percent (48.2)."""
    va, vb = a.value, b.value
    if metric in _FRACTION_METRICS and a.source_id != b.source_id:
        if abs(va) <= 1.5 < abs(vb):
            va *= 100
        elif abs(vb) <= 1.5 < abs(va):
            vb *= 100
    return va, vb


def _check_pairs(ctx: _Ctx) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    text = ctx.text
    for regex in (_CHEAPER_RE, _METRIC_THAN_RE, _HAS_THAN_RE, _GROWS_RE):
        for m in regex.finditer(text):
            ta, tb = m.group("a"), m.group("b")
            if ta != ta.upper() or tb != tb.upper() or not (_is_ticker_like(ta) or ctx.resolve(ta)) \
                    or not (_is_ticker_like(tb) or ctx.resolve(tb)):
                continue
            direction = re.sub(r"\s+", " ", m.group("dir").lower())
            sentence = text[_sentence_start(text, m.start()):_sentence_end(text, m.end())]
            if regex is _CHEAPER_RE:
                metric = "pe"
                if re.search(r"\b(?:forward|fwd)\b", sentence, re.I):
                    metric = "forward_pe"
                elif m.group("tail"):
                    named = _phrase_metric(m.group("tail"), True)
                    metric = named if named in _VALUATION else "pe"
                greater = direction in _GREATER
            elif regex is _GROWS_RE:
                metric = "eps_growth" if (m.group("mw") or "").lower() in ("earnings", "eps") else "revenue_growth"
                greater = direction in _GREATER
            else:
                metric = _phrase_metric(m.group("mw"), True)
                if metric is None or (direction in ("stronger", "weaker") and metric in _VALUATION):
                    continue
                if metric == "pe" and re.search(r"\b(?:forward|fwd)\b", m.group("mw"), re.I):
                    metric = "forward_pe"
                greater = direction in _GREATER
            start, end = m.start(), m.end()
            if _skip(ctx, start):
                continue
            sa, sb = ctx.resolve(ta), ctx.resolve(tb)
            if sa is None or sb is None:
                missing = ta if sa is None else tb
                out.append(_stmt(ctx, start, end, "comparison", "unverifiable", [],
                                 f"{missing} is not in any tool result"))
                continue
            la, lb = ctx.lookup(sa, metric), ctx.lookup(sb, metric)
            if la is None or lb is None:
                who = [s for s, lf in ((sa, la), (sb, lb)) if lf is None]
                out.append(_stmt(ctx, start, end, "comparison", "unverifiable", [_ev(lf) for lf in (la, lb) if lf],
                                 f"no {_label(metric)} for {' or '.join(who)} in any tool result"))
                continue
            va, vb = _pair_values(metric, la, lb)
            evidence = [_ev(la), _ev(lb)]
            if metric in _VALUATION and (va <= 0 or vb <= 0) and regex is _CHEAPER_RE:
                out.append(_stmt(ctx, start, end, "comparison", "unverifiable", evidence,
                                 f"{_label(metric)} is not positive for {sa if va <= 0 else sb} (loss-making), "
                                 "so cheaper/more expensive on it is undefined"))
                continue
            op = ">" if va > vb else ("<" if va < vb else "=")
            fact = f"{sa} {_label(metric)} {_n(va)} {op} {sb} {_label(metric)} {_n(vb)}"
            holds = va > vb if greater else va < vb
            out.append(_stmt(ctx, start, end, "comparison", "verified" if holds else "contradicted", evidence,
                             fact if holds else f"{fact}, but text says {direction}"))
    return out


def _norm(text: str) -> str:
    return " ".join(re.findall(r"[^\W_]+", text.lower().replace("’", "'").replace("‘", "'")))


def _code_spans(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in _CODE_RE.finditer(text)]


def _quote_spans(text: str) -> list[tuple[int, int, str]]:
    code = _code_spans(text)
    spans = []
    for m in _QUOTE_RE.finditer(text):
        if any(a <= m.start() < b for a, b in code):
            continue
        spans.append((m.start(), m.end(), m.group(1) if m.group(1) is not None else m.group(2)))
    return spans


def _check_quotes(ctx: _Ctx, source_texts: list[tuple[str, str, str]]) -> list[dict[str, Any]]:
    corpus = [(sid, path, f" {_norm(body)} ") for sid, path, body in source_texts if isinstance(body, str)]
    out: list[dict[str, Any]] = []
    for start, end, inner in _quote_spans(ctx.text):
        if sum(1 for w in re.findall(r"\S+", inner) if re.search(r"[A-Za-z]", w)) < 4:
            continue
        fragments = [f" {_norm(part)} " for part in _ELLIPSIS.split(inner) if _norm(part)]
        if not fragments:
            continue
        hits = []
        for sid, path, body in corpus:
            pos = 0
            for frag in fragments:  # elided quotes: each piece must appear, in order
                found = body.find(frag, pos)
                if found < 0:
                    break
                pos = found + len(frag) - 1
            else:
                hits.append({"source_id": sid, "path": path, "value": None})
        if hits:
            out.append(_stmt(ctx, start, end, "quote", "verified", hits[:3],
                             f"found verbatim in {', '.join(h['source_id'] for h in hits[:3])}"))
        else:
            out.append(_stmt(ctx, start, end, "quote", "unverifiable", [], "not found verbatim in any source"))
    return out


_FAMILIES = (_check_ma, _check_ma_pronoun, _check_thresholds, _check_direction, _check_pairs)


def check_statements(text: str, ledger: GroundingLedger,
                     source_texts: list[tuple[str, str, str]] | None = None) -> list[dict[str, Any]]:
    """Check comparison / threshold / direction / quote statements in ``text`` against ``ledger``.

    ``source_texts`` is ``[(source_id, path, text), ...]`` of prose the tools returned (news
    headlines and bodies, filing excerpts); quotes are skipped when it is None.
    Never raises; returns statements sorted by start offset.
    """
    try:
        if not isinstance(text, str) or not text.strip() or not isinstance(ledger, GroundingLedger):
            return []
        ctx = _Ctx.build(text, ledger)
        found: list[dict[str, Any]] = []
        if ctx.by_metric or ctx.by_key:
            for check in _FAMILIES:
                try:
                    found.extend(check(ctx))
                except Exception:  # noqa: BLE001 - one broken family must not hide the others
                    continue
            try:
                _quantified(ctx, found)
            except Exception:  # noqa: BLE001
                pass
        quotes = _quote_spans(text)
        # Statements inside a quotation are someone else's words, not the agent's claim.
        found = [s for s in found if not any(a <= s["start"] < b for a, b, _ in quotes)]
        if source_texts is not None:
            try:
                found.extend(_check_quotes(ctx, source_texts))
            except Exception:  # noqa: BLE001
                pass
        found.sort(key=lambda s: (s["start"], -(s["end"] - s["start"])))
        kept: list[dict[str, Any]] = []
        for s in found:
            if any(k["kind"] == s["kind"] and k["start"] < s["end"] and s["start"] < k["end"] for k in kept):
                continue
            kept.append(s)
        return kept
    except Exception:  # noqa: BLE001 - runs inside a live answer stream
        return []
