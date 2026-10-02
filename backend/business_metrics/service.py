from __future__ import annotations

import asyncio
import re
from typing import Any

from sqlalchemy.orm import Session

from backend.business_metrics.models import BusinessMetricORM
from backend.filings_rag import llm
from backend.filings_rag import retrieve

# OWNER: agent D. Cross-agent surface: use filings_rag.retrieve.search and
# filings_rag.llm.* ONLY through their contract signatures (see CONTRACT.md).

# Retrieval query bank. Each query is a semantic hook that surfaces the parts of
# the filings most likely to contain the category of point we want.
RETRIEVAL_QUERIES: tuple[str, ...] = (
    "order book backlog order inflow orders held",
    "installed capacity utilisation plants megawatt tonnes production volume",
    "number of customers top ten clients active clients client concentration",
    "number of stores branches assets under management subscribers sold units",
    "segment revenue product mix geography revenue domestic export",
    "market share segment share percentage competition",
)

# Category taxonomy mirrored in the BusinessMetrics TS response.
CATEGORY_ORDER_BOOK = "order_book"
CATEGORY_CAPACITY = "capacity"
CATEGORY_OPERATIONAL = "operational"
CATEGORY_CUSTOMERS = "customers"
CATEGORY_FINANCIAL = "financial"

_MIX_BASES = ("revenue", "turnover", "gross", "net", "sales", "income", "business", "topline")
_GEO_WORDS = ("domestic", "export", "international", "overseas", "home market", "foreign", "import")


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _clean_number_str(s: str) -> str:
    return s.replace(",", "").replace(" ", "")


def _to_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _extract_amount(text: str) -> float | None:
    m = re.search(r"([+-]?\d[\d,]*(?:\.\d+)?)", text)
    if not m:
        return None
    try:
        return float(_clean_number_str(m.group(1)))
    except ValueError:
        return None


_QUOTE_NUMBER_RE = re.compile(r"(?<![\d.])\d[\d,]*(?:\.\d+)?")


def _check_numeric_in_quote(value: Any, quote: str) -> float | None:
    """Return `value` only when it appears in `quote` as a whole number (commas ignored).

    A substring test would accept 12 for a quote saying "1,234"; compare parsed numbers instead.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        target = float(_clean_number_str(str(value)))
    except ValueError:
        return None
    for token in _QUOTE_NUMBER_RE.findall(quote or ""):
        try:
            if abs(float(token.replace(",", "")) - target) <= 1e-9 * max(1.0, abs(target)):
                return target
        except ValueError:
            continue
    return None


_PERIOD_RE = re.compile(
    r"(?:FY)?\s*(?:(20)?(\d{2}))?\s*[-–—]\s*(?:20)?(\d{2})\b",
)


def _normalise_period(period: str | None) -> str | None:
    """Map a raw period string to FY24 / Q1FY25 / 2024 / Q2 2025 style labels."""
    if not period:
        return None
    s = period.strip()
    up = s.upper()

    m_quarter = re.match(r"^Q([1-4])", up)
    quarter = int(m_quarter.group(1)) if m_quarter else None

    # A range such as 2023-24 / FY23-24 / 2023–24 : use the ending year.
    m_range = re.search(r"(?:20)?(\d{2})\s*[-–—]\s*(?:20)?(\d{2})\b", up)
    # A fiscal-year token such as FY24 / FY2024 / FY 24.
    m_fy = re.search(r"FY\s*(?:20)?(\d{2})\b", up)
    # A standalone 4-digit calendar year.
    m_year = re.search(r"\b(20\d{2})\b", up)

    range_end = m_range.group(2) if m_range else None
    fy = m_fy.group(1) if m_fy else range_end
    year = m_year.group(1) if m_year else None

    if quarter is not None:
        if fy:
            return f"Q{quarter}FY{fy}"
        if year:
            return f"Q{quarter} {year}"
        return f"Q{quarter}"

    if fy:
        return f"FY{fy}"
    if year:
        return year
    return s


_MONTHS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}


def _period_sort_key(period: str | None) -> tuple[int, int]:
    """(year, month) of the period end so FY / quarter / calendar labels sort together."""
    if not period:
        return (-1, -1)
    up = period.upper().strip()
    m_q = re.match(r"^Q([1-4])\s*FY\s*(?:20)?(\d{2})$", up)
    if m_q:  # Indian FY: Q1 ends Jun of the prior calendar year, Q4 ends Mar of the FY year
        fy_year, q = 2000 + int(m_q.group(2)), int(m_q.group(1))
        return {1: (fy_year - 1, 6), 2: (fy_year - 1, 9), 3: (fy_year - 1, 12), 4: (fy_year, 3)}[q]
    m_f = re.match(r"^FY\s*(?:20)?(\d{2})$", up)
    if m_f:
        return (2000 + int(m_f.group(1)), 3)
    m_cq = re.match(r"^Q([1-4])\s+(20\d{2})$", up)
    if m_cq:
        return (int(m_cq.group(2)), int(m_cq.group(1)) * 3)
    m_m = re.match(r"^([A-Z]{3})\w*\s+(20\d{2})$", up)
    if m_m and m_m.group(1) in _MONTHS:
        return (int(m_m.group(2)), _MONTHS[m_m.group(1)])
    m_y = re.search(r"\b(20\d{2})\b", up)
    if m_y:
        return (int(m_y.group(1)), 12)
    return (9999, 0)


def _period_from_text(text: str) -> str | None:
    m = re.search(
        r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2}),?\s+(20\d{2})\b",
        text,
        re.IGNORECASE,
    )
    if m:
        month = m.group(1)[:3].lower()
        year = int(m.group(3))
        # Only a March 31 balance date maps unambiguously to an Indian-style FY label;
        # any other as-of date keeps its month so a Sep-2024 figure is never labelled FY24.
        if month == "mar":
            return f"FY{year % 100:02d}"
        return f"{month.capitalize()} {year}"
    fy = re.search(r"\bFY\s*(?:20)?(\d{2})\b", text, re.IGNORECASE)
    if fy:
        return f"FY{fy.group(1)}"
    # A bare year anywhere in the chunk ("founded in 2012") says nothing about the figure's period.
    return None


# --------------------------------------------------------------------------- #
# Lexical extraction
# --------------------------------------------------------------------------- #
_ORDER_RE = re.compile(
    r"(?P<label>order\s+book|order\s+portfolio|open\s+orders?|pending\s+orders?|backlog|order\s+inflow|order\s+wins)\b"
    r"[^.\d]{0,90}?"
    r"(?P<num>[+-]?\d[\d,]*(?:\.\d+)?)\s*"
    r"(?P<unit>crore|lakh|million|billion|trillion|mn|bn|gn|mw|gw|tonnes|mt|mnt|units?|pcs?|packages?|"
    r"stores?|branches?|clients?|customers?|cop|cpts|sq\s*ft|acres|ha)\b",
    re.IGNORECASE,
)

_CAPACITY_RE = re.compile(
    r"(?P<label>installed capacity|nameplate capacity|total capacity|utilisa[bt]ion|capacity|plant|plants)\b"
    r"[^.\d]{0,70}?"
    r"(?P<num>[+-]?\d[\d,]*(?:\.\d+)?)\s*"
    r"(?P<unit>mw|gw|tonnes|mt|mnt|kwh|units?|pcs?|plants?|mgd|cmd)\b",
    re.IGNORECASE,
)

_CUSTOMER_RE = re.compile(
    r"(?P<label>top[\s-]?\d+\s+clients?|top\s+\d+\s+clients?|active\s+clients?|number\s+of\s+clients?|"
    r"customer\s+count|client\s+base|total\s+clients?|clients?\s+count|number\s+of\s+customers?|"
    r"customer\s+base|base\s+of\s+customers?|active\s+customers?)\b"
    r"[^.\d]{0,60}?"
    r"(?P<num>[+-]?\d[\d,]*(?:\.\d+)?)\s*"
    r"(?P<unit>clients?|accounts?|names?|customers?)?\b",
    re.IGNORECASE,
)

_OPERATIONAL_RE = re.compile(
    r"(?P<label>\d+(?:\.\d+)?\s*%\s*realisation|realisation|assets\s+under\s+management|aum|"
    r"sold\s+units?|unit\s+sold|number\s+of\s+(?:stores|branches|subscribers|connections|users?)|"
    r"(?:stores|branches|subscribers|connections|users|customers)\s+count)\b"
    r"[^.\d]{0,70}?"
    r"(?P<num>[+-]?\d[\d,]*(?:\.\d+)?)\s*"
    r"(?P<unit>crore|lakh|million|billion|trillion|mn|bn|gn|stores?|branches?|subscribers|connections|"
    r"units?|pcs?|customers?|clients?|users?)?\b",
    re.IGNORECASE,
)

_MIX_RE = re.compile(
    r"(?:(?P<seg>[A-Z][A-Za-z'/&()\- ]{1,40}?)\s+)?"
    r"(?P<pct>\d+(?:\.\d+)?)\s*%\s*of\s+(?P<base>" + "|".join(_MIX_BASES) + r")\b",
    re.IGNORECASE,
)

_SHARE_RE = re.compile(
    r"(?P<pct>\d+(?:\.\d+)?)\s*%\s*share\b[^.\d]{0,80}?"
    r"(?P<market>india|indian|global|international|domestic|us|american|us|\w+\s+market)\b",
    re.IGNORECASE,
)


def _key_for_order(label: str) -> tuple[str, str]:
    low = label.lower()
    if "inflow" in low or "wins" in low:
        return "order_inflow", CATEGORY_OPERATIONAL
    if "backlog" in low:
        return "backlog", CATEGORY_OPERATIONAL
    return "order_book", CATEGORY_ORDER_BOOK


def _segment_for(text: str, base: str) -> tuple[str, str]:
    low = text.lower()
    if any(w in low for w in _GEO_WORDS):
        return "geography", "geography"
    if "product" in low:
        return "product", "product"
    if base in ("topline", "revenue", "sales", "income", "turnover"):
        return "segment", "segment"
    return "segment", "segment"


def _lexical_in_text(text: str, chunk: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not text:
        return rows
    doc_id = _to_str(chunk.get("document_id"))

    def _sentence(start: int, end: int) -> str:
        left = max(text.rfind(".", 0, start), text.rfind("\n", 0, start)) + 1
        right_dot = text.find(".", end)
        right = len(text) if right_dot == -1 else right_dot + 1
        return " ".join(text[left:right].split())[:400]

    def _row(kind, key, label, unit, category, value, name=None, dimension=None, share=None, span=(0, 0)):
        quote = _sentence(*span)
        period = _period_from_text(quote) or _period_from_text(text)
        rows.append(
            {
                "kind": kind,
                "key": key,
                "label": label,
                "unit": unit,
                "category": category,
                "dimension": dimension,
                "name": name,
                "period": period,
                "value": value,
                "share_pct": share,
                "document_id": doc_id,
                "page_start": _to_int(chunk.get("page_start")),
                "page_end": _to_int(chunk.get("page_end")),
                "section": _to_str(chunk.get("section")),
                "quote": quote,
                "title": _to_str(chunk.get("title")),
                "source_url": _to_str(chunk.get("source_url")),
            }
        )

    for m in _ORDER_RE.finditer(text):
        value = _extract_amount(m.group("num"))
        if value is None:
            continue
        key, category = _key_for_order(m.group("label"))
        _row("kpi", key, m.group("label"), _to_str(m.group("unit")), category, value, span=m.span())

    for m in _CAPACITY_RE.finditer(text):
        value = _extract_amount(m.group("num"))
        if value is None:
            continue
        unit = (_to_str(m.group("unit")) or "").lower()
        _row("kpi", f"capacity_{unit}" if unit else "capacity", m.group("label"), unit or None, CATEGORY_CAPACITY, value, span=m.span())

    for m in _CUSTOMER_RE.finditer(text):
        value = _extract_amount(m.group("num"))
        if value is None:
            continue
        _row("kpi", "customers", m.group("label"), _to_str(m.group("unit")), CATEGORY_CUSTOMERS, value, span=m.span())

    for m in _OPERATIONAL_RE.finditer(text):
        value = _extract_amount(m.group("num"))
        if value is None:
            continue
        label = " ".join(m.group("label").lower().split())
        _row("kpi", "op_" + re.sub(r"[^a-z]+", "_", label).strip("_"), m.group("label"), _to_str(m.group("unit")), CATEGORY_OPERATIONAL, value, span=m.span())

    for m in _MIX_RE.finditer(text):
        share = _extract_amount(m.group("pct"))
        if share is None:
            continue
        segment, dimension = _segment_for(text, m.group("base").lower())
        name = _to_str(m.group("seg")) or m.group("base").capitalize()
        _row("mix", "revenue_mix", name, None, CATEGORY_FINANCIAL, None,
             name=name, dimension=dimension, share=share, span=m.span())

    for m in _SHARE_RE.finditer(text):
        share = _extract_amount(m.group("pct"))
        if share is None:
            continue
        market = _to_str(m.group("market")) or "total"
        _row("share", "market_share", market, None, CATEGORY_FINANCIAL, None,
             name=market, dimension="market", share=share, span=m.span())

    return rows


# --------------------------------------------------------------------------- #
# Retrieval + extraction plumbing
# --------------------------------------------------------------------------- #
def _gather_chunks(db: Session, symbol: str) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for query in RETRIEVAL_QUERIES:
        try:
            matches = retrieve.search(db, symbol, query, k=8)
        except Exception:  # noqa: BLE001 - retrieval is best effort
            continue
        for chunk in matches or []:
            cid = str(chunk.get("id"))
            if not cid or cid in seen:
                continue
            text = (chunk.get("text") or "").strip()
            if not text:
                continue
            seen[cid] = chunk
    return list(seen.values())


def _normalize_llm_rows(result: Any) -> list[dict[str, Any]]:
    if not result:
        return []
    if isinstance(result, list):
        raw = result
    elif isinstance(result, dict):
        for key in ("rows", "data", "points", "metrics"):
            if isinstance(result.get(key), list):
                raw = result[key]
                break
        else:
            return []
    else:
        return []
    return [r for r in raw if isinstance(r, dict)]


def _clean_rows(chunks: list[dict[str, Any]], raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only rows whose quote is verified and whose numeric value is in the quote."""
    cleaned: list[dict[str, Any]] = []
    for r in raw_rows:
        quote = _to_str(r.get("quote"))
        if not quote:
            continue
        chunk = None
        # The prompt numbers chunks [0], [1], … by position, so chunk_id is a list index.
        raw_id = r.get("chunk_id")
        idx = _to_int(raw_id) if isinstance(raw_id, (int, float)) or str(raw_id or "").isdigit() else None
        if idx is not None and 0 <= idx < len(chunks):
            chunk = chunks[idx]
        elif raw_id is not None:  # tolerate a model echoing the stored chunk id instead
            chunk = next((c for c in chunks if str(c.get("id")) == str(raw_id)), None)
        if chunk is None:
            for c in chunks:
                if quote in (c.get("text") or ""):
                    chunk = c
                    break
        if chunk is None:
            continue
        text = chunk.get("text") or ""
        if not llm.verify_quote(quote, text):
            continue
        value = _check_numeric_in_quote(r.get("value"), quote)
        share_pct = _check_numeric_in_quote(r.get("share_pct"), quote)
        if value is None and share_pct is None:
            continue
        period = _normalise_period(r.get("period"))
        cleaned.append(
            {
                "kind": _to_str(r.get("kind")) or "kpi",
                "key": _to_str(r.get("key")) or "",
                "label": _to_str(r.get("label")) or "",
                "unit": _to_str(r.get("unit")),
                "category": _to_str(r.get("category")),
                "dimension": _to_str(r.get("dimension")),
                "name": _to_str(r.get("name")),
                "period": period,
                "value": value,
                "share_pct": share_pct,
                "document_id": _to_str(chunk.get("document_id")),
                "page_start": _to_int(chunk.get("page_start")),
                "page_end": _to_int(chunk.get("page_end")),
                "section": _to_str(chunk.get("section")),
                "quote": quote,
                "title": _to_str(chunk.get("title")),
                "source_url": _to_str(chunk.get("source_url")),
            }
        )
    return cleaned


_LLM_BATCH = 8


async def _llm_extract_rows(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """LLM extraction in batches of chunks, each cleaned against its own batch.

    One call over every chunk (70k+ chars) produced a reply longer than the output budget, i.e.
    truncated, unparseable JSON — so the whole extraction silently fell back to regexes.
    """
    batches = [chunks[i:i + _LLM_BATCH] for i in range(0, len(chunks), _LLM_BATCH)]
    sem = asyncio.Semaphore(3)

    async def one(batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
        async with sem:
            return _clean_rows(batch, await _llm_extract(batch))

    results = await asyncio.gather(*(one(b) for b in batches))
    return [row for rows in results for row in rows]


async def _llm_extract(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    system = (
        "You are a meticulous Indian-equities analyst. Extract operational KPIs, revenue "
        "mix components and market-share figures exactly as stated in the text. Reply with "
        'JSON {"rows": [{"kind": "kpi"|"mix"|"share", "key", "label", "unit", '
        '"category", "dimension", "name", "period", "value", "share_pct", '
        '"chunk_id": <chunk index>, "quote": "<verbatim text>"}]}. Do not infer numbers '
        "absent from the text."
    )
    body = "\n---\n".join(
        f"[{i}]\n{c.get('text') or ''}" for i, c in enumerate(chunks)
    )
    result = await llm.complete_json(system, body, max_tokens=3000)
    return _normalize_llm_rows(result)


# --------------------------------------------------------------------------- #
# Persistence + response building
# --------------------------------------------------------------------------- #
def _persist(db: Session, symbol: str, rows: list[dict[str, Any]]) -> None:
    """Re-extract replaces that symbol's previous rows."""
    db.query(BusinessMetricORM).filter(BusinessMetricORM.symbol == symbol).delete()
    db.commit()
    for row in rows:
        db.add(BusinessMetricORM(symbol=symbol, **row))
    db.commit()


def _citation_from_row(row: BusinessMetricORM) -> dict[str, Any] | None:
    doc_id = None
    if row.document_id and row.document_id.isdigit():
        doc_id = int(row.document_id)
    if doc_id is None and not row.quote and not row.title:
        return None
    return {
        "doc_id": doc_id,
        "title": row.title,
        "page_start": row.page_start,
        "page_end": row.page_end,
        "section": row.section,
        "quote": row.quote,
        "source_url": row.source_url,
    }


_KEY_PERIOD_SUFFIX_RE = re.compile(r"(?:_(?:fy|cy|q[1-4])?_?\d{2,4})+$", re.I)


def _series_key(row: BusinessMetricORM) -> str:
    """One series per metric: the model often bakes the year into the key (capex_2025, capex_2024),
    which split every year into its own one-point series. Group by label, else the key minus that suffix."""
    label = re.sub(r"[^a-z0-9]+", " ", (row.label or "").lower()).strip()
    if label:
        return f"{label}|{(row.unit or '').lower().rstrip('s')}"
    return _KEY_PERIOD_SUFFIX_RE.sub("", row.key or "") or "metric"


def _group_kpis(rows: list[BusinessMetricORM]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.kind != "kpi":
            continue
        gkey = _series_key(row)
        g = groups.get(gkey)
        if g is None:
            key = _KEY_PERIOD_SUFFIX_RE.sub("", row.key or "") or "metric"
            g = {"key": key, "label": row.label, "unit": row.unit,
                 "category": row.category, "points": [], "periods": set()}
            groups[gkey] = g
        if row.period in g["periods"]:
            continue
        g["periods"].add(row.period)
        if not g["label"] and row.label:
            g["label"] = row.label
        if not g["unit"] and row.unit:
            g["unit"] = row.unit
        if not g["category"] and row.category:
            g["category"] = row.category
        g["points"].append(
            {
                "period": row.period,
                "value": row.value,
                "citation": _citation_from_row(row),
            }
        )
    series: list[dict[str, Any]] = []
    for g in groups.values():
        g["points"].sort(key=lambda p: _period_sort_key(p["period"]))
        series.append(
            {
                "key": g["key"],
                "label": g["label"],
                "unit": g["unit"],
                "category": g["category"],
                "points": g["points"],
            }
        )
    return series


def _group_mix(rows: list[BusinessMetricORM]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str | None], dict[str, Any]] = {}
    for row in rows:
        if row.kind != "mix":
            continue
        key = (row.period or "unknown", row.dimension or "segment")
        g = groups.setdefault(key, {"period": row.period, "dimension": row.dimension, "items": []})
        g["items"].append(
            {
                "name": row.name or row.label or "item",
                "value": row.value,
                "unit": row.unit,
                "share_pct": row.share_pct,
            }
        )
    snapshots: list[dict[str, Any]] = []
    for g in groups.values():
        items = g["items"]
        known = [it for it in items if it["value"] is not None]
        total = sum(it["value"] for it in known) if known else None
        for it in items:
            if it["value"] is not None and total:
                it["share_pct"] = round(100.0 * it["value"] / total, 2)
        snapshots.append(
            {
                "period": g["period"],
                "dimension": g["dimension"],
                "items": items,
                "citation": _citation_from_row(_first_mix_row(rows, g["period"], g["dimension"])),
            }
        )
    return snapshots


def _first_mix_row(rows: list[BusinessMetricORM], period: str | None, dimension: str | None) -> BusinessMetricORM | None:
    for row in rows:
        if row.kind == "mix" and row.period == period and row.dimension == dimension:
            return row
    return None


def _group_shares(rows: list[BusinessMetricORM]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.kind != "share":
            continue
        market = row.name or row.label or "total"
        g = groups.setdefault(
            market,
            {"market": market, "points": []},
        )
        share = row.share_pct if row.share_pct is not None else row.value
        g["points"].append(
            {
                "period": row.period,
                "share_pct": share,
                "citation": _citation_from_row(row),
            }
        )
    series: list[dict[str, Any]] = []
    for g in groups.values():
        g["points"].sort(key=lambda p: _period_sort_key(p["period"]))
        series.append(g)
    return series


def _first_created(rows: list[BusinessMetricORM]) -> str | None:
    for row in rows:
        if row.created_at:
            return row.created_at.isoformat()
    return None


def _build_response(db: Session, symbol: str, *, engine: str | None) -> dict[str, Any]:
    rows = db.query(BusinessMetricORM).filter(BusinessMetricORM.symbol == symbol).all()
    return {
        "symbol": symbol,
        "updated_at": _first_created(rows),
        "engine": engine,
        "kpis": _group_kpis(rows),
        "revenue_mix": _group_mix(rows),
        "market_share": _group_shares(rows),
        "warnings": [],
    }


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def get_metrics(db: Session, symbol: str) -> dict[str, Any]:
    symbol = symbol.upper()
    return _build_response(db, symbol, engine=None)


async def extract(db: Session, symbol: str, *, use_llm: bool = True) -> dict[str, Any]:
    symbol = symbol.upper()
    warnings: list[str] = []

    chunks = _gather_chunks(db, symbol)
    if not chunks:
        warnings.append(f"No filings found for symbol '{symbol}'")
        _persist(db, symbol, [])
        response = _build_response(db, symbol, engine=None)
        response["warnings"] = warnings
        return response

    rows: list[dict[str, Any]] = []
    engine: str | None = None

    if use_llm and llm.llm_available():
        rows = await _llm_extract_rows(chunks)
        if rows:
            engine = "llm"

    if not rows:
        rows = _lexical_extract(chunks)
        engine = "lexical"

    if not rows:
        warnings.append("No verifiable figures could be extracted from the filings")

    _persist(db, symbol, rows)
    response = _build_response(db, symbol, engine=engine)
    response["warnings"] = warnings
    return response


def _lexical_extract(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[tuple] = set()
    for chunk in chunks:
        for row in _lexical_in_text(chunk.get("text") or "", chunk):
            # Chunks overlap by a paragraph, so the same sentence can match twice.
            sig = (row["kind"], row["key"], row["name"], row["period"], row["value"], row["share_pct"], row["unit"])
            if sig in seen:
                continue
            seen.add(sig)
            rows.append(row)
    return rows