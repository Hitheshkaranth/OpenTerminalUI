"""Ground-truth verification for agent outputs.

Every figure an agent writes (a price, a ratio, a backtest metric) must trace back to
something a tool actually returned. ``ground_stream`` wraps any orchestrator's event
stream, records each tool result as a numbered *source* (tool, arguments, provider,
data quality, as-of time), and after every ``final``/``role_message`` emits a
``grounding`` event that pairs each figure in the text with the source value it
came from:

- ``verified``   — the figure equals a source value (up to the rounding shown).
- ``mismatch``   — the text names a metric whose source value differs.
- ``unsourced``  — no tool result contains the figure (computed or invented).

The check is deterministic: no LLM judges the LLM.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Iterable

from backend.agent.events import ARTIFACT_KINDS

# Tools that predate the provenance envelope report no provider; say what the figures are
# computed from instead of claiming a provider we can't see.
_DEFAULT_PROVENANCE: dict[str, tuple[str, str]] = {
    "screen_stocks": ("screener fundamentals store", "cached"),
    "search_research": ("local research index", "cached"),
    "scan_setups": ("scanner engine over price history", "unreported"),
    "validate_backtest": ("computed: permutation + multi-window test", "computed"),
    "get_portfolio": ("your portfolio (database)", "live"),
    "get_paper_positions": ("your paper account (database)", "live"),
    "get_watchlists": ("your watchlists (database)", "live"),
    "get_alerts": ("your alerts (database)", "live"),
}

_LOW_QUALITY = {"synthetic", "unavailable", "unreported"}
_MAX_LEAVES_PER_SOURCE = 2500
_MAX_LIST_ITEMS = 40  # longer lists (equity curves, bar series) keep only their ends

# --- metric vocabulary ---------------------------------------------------------------
# canonical -> (leaf keys, phrases that name it in prose)
_METRICS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "price": (("current_price", "price", "close", "last_price", "ltp", "last", "price_at_signal"),
              ("price", "trading at", "trades at", "ltp", "last traded", "closed at", "close", "quote")),
    "prev_close": (("previous_close", "prev_close", "prior_close"), ("prev close", "previous close", "prior close", "prev. close")),
    "open": (("open", "open_price"), ("open", "opened at")),
    "day_high": (("day_high", "high"), ("day high", "day's high", "intraday high")),
    "day_low": (("day_low", "low"), ("day low", "day's low", "intraday low")),
    "pct_below_52w_high": (("pct_below_52w_high", "distance_from_52w_high_pct"),
                           ("off its high", "off the high", "below its high", "below the high", "from its high",
                            "from the high", "off its 52-week high", "below its 52-week high", "from its 52-week high",
                            "off the record", "below the record", "from the record", "off its record", "off highs",
                            "off the highs")),
    "pct_above_52w_low": (("pct_above_52w_low",), ("above its low", "above the low", "off its low", "off the low",
                                                   "above its 52-week low", "off its 52-week low")),
    "pe": (("pe", "pe_ratio", "trailing_pe", "price_to_earnings"),
           ("p/e", "pe ratio", "pe", "price-to-earnings", "price to earnings", "earnings multiple")),
    "forward_pe": (("forward_pe",), ("forward p/e", "fwd p/e", "forward pe", "fwd pe")),
    "pb": (("pb", "pb_ratio", "price_to_book"), ("p/b", "price-to-book", "price to book")),
    "ps": (("ps", "ps_ratio", "price_to_sales"), ("p/s", "price-to-sales", "price to sales")),
    "enterprise_value": (("enterprise_value", "ev"), ("enterprise value", "ev")),
    "range_position": (("range_52w_position_pct",), ("of the 52-week range", "of its 52-week range", "of 52-week range",
                                                    "of the range", "of its range", "percentile", "of the 52w range")),
    "ev_ebitda": (("ev_ebitda",), ("ev/ebitda",)),
    "roe": (("roe", "roe_pct"), ("roe", "return on equity")),
    "roce": (("roce", "roce_pct"), ("roce", "return on capital employed")),
    "market_cap": (("market_cap", "mcap", "marketcap"), ("market cap", "mcap", "market capitali")),
    "dividend_yield": (("dividend_yield", "div_yield_pct", "dividend_yield_pct"), ("dividend yield", "div yield")),
    "debt_equity": (("debt_equity", "debt_to_equity", "de_ratio"), ("debt/equity", "debt-to-equity", "debt to equity", "d/e")),
    "revenue_growth": (("revenue_growth", "rev_growth_pct", "revenue_growth_pct", "sales_growth"),
                       ("revenue growth", "sales growth", "rev growth", "revenue grew", "revenue up")),
    "eps_growth": (("eps_growth_pct", "eps_growth", "earnings_growth"), ("eps growth", "earnings growth")),
    "op_margin": (("op_margin_pct", "opm", "operating_margin"), ("operating margin", "op margin", "opm")),
    "net_margin": (("net_margin_pct", "net_margin"), ("net margin",)),
    "beta": (("beta",), ("beta",)),
    "rsi": (("rsi_14", "rsi"), ("rsi",)),
    "ema_50": (("ema_50", "sma_50", "dma_50"), ("50-day", "50 day", "50 dma", "50dma", "50-dma", "ema50", "ema 50", "ema-50")),
    "ema_200": (("ema_200", "sma_200", "dma_200"), ("200-day", "200 day", "200 dma", "200dma", "200-dma", "ema200", "ema 200", "ema-200")),
    "high_52w": (("high_52w", "range_52w_high", "fifty_two_week_high", "year_high"), ("52-week high", "52w high", "52 week high", "52-wk high")),
    "low_52w": (("low_52w", "range_52w_low", "fifty_two_week_low", "year_low"), ("52-week low", "52w low", "52 week low", "52-wk low")),
    "change_pct": (("change_pct", "pct_change", "change_percent"), ("change",)),
    "sharpe": (("sharpe",), ("sharpe",)),
    "sortino": (("sortino",), ("sortino",)),
    "calmar": (("calmar",), ("calmar",)),
    "max_drawdown": (("max_drawdown_pct", "max_drawdown"), ("drawdown",)),
    "cagr": (("cagr_pct", "cagr"), ("cagr",)),
    "total_return": (("total_return_pct", "total_return"), ("total return",)),
    "win_rate": (("win_rate_pct", "win_rate"), ("win rate", "hit rate")),
    "profit_factor": (("profit_factor",), ("profit factor",)),
    "p_value": (("p_value",), ("p-value", "p value")),
    "atr": (("atr_pct", "atr"), ("atr",)),
    "rvol": (("rvol_20", "rvol"), ("rvol", "relative volume")),
    "promoter_holding": (("promoter_holding", "promoter_pct"), ("promoter",)),
    "score": (("score", "composite_score", "avg_score"), ("score",)),
}

_RELATED = {"pe": {"forward_pe"}, "forward_pe": {"pe"}, "price": {"prev_close"},
            "pct_below_52w_high": {"range_position"}, "range_position": {"pct_below_52w_high"}}

# Metrics a provider may store as a fraction (0.482) while prose shows a percent (48.2%).
_FRACTION_METRICS = {"roe", "roce", "dividend_yield", "revenue_growth", "eps_growth", "op_margin", "net_margin",
                     "change_pct", "max_drawdown", "cagr", "total_return", "win_rate"}

_KEY_TO_METRIC = {key: metric for metric, (keys, _) in _METRICS.items() for key in keys}
# Longest phrase first, so "ev/ebitda" wins over "ev" at the same position.
_PHRASES = sorted(((p, metric) for metric, (_, phrases) in _METRICS.items() for p in phrases),
                  key=lambda item: -len(item[0]))
_PHRASE_RE = re.compile(
    "|".join(f"(?P<m{idx}>(?<![a-z0-9]){re.escape(phrase)}(?![a-z]))" for idx, (phrase, _) in enumerate(_PHRASES)),
    re.IGNORECASE,
)
_PHRASE_METRIC = [metric for _, metric in _PHRASES]

# --- figure extraction ---------------------------------------------------------------
_UNIT_MULT = {
    "k": 1e3, "thousand": 1e3, "m": 1e6, "mn": 1e6, "mm": 1e6, "million": 1e6,
    "b": 1e9, "bn": 1e9, "billion": 1e9, "t": 1e12, "tn": 1e12, "trillion": 1e12,
    "cr": 1e7, "crore": 1e7, "crores": 1e7, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "l": 1e5,
    "lakh crore": 1e12, "lakh crores": 1e12, "lakh cr": 1e12,
}
_NUM_RE = re.compile(
    r"(?P<cur>[₹$€£]|Rs\.?\s?|INR\s?|USD\s?)?"
    r"(?:(?<![\w.])(?P<sign>[-+−]))?"
    r"(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?:\s?(?P<unit>%|(?i:x|bps|lakh\s+crores?|lakh\s+cr|trillion|billion|million|thousand|crores?|cr|lakhs?|lac|tn|bn|mn|mm)(?![a-z])|[KMBTL](?![a-zA-Z])))?"
)
# Whole month names only: "[a-z]*" after "mar" swallowed "margin 66" as a date.
_MONTH = (r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
          r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\b")
_SKIP_SPANS = (
    re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?"),
    re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"),
    re.compile(rf"\b(?:\d{{1,2}}\s+)?{_MONTH}\s+\d{{1,2}}\b(?:,?\s+\d{{4}})?", re.I),
    re.compile(rf"\b\d{{1,2}}\s+{_MONTH}(?:\s+\d{{4}})?", re.I),
    re.compile(r"\b(?:nifty|s&p|sensex|russell|nasdaq|ftse|dax|cac|nikkei|bse|nse)[\s-]?(?:next\s+)?\d+\b", re.I),
    re.compile(r"https?://\S+"),
    re.compile(r"(?i:\b(?:rsi|ema|sma|dma|wma|atr|roc|macd|adx|cci|stoch|bb|bollinger|supertrend)\s*\(\s*\d+(?:\s*,\s*\d+)*\s*\))"),
    re.compile(r"(?i:conviction)\s*:?\s*\d{1,3}"),  # the PM's own score is an opinion, not data
    # Oscillator thresholds are conventions, not data: "below the 70 overbought line", "oversold (< 30)".
    re.compile(r"(?i:\b(?:70|80|30|20)\b(?=[^.\n]{0,25}\b(?:overbought|oversold|threshold|line|mark)\b))"),
    re.compile(r"(?i:(?:overbought|oversold)[^.\n\d]{0,40}\b(?:70|80|30|20)\b)"),
    re.compile(r"(?i:\brsi\s*(?:[<>≥≤]=?|above|below|over|under)\s*(?:70|80|30|20)\b)"),
)
_PERIOD_AFTER = re.compile(
    r"[\s-]?(?:days?|weeks?|months?|years?|yrs?|y|d|w|dma|sma|ema|periods?|sessions?|bars?|quarters?|windows?|wk|"
    r"mins?|minutes?|hours?|hrs?|h|secs?|seconds?)\b", re.I)
_INDICATOR = r"(?:rsi|ema|sma|dma|wma|ma|roc|atr|adx|cci|macd|rvol|bb)"
# A bare small integer right before a value is a period label: "EMA 9 232.37", "21: 227.28", "RSI 14 at 68".
_LABEL_AFTER = re.compile(r"\s*(?::\s*|\s+(?:at\s+|of\s+|is\s+)?|\s*\*\*)[-+]?[$₹€£]?\*{0,2}\d")
_LABEL_BEFORE = re.compile(rf"(?i:\b({_INDICATOR})[\s-]?(\d{{1,3}}))\s*(?::|at|of|is)?\s*\**\s*$")
_LIST_LABEL_BEFORE = re.compile(r"(?:^|[,;(]|\s)(\d{1,3})\s*(?::|\*\*)?\s*\**\s*$")
_FAMILY_RE = re.compile(rf"(?i:\b{_INDICATOR}\b)")
_APPROX_BEFORE = re.compile(
    r"(?:~|≈|about|around|roughly|approximately|approx\.?|nearly|almost|over|under|above|below|more than|less than|close to)\s*$",
    re.I)
# Level metrics: a "%" figure beside them is a distance from the level, not the level itself.
_DISTANCE_AFTER = re.compile(r"\s*(?:above|below|higher|lower|over|under|ahead|behind|off|beneath|short)\b", re.I)
_LEVEL_METRICS = {"price", "prev_close", "open", "day_high", "day_low", "high_52w", "low_52w", "ema_50", "ema_200", "market_cap"}
# Forward-looking words: the figure is an opinion/projection, so a live value can't contradict it.
_FORWARD = re.compile(
    r"\b(?:target|forecast|estimate[sd]?|expect(?:ed|s)?|projected?|could|would|may|might|fair value|"
    r"stop(?:-loss)?|support|resistance|entry|exit|upside|downside|if)\b", re.I)
_CODE_SPAN = re.compile(r"`[^`\n]+`")
_LINK_SPAN = re.compile(r"\[[^\]\n]*\]\([^)\n]*\)")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}")
# A period before closing markup still ends the sentence: "both above.** AAPL at 333.04".
_SENTENCE_BREAK = re.compile(r"[.!?](?=[*_)\]\"'”’]*\s)|\n|;|\|")


_KEY_BEFORE = re.compile(r"""(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\s*[:=]\s*["']?$""")


def _key_hint(text: str, start: int, in_code: bool) -> str | None:
    """Field name for code-style figures (`"sharpe": 0.45`, `short_window=20`) and for indicator
    readings labelled by period ("EMA 21: 227.28", "…, 50 **221.02**" → ema_50). Prose like
    "avg score: 80.2" is a label, not a field name."""
    before = text[max(0, start - 40):start]
    lab = _LABEL_BEFORE.search(before)
    if lab:
        family = lab.group(1).lower()
        return f"{'ema' if family in ('ema', 'sma', 'dma', 'wma', 'ma') else family}_{lab.group(2)}"
    lst = _LIST_LABEL_BEFORE.search(before)
    if lst:
        line_start = text.rfind("\n", 0, start) + 1
        families = _FAMILY_RE.findall(text[line_start:start])
        if families:
            family = families[-1].lower()
            return f"{'ema' if family in ('ema', 'sma', 'dma', 'wma', 'ma') else family}_{lst.group(1)}"
    m = _KEY_BEFORE.search(before)
    if not m:
        return None
    if in_code or m.group(1) or "_" in m.group(2):
        return m.group(2).lower()
    return None


@dataclass
class Figure:
    start: int
    end: int
    text: str
    value: float
    decimals: int
    unit: str | None
    signed: bool
    approx: bool
    in_code: bool
    key: str | None = None
    currency: bool = False  # field name when the figure is written as `"key": value` / key=value


@dataclass
class Leaf:
    source_id: str
    path: str
    value: float
    metric: str | None
    subject: str | None
    kind: str  # value | parameter | text


@dataclass
class Source:
    id: str
    tool: str
    call_id: str | None
    args: dict[str, Any]
    provider: str
    quality: str
    as_of: str | None
    note: str | None
    leaves: list[Leaf] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id, "tool": self.tool, "call_id": self.call_id,
            "args": _compact_args(self.args), "provider": self.provider,
            "quality": self.quality, "as_of": self.as_of, "note": self.note,
        }


def _compact_args(args: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in (args or {}).items():
        if isinstance(value, (list, tuple)) and len(value) > 8:
            out[key] = f"[{len(value)} items]"
        elif isinstance(value, str) and len(value) > 120:
            out[key] = value[:117] + "..."
        elif isinstance(value, (dict, list)) and len(json.dumps(value, default=str)) > 160:
            out[key] = "{…}"
        else:
            out[key] = value
    return out


def _spans(text: str, patterns: Iterable[re.Pattern[str]]) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for p in patterns for m in p.finditer(text)]


def _inside(pos: int, spans: list[tuple[int, int]]) -> bool:
    return any(a <= pos < b for a, b in spans)


def extract_figures(text: str) -> list[Figure]:
    """Pull every data-like number out of ``text``, skipping dates, years, list numbering,
    index names (Nifty 50), indicator periods (50-day, RSI14) and trivial counts (≤10)."""
    if not text:
        return []
    skip = _spans(text, _SKIP_SPANS)
    code = _spans(text, (_CODE_SPAN,))
    links = _spans(text, (_LINK_SPAN,))
    figures: list[Figure] = []
    for m in _NUM_RE.finditer(text):
        start, end = m.start(), m.end()
        num_start = m.start("num")
        if _inside(num_start, skip):
            continue
        before = text[start - 1] if start > 0 else ""
        after = text[end] if end < len(text) else ""
        if before.isalpha() or before == "_" or before.isdigit():
            continue  # EMA50, Q2, FY26
        ordinal = re.match(r"(?:st|nd|rd|th)\b", text[end:end + 3])
        if ordinal and ("." in m.group("num") or float(m.group("num").replace(",", "")) > 10):
            end += 2  # "86.5th percentile" is a figure; keep its suffix so the marker follows the word
            after = text[end] if end < len(text) else ""
        if after.isalpha() or after == "_":
            continue  # 50DMA, 3rd, 1y
        raw = m.group("num")
        unit = (m.group("unit") or "").strip() or None
        unit_key = re.sub(r"\s+", " ", unit.lower()) if unit else None
        if unit_key is not None and unit_key not in _UNIT_MULT and unit_key not in {"%", "x", "bps"}:
            continue
        line_start = text.rfind("\n", 0, start) + 1
        if re.fullmatch(r"\s*", text[line_start:start]) and re.match(r"[.)]\s", text[end:end + 2]):
            continue  # "1. " list numbering
        decimals = len(raw.split(".", 1)[1]) if "." in raw else 0
        value = float(raw.replace(",", ""))
        has_cur = bool(m.group("cur"))
        if unit_key in ("k", "m", "b", "t", "l") and not has_cur and decimals == 0 and value <= 10:
            continue  # "3B / 1B / 2N" are counts, not $3 billion
        if not unit and not has_cur and decimals == 0 and "," not in raw:
            if value <= 10 or (1900 <= value <= 2100):
                continue  # counts and years
            if value <= 250 and _LABEL_AFTER.match(text, end):
                continue  # period label of the value that follows ("21: 227.28")
            if _PERIOD_AFTER.match(text, end):
                continue  # 50-day, 200 DMA, 14 periods
        sign = m.group("sign")
        signed = bool(sign)
        if sign in ("-", "−"):
            value = -value
        approx = bool(_APPROX_BEFORE.search(text[max(0, start - 20):start]))
        figures.append(Figure(
            start=start, end=end, text=text[start:end], value=value, decimals=decimals,
            unit=unit_key, signed=signed, approx=approx,
            in_code=_inside(start, code) or _inside(start, links),
            key=_key_hint(text, start, _inside(start, code) or _inside(start, links)),
            currency=has_cur,
        ))
    return figures


# --- sources -------------------------------------------------------------------------
def _metric_for(key: str, parent: str | None) -> str | None:
    k = key.lower()
    if parent:
        combined = f"{parent.lower()}_{k}"
        if combined in _KEY_TO_METRIC:
            return _KEY_TO_METRIC[combined]
    return _KEY_TO_METRIC.get(k)


def _subject_of(node: dict[str, Any], inherited: str | None) -> str | None:
    for key in ("ticker", "symbol"):
        value = node.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().upper()
    return inherited


# Lists of instruments/levels/bars inside a result: their "price"/"ltp"/"close" fields are an order-book
# level, an option strike's premium or a past bar, not the stock's price, so they get no stock-level metric.
_UNLABELLED_CONTAINERS = re.compile(
    r"(?:^|\.)(?:bids|asks|depth|levels|strikes|chain|ce|pe|calls|puts|equity_curve|curve|bars|candles|history|"
    r"windows|headlines|articles|items|events|trades|deals)(?:\[\d+\])?\.")  # a container segment, not the leaf key


def _walk(value: Any, path: str, key: str | None, parent: str | None, subject: str | None,
          sink: list[Leaf], source_id: str, kind: str) -> None:
    if len(sink) >= _MAX_LEAVES_PER_SOURCE:
        return
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, (int, float)):
        f = float(value)
        if math.isfinite(f):
            metric = _metric_for(key, parent) if key and not _UNLABELLED_CONTAINERS.search(path) else None
            sink.append(Leaf(source_id, path, f, metric, subject, kind))
        return
    if isinstance(value, str):
        stripped = value.strip()
        try:  # numeric strings ("23.4") are values; prose is scanned for figures
            f = float(stripped.replace(",", ""))
            if math.isfinite(f) and re.fullmatch(r"[-+]?[\d,]*\.?\d+", stripped):
                sink.append(Leaf(source_id, path, f, _metric_for(key, parent) if key else None, subject, kind))
                return
        except ValueError:
            pass
        if len(stripped) >= 4 and any(ch.isdigit() for ch in stripped):
            for fig in extract_figures(stripped[:4000]):
                scaled = fig.value * _UNIT_MULT.get(fig.unit or "", 1.0)
                sink.append(Leaf(source_id, path, scaled, None, subject, "text"))
        return
    if isinstance(value, dict):
        subj = _subject_of(value, subject)
        for k, v in value.items():
            if str(k).startswith("_"):
                continue
            _walk(v, f"{path}.{k}" if path else str(k), str(k), key, subj, sink, source_id, kind)
        return
    if isinstance(value, (list, tuple)):
        items = list(enumerate(value))
        if len(items) > _MAX_LIST_ITEMS:
            items = items[:3] + items[-3:]
        for i, v in items:
            _walk(v, f"{path}[{i}]", key, parent, subject, sink, source_id, kind)


def _rows_provenance(rows: Any) -> dict[str, Any] | None:
    if not isinstance(rows, list):
        return None
    provs = [r.get("provenance") for r in rows if isinstance(r, dict) and isinstance(r.get("provenance"), dict)]
    if not provs:
        return None
    sources = sorted({str(p.get("source")) for p in provs})
    qualities = [str(p.get("quality")) for p in provs]
    worst = next((q for q in ("synthetic", "unavailable", "cached", "delayed", "live") if q in qualities), qualities[0])
    return {"source": ", ".join(sources), "quality": worst, "as_of": provs[0].get("as_of"), "note": None}


def _provenance(tool: str, result: Any) -> tuple[dict[str, Any], Any]:
    if isinstance(result, dict) and "ok" in result and ("data" in result or "error" in result):
        prov = result.get("provenance") if isinstance(result.get("provenance"), dict) else None
        data = result.get("data")
    else:
        prov = result.get("provenance") if isinstance(result, dict) and isinstance(result.get("provenance"), dict) else None
        if prov is None and isinstance(result, dict):
            prov = _rows_provenance(result.get("rows"))
        data = result
    if prov:
        return prov, data
    provider, quality = _DEFAULT_PROVENANCE.get(tool, (tool, "unreported"))
    note = None if tool in _DEFAULT_PROVENANCE else "tool did not report its data provider"
    return {"source": provider, "quality": quality, "as_of": None, "note": note}, data


_MAX_TEXTS_PER_SOURCE = 400


def _collect_texts(value: Any, path: str, source_id: str, sink: list[tuple[str, str, str]]) -> None:
    if sum(1 for t in sink if t[0] == source_id) >= _MAX_TEXTS_PER_SOURCE:
        return
    if isinstance(value, str):
        if len(value.strip()) >= 20:
            sink.append((source_id, path, value[:4000]))
    elif isinstance(value, dict):
        for k, v in value.items():
            _collect_texts(v, f"{path}.{k}" if path else str(k), source_id, sink)
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value[:_MAX_LIST_ITEMS]):
            _collect_texts(v, f"{path}[{i}]", source_id, sink)


class GroundingLedger:
    """Every piece of evidence the run has seen, numbered in arrival order."""

    def __init__(self, prompt: str | None = None) -> None:
        self.sources: list[Source] = []
        self._calls: dict[str, dict[str, Any]] = {}
        # (source_id, path, text) for prose fields (headlines, filing quotes) — quotes are checked against these.
        self.texts: list[tuple[str, str, str]] = []
        if prompt:
            src = Source("S0", "your_request", None, {}, "your request", "user", None, None)
            _walk(prompt, "prompt", None, None, None, src.leaves, src.id, "parameter")
            self.sources.append(src)

    def _new_id(self) -> str:
        return f"S{sum(1 for s in self.sources if s.id != 'S0') + 1}"

    def add(self, tool: str, result: Any, *, args: dict[str, Any] | None = None, call_id: str | None = None,
            provenance: dict[str, Any] | None = None) -> Source:
        prov, data = _provenance(tool, result)
        prov = provenance or prov
        src = Source(
            id=self._new_id(), tool=tool, call_id=call_id, args=dict(args or {}),
            provider=str(prov.get("source") or tool), quality=str(prov.get("quality") or "unreported"),
            as_of=prov.get("as_of"), note=prov.get("note"),
        )
        subject = None
        for key in ("ticker", "symbol"):
            if isinstance(src.args.get(key), str) and src.args[key].strip():
                subject = src.args[key].strip().upper()
        _walk(data, "", None, None, subject, src.leaves, src.id, "value")
        _collect_texts(data, "", src.id, self.texts)
        for key, value in src.args.items():
            _walk(value, f"args.{key}", str(key), None, subject, src.leaves, src.id, "parameter")
        self.sources.append(src)
        return src

    def observe(self, event: dict[str, Any]) -> None:
        etype = event.get("type")
        if etype == "tool_call":
            self._calls[str(event.get("id"))] = event.get("arguments") or {}
        elif etype == "tool_result" and not event.get("is_error"):
            result = event.get("result")
            if isinstance(result, dict) and result.get("ok") is False:
                return
            call_id = str(event.get("id"))
            self.add(str(event.get("name")), result, args=self._calls.get(call_id), call_id=call_id)
        elif etype == "artifact" and event.get("name") not in ARTIFACT_KINDS:
            # Artifacts that aren't a re-render of a tool result carry figures computed by the
            # orchestrator itself (e.g. the ensemble's consensus scores).
            data = event.get("data")
            self.add(f"computed:{event.get('kind')}", data,
                     provenance={"source": f"computed by the agent ({event.get('name')})", "quality": "computed",
                                 "as_of": data.get("as_of") if isinstance(data, dict) else None, "note": None})

    @property
    def leaves(self) -> list[Leaf]:
        return [leaf for s in self.sources for leaf in s.leaves]

    def source(self, source_id: str) -> Source | None:
        return next((s for s in self.sources if s.id == source_id), None)


# --- matching ------------------------------------------------------------------------
def _targets(fig: Figure, loose: bool) -> list[tuple[float, float, float]]:
    """(target, allowed below, allowed above). A shown figure may be the source value rounded
    (±half a unit of the last digit) or truncated (up to one unit below it)."""
    base = fig.value if fig.signed else abs(fig.value)
    unit = 10.0 ** -fig.decimals
    out = [(base, 0.5 * unit, unit)]
    mult = _UNIT_MULT.get(fig.unit or "")
    if mult:
        out.append((base * mult, 0.5 * unit * mult, unit * mult))
    if loose and fig.approx:  # "roughly 4,000" — only trusted when the metric is named too
        out = [(t, max(lo, 0.03 * abs(t)), max(hi, 0.03 * abs(t))) for t, lo, hi in out]
    return out


def _value_matches(fig: Figure, value: float, *, loose: bool = False, fraction_ok: bool = False) -> bool:
    candidates = [value]
    if fig.unit == "%" and fraction_ok:
        candidates.append(value * 100)  # stored as a fraction
    elif fig.unit == "bps":
        candidates += [value * 100, value * 10000]
    for target, below, above in _targets(fig, loose):
        eps = 1e-9 * max(1.0, abs(target))
        for v in candidates:
            v = v if fig.signed else abs(v)
            # Truncation only ever drops digits, so the source may exceed the shown figure by a
            # full unit (in magnitude) but fall short of it by at most half a unit.
            diff = (v - target) if target >= 0 else (target - v)
            if -below - eps <= diff < above + eps:
                return True
    return False


def _leaf_matches(fig: Figure, leaf: Leaf, *, loose: bool = False) -> bool:
    return _value_matches(fig, leaf.value, loose=loose, fraction_ok=leaf.metric in _FRACTION_METRICS)


def _line_bounds(text: str, pos: int) -> tuple[int, int]:
    start = text.rfind("\n", 0, pos) + 1
    end = text.find("\n", pos)
    return start, (len(text) if end < 0 else end)


def _table_context(text: str, pos: int) -> tuple[str, str] | None:
    """For a figure inside a markdown table row: (column header cell, row's first cell)."""
    ls, le = _line_bounds(text, pos)
    line = text[ls:le]
    if not line.lstrip().startswith("|"):
        return None
    col = line[: pos - ls].count("|") - (1 if line.lstrip().startswith("|") else 0)
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    first = cells[0] if cells else ""
    # Walk up through the table block to the separator; the header sits just above it.
    lines = text[:ls].split("\n")[:-1]
    for i in range(len(lines) - 1, -1, -1):
        if not lines[i].lstrip().startswith("|"):
            break
        if _TABLE_SEP.match(lines[i]) and i > 0:
            header = [c.strip() for c in lines[i - 1].strip().strip("|").split("|")]
            return (header[col] if 0 <= col < len(header) else ""), first
    return "", first


def _phrase_metric(snippet: str, prefer_end: bool) -> str | None:
    best: tuple[int, int, str] | None = None
    for m in _PHRASE_RE.finditer(snippet):
        metric = _PHRASE_METRIC[int(m.lastgroup[1:])]  # type: ignore[index]
        rank = (m.end() if prefer_end else -m.start(), m.end() - m.start())
        if best is None or rank > best[:2]:
            best = (rank[0], rank[1], metric)
    return best[2] if best else None


def _sentence_start(text: str, pos: int, floor: int = 0) -> int:
    start = floor
    for m in _SENTENCE_BREAK.finditer(text, floor, pos):
        start = m.end()
    return start


def _context(text: str, fig: Figure, prev_end: int) -> tuple[str | None, str, str]:
    """(metric named next to the figure, the line used to spot tickers, the text of the
    sentence up to the figure — the nearest ticker in it is the figure's subject)."""
    table = _table_context(text, fig.start)
    if table is not None:
        header, first = table
        cells = f"{header} {first}"
        return _phrase_metric(header, True) or _phrase_metric(first, True), cells, cells
    window_start = _sentence_start(text, fig.start, max(prev_end, fig.start - 70))
    before = text[window_start:fig.start]
    if prev_end and window_start == prev_end:
        # "96.3% of the 52-week range, just 1.2% below": the phrase right after a figure is that figure's.
        lead = _PHRASE_RE.match(before, len(before) - len(before.lstrip()))
        if lead:
            before = before[lead.end():]
    metric = _phrase_metric(before, True)
    if metric is not None and _FORWARD.search(before):
        metric = None
    if metric is not None:
        last = max((m.end() for m in _PHRASE_RE.finditer(before)), default=len(before))
        if len(before) - last > 25:  # named far back; a name right after the figure is closer
            metric = _after_metric(text, fig, adjacent=True) or metric
    ls, le = _line_bounds(text, fig.start)
    return metric, text[ls:le], text[_sentence_start(text, fig.start, max(0, fig.start - 300)):fig.start]


_MARGIN_AFTER = {"net": "net_margin", "operating": "op_margin", "op": "op_margin"}


def _after_metric(text: str, fig: Figure, *, adjacent: bool = False) -> str | None:
    """A metric named right after the figure ("18% ROE", "63.7% net") — a few characters, no comma.
    ``adjacent`` limits it to a name that directly follows the figure."""
    if fig.unit == "%":
        word = re.match(r"\s*([a-z]+)\b", text[fig.end:fig.end + 12], re.I)
        if word and word.group(1).lower() in _MARGIN_AFTER:
            return _MARGIN_AFTER[word.group(1).lower()]
    tail = text[fig.end:fig.end + (8 if adjacent else 14)]
    cut = re.search(r"[,;.:|()\n]", tail)
    return _phrase_metric(tail[: cut.start()] if cut else tail, False)


def _mentioned(subjects: set[str], clause: str) -> set[str]:
    found = set()
    for subj in subjects:
        base = subj.split(".")[0]
        if base and re.search(rf"(?<![A-Za-z0-9]){re.escape(base)}(?![A-Za-z0-9])", clause):
            found.add(subj)
    return found


def _nearest_subject(subjects: set[str], before: str) -> str | None:
    best: tuple[int, str] | None = None
    for subj in subjects:
        base = subj.split(".")[0]
        for m in re.finditer(rf"(?<![A-Za-z0-9]){re.escape(base)}(?![A-Za-z0-9])", before):
            if best is None or m.start() > best[0]:
                best = (m.start(), subj)
    return best[1] if best else None


def _last_key(path: str) -> str:
    return re.sub(r"\[\d+\]$", "", path).rsplit(".", 1)[-1].lower()


def _fmt(value: float, decimals: int) -> str:
    if abs(value) >= 1e5 and float(value).is_integer():
        return f"{value:,.0f}"
    return f"{value:,.{min(max(decimals + 1, 2), 6)}f}".rstrip("0").rstrip(".")


# Roles whose messages propose inputs (the next backtest's parameters) rather than state facts:
# their figures can be confirmed by a source but never contradict one.
PROPOSAL_ROLES = {"strategy_researcher"}


def ground_text(text: str, ledger: GroundingLedger, *, contradict: bool = True, run_wide: bool = True) -> dict[str, Any]:
    """Check every figure in ``text`` against the ledger; return claims, sources and an
    annotated copy of the text with a ``⟦status:source⟧`` marker after each figure."""
    figures = extract_figures(text)
    leaves = ledger.leaves
    subjects = {leaf.subject for leaf in leaves if leaf.subject}
    claims: list[dict[str, Any]] = []
    chosen_leaves: list[Leaf | None] = []
    prev_end = 0
    carried: str | None = None  # metric of the previous figure, while still in the same sentence
    for fig in figures:
        same_sentence = not _SENTENCE_BREAK.search(text, prev_end, fig.start) if prev_end else False
        metric, clause, sentence = _context(text, fig, prev_end)
        prev_end = fig.end
        if metric in _LEVEL_METRICS and _DISTANCE_AFTER.match(text, fig.end):
            metric = None  # "~$8.74 above (the EMA)": a distance the model worked out, not the level
        if fig.unit in ("%", "bps") and metric in _LEVEL_METRICS:
            # "4.0% below the 52-week high" is the distance from the level, not the level.
            metric = {"high_52w": "pct_below_52w_high", "low_52w": "pct_above_52w_low"}.get(metric)
        elif fig.currency and metric in ("range_position",):
            metric = None  # "96.3% of its 52-week range between the $164.27 low" — the $ figure is a level
        elif fig.unit not in ("%", "bps") and metric in ("pct_below_52w_high", "pct_above_52w_low"):
            # "below the high of $345.34" is the level; a bare number there could be anything.
            metric = ("high_52w" if metric == "pct_below_52w_high" else "low_52w") if fig.currency else None
        if metric is None:  # named right after the figure: "~4% off its high", "18% ROE"
            metric = _after_metric(text, fig)
            if fig.unit in ("%", "bps") and metric in _LEVEL_METRICS:
                metric = {"high_52w": "pct_below_52w_high", "low_52w": "pct_above_52w_low"}.get(metric)
        inherited = metric is None and same_sentence and carried is not None
        if inherited:
            metric = carried  # "ROE 48.68% vs. MSFT's 34.04%"
        carried = metric

        # Narrowest pool first: the ticker named nearest the figure, then any ticker on its line.
        nearest = _nearest_subject(subjects, sentence)
        mentioned = _mentioned(subjects, clause)
        pools = [p for p in (
            [leaf for leaf in leaves if nearest and leaf.subject == nearest],
            [leaf for leaf in leaves if leaf.subject in mentioned],
            leaves,
        ) if p]

        status, chosen, expected = "unsourced", None, None

        def decide(candidates_for: Any, may_mismatch: bool, loose: bool) -> bool:
            nonlocal status, chosen, expected
            for pool in pools:
                labelled = candidates_for(pool)
                if not labelled:
                    continue
                hit = [leaf for leaf in labelled if _leaf_matches(fig, leaf, loose=loose)]
                if hit:
                    status, chosen = "verified", hit[0]
                    return True
                if may_mismatch and contradict:
                    status = "mismatch"
                    chosen = min(labelled, key=lambda leaf: abs(abs(leaf.value) - abs(fig.value)))
                    expected = chosen.value
                    return True
                return False
            return False

        if fig.key:
            # `"total_return_pct": 21.88` names its own field: compare against that field only.
            if decide(lambda pool: [leaf for leaf in pool if _last_key(leaf.path) == fig.key], True, False):
                metric = _KEY_TO_METRIC.get(fig.key, metric)
        if status == "unsourced" and chosen is None and metric:
            # An inherited metric is a guess, so it may confirm a figure but never contradict one.
            decide(lambda pool: [leaf for leaf in pool if leaf.metric == metric], not inherited, True)
            related = _RELATED.get(metric, set())
            if status == "mismatch" and related:
                held = (status, chosen, expected)
                status, chosen, expected = "unsourced", None, None
                if decide(lambda pool: [leaf for leaf in pool if leaf.metric in related], False, False):
                    relabelled = chosen.metric  # e.g. "P/E 15.2" that is the forward P/E
                else:
                    status, chosen, expected = held
                    relabelled = None
            else:
                relabelled = None
        else:
            relabelled = None
        # "~50% step-up" with no metric named is the model's estimate; matching it by value alone
        # would pin it to whichever field happens to be near 50.
        if status == "unsourced" and not (fig.approx and fig.decimals == 0 and (metric is None or inherited)):
            for pool in pools:
                numeric = [leaf for leaf in pool if _leaf_matches(fig, leaf)]
                if numeric:
                    # Prefer real data over echoes of the request, then a labelled field, then the latest source.
                    numeric.sort(key=lambda leaf: (leaf.kind == "value", leaf.metric is not None,
                                                   int(leaf.source_id[1:] or 0)), reverse=True)
                    status, chosen = "verified", numeric[0]
                    break
        chosen_leaves.append(chosen)
        src = ledger.source(chosen.source_id) if chosen else None
        claim: dict[str, Any] = {
            "text": fig.text.strip(), "value": fig.value, "start": fig.start, "end": fig.end,
            "metric": metric, "status": status, "approx": fig.approx, "in_code": fig.in_code,
            "source_id": chosen.source_id if chosen else None,
            "path": chosen.path if chosen else None,
            "source_value": chosen.value if chosen else None,
            "subject": chosen.subject if chosen else None,
        }
        if expected is not None:
            claim["expected"] = _fmt(expected, fig.decimals)
        if status == "verified" and src is not None and src.quality in _LOW_QUALITY:
            claim["warning"] = f"source quality is {src.quality}"
        if status == "verified" and chosen is not None and chosen.kind == "parameter":
            claim["warning"] = "echoes a request parameter, not market data"
        if status == "verified" and relabelled:
            claim["warning"] = f"labelled {metric} but the value is {relabelled}"
        claims.append(claim)

    # v2: do the sources agree with each other and are they fresh; are the statements true.
    from backend.agent.reconcile import reconcile

    checks = reconcile(ledger)
    conflicts, stale = checks["conflicts"], checks["stale"]
    disagreeing = {(c["subject"], c["metric"]): c for c in conflicts}
    stale_ids = {s["source_id"]: s for s in stale}
    for claim, leaf in zip(claims, chosen_leaves):
        if claim["status"] != "verified" or leaf is None:
            continue
        conflict = disagreeing.get((leaf.subject, leaf.metric))
        if conflict:
            others = ", ".join(f"{v['source_id']} {_fmt(v['value'], 1)}" for v in conflict["values"])
            claim["warning"] = f"sources disagree: {others}"
        elif leaf.source_id in stale_ids and not claim.get("warning"):
            claim["warning"] = f"source is stale ({stale_ids[leaf.source_id]['age_hours']:g}h old)"
    if not run_wide:
        # A debate/persona note lists only the conflicts and stale sources its own figures rely on;
        # the final answer carries the run-wide list, so each card doesn't repeat it.
        used_keys = {(leaf.subject, leaf.metric) for leaf in chosen_leaves if leaf is not None}
        used_ids = {leaf.source_id for leaf in chosen_leaves if leaf is not None}
        conflicts = [c for c in conflicts if (c["subject"], c["metric"]) in used_keys]
        stale = [s for s in stale if s["source_id"] in used_ids]
    try:
        from backend.agent.claim_checks import check_statements

        statements = check_statements(text, ledger, ledger.texts)
    except Exception:  # noqa: BLE001 - a statement check must never cost the figure check
        statements = []

    used = {c["source_id"] for c in claims if c["source_id"]}
    counts = {k: sum(1 for c in claims if c["status"] == k) for k in ("verified", "mismatch", "unsourced")}
    return {
        "claims": claims,
        "sources": [s.summary() for s in ledger.sources if s.id in used or s.id != "S0"],
        "summary": {
            "total": len(claims), **counts,
            "low_quality": sum(1 for c in claims if c.get("warning", "").startswith(("source quality", "source is stale"))),
            "conflicts": len(conflicts),
            "stale": len(stale),
            "statements_checked": len(statements),
            "statements_contradicted": sum(1 for st in statements if st.get("status") == "contradicted"),
        },
        "annotated": annotate(text, claims),
        "conflicts": conflicts,
        "stale": stale,
        "statements": statements,
    }


def annotate(text: str, claims: list[dict[str, Any]]) -> str:
    out, last = [], 0
    for c in sorted(claims, key=lambda c: c["start"]):
        if c["in_code"]:
            continue
        if c["status"] == "verified":
            marker = f"⟦{'w' if c.get('warning') else 'v'}:{c['source_id']}⟧"
        elif c["status"] == "mismatch":
            marker = f"⟦x:{c['source_id']}:{c.get('expected', '')}⟧"
        else:
            marker = "⟦u⟧"
        out.append(text[last:c["end"]])
        out.append(marker)
        last = c["end"]
    out.append(text[last:])
    return "".join(out)


def grounding_event(target: str, report: dict[str, Any], role_index: int | None = None) -> dict[str, Any]:
    event = {"type": "grounding", "target": target, **report}
    if role_index is not None:
        event["role_index"] = role_index
    return event


Repairer = Callable[[str, dict[str, Any], "GroundingLedger"], Awaitable[tuple[str, dict[str, Any], dict[str, Any]]]]


async def ground_stream(
    stream: AsyncIterator[dict[str, Any]], *, prompt: str | None = None, repair: Repairer | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Pass every event through, adding a grounding event after each role_message and just
    before each final (so ``final`` stays the last event of the stream). With ``repair``, a final
    answer whose figures or statements contradict their sources gets one corrective revision."""
    ledger = GroundingLedger(prompt)
    role_index = 0
    async for event in stream:
        ledger.observe(event)
        etype = event.get("type")
        report: dict[str, Any] | None = None
        try:
            if etype in ("role_message", "final"):
                report = ground_text(str(event.get("content") or ""), ledger,
                                     contradict=event.get("role") not in PROPOSAL_ROLES,
                                     run_wide=etype == "final")
        except Exception:  # noqa: BLE001 - verification must never break the answer stream
            report = None
        if etype == "final" and report is not None and repair is not None:
            summary = report["summary"]
            issues = summary.get("mismatch", 0) + summary.get("statements_contradicted", 0)
            if issues:
                yield {"type": "status", "text": f"Correcting {issues} item(s) that contradict the sources…"}
                try:
                    content, report, info = await repair(str(event.get("content") or ""), report, ledger)
                    report["repair"] = info
                    event = {**event, "content": content}
                except Exception:  # noqa: BLE001
                    pass
        if etype == "final" and report is not None:
            yield grounding_event("final", report)
        yield event
        if etype == "role_message":
            if report is not None:
                yield grounding_event("role", report, role_index)
            role_index += 1
