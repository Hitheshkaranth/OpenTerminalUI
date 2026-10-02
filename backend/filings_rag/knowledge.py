from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from backend.filings_rag import llm, store
from backend.filings_rag.models import FilingKnowledgeORM

# OWNER: agent C. Consumes agent A (store.get_chunks) and agent B (llm.*) only via their
# contract signatures so the functions can be monkeypatched in tests.

ELIGIBLE_DOC_TYPES = ("concall_transcript", "investor_presentation", "quarterly_filing", "press_release")

_LLM_ENGINE = "llm"
_LEXICAL_ENGINE = "lexical"

# Sections surfaced first when only the newest 12 chunks are sent to the LLM.
_SECTION_BOOST = ("outlook", "guidance", "order", "margin", "q&a", "question", "answer", "forward")

# Lexical highlight keyword density (mirrors the filing-parser keyword families).
_HIGHLIGHT_KEYWORDS = ("guidance", "expect", "target", "order", "margin", "growth", "capex", "launch")

# Forward-looking guidance triggers + number/period.
_GUIDANCE_KEYWORDS = (
    "expect", "expects", "expected", "guide", "guides", "guiding", "guidance",
    "target", "targets", "aim", "aims", "aimed", "plan", "plans", "planned", "planning",
)
# Words that turn a forward-looking sentence into a reported actual for the period.
_ACTUAL_KEYWORDS = (
    "achieved", "actual", "reported", "delivered", "recorded", "came in",
    "resulted in", "booked",
)
# Metric labels reported generically (no currency/segment) adopt the previous one.
_GENERIC_METRICS = ("Other", "Growth")

_POSITIVE_WORDS = (
    "growth", "increase", "improved", "expansion", "wins", "profit", "beat",
    "strong", "upgrade", "outperform", "record", "accelerat", "robust",
)
_NEGATIVE_WORDS = (
    "decline", "decrease", "loss", "weak", "downgrade", "delay", "penalty",
    "litigation", "resignation", "fraud", "miss", "sluggish", "pressure",
    "headwind", "contraction", "slowdown",
)

_MIN_LLM_HIGHLIGHTS = 3

_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
_PERCENT_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(%)")
_CURRENCY_RE = re.compile(r"(₹|\$|€|£)\s*(\d[\d,]*(?:\.\d+)?)")
_PERIOD_RE = re.compile(
    r"\b(FY\d{2}(?:\s*[-/]\s*FY\d{2}|(?:-\s*FY\d{4}))?|FY\d{4}|Q[1-4](?:\s*FY\d{2}|(?:-\s*FY\d{4}))?|"
    r"H[12]\s*(?:FY\d{2})?|next|this|current|trailing)\b",
    re.IGNORECASE,
)

_SYSTEM_PROMPT = (
    "You are a senior equity research analyst summarising a company earnings call / investor "
    "presentation. Return strict JSON with exactly these keys:\n"
    "- highlights: 3-6 objects {\"text\": a concise claim-style one-liner, \"quote\": the verbatim excerpt that supports it};\n"
    "- management_tone: one of \"positive\", \"neutral\", \"negative\";\n"
    "- key_numbers: array of {label, value, unit};\n"
    "- qa_themes: array of short themes drawn from the Q&A;\n"
    "- quotes: array of {quote, highlight} where quote is a verbatim excerpt present in the text "
    "and highlight is the claim it supports.\n"
    "Only include claims whose quote appears verbatim. Do not fabricate. When a claim compares two "
    "figures, state the figures and the exact percentage change (e.g. 'up 56%') rather than words "
    "like 'doubled' or 'surged', which overstated real changes."
)


# --------------------------------------------------------------------------- shared helpers
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]


def _group_chunks_by_doc(chunks: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    docs: dict[int, dict[str, Any]] = {}
    for chunk in chunks:
        doc_id = chunk.get("document_id")
        if doc_id in docs:
            docs[doc_id]["chunks"].append(chunk)
        else:
            docs[doc_id] = {"meta": chunk, "chunks": [chunk]}
    return docs


def _doc_sorted(docs: dict[int, dict[str, Any]], newest_first: bool) -> list[dict[str, Any]]:
    items = list(docs.values())
    items.sort(key=lambda d: d["meta"].get("filed_at") or "", reverse=newest_first)
    return items


def _has_number(text: str) -> bool:
    return bool(_NUMBER_RE.search(text))


def _tone_of(text: str) -> str:
    lower = text.lower()
    pos = sum(lower.count(word) for word in _POSITIVE_WORDS)
    neg = sum(lower.count(word) for word in _NEGATIVE_WORDS)
    if pos > neg:
        return "positive"
    if neg > pos:
        return "negative"
    return "neutral"


def _verify(chunk_text: str, quote: str) -> bool:
    try:
        return bool(llm.verify_quote(quote, chunk_text))
    except Exception:
        return False


def _citation(chunk: dict[str, Any], quote: str) -> dict[str, Any]:
    try:
        return llm.citation_for(chunk, quote)
    except Exception:
        return {
            "doc_id": chunk.get("document_id"),
            "title": chunk.get("title") or "",
            "page_start": chunk.get("page_start"),
            "page_end": chunk.get("page_end"),
            "section": chunk.get("section"),
            "quote": quote,
            "source_url": chunk.get("source_url"),
        }


# ------------------------------------------------------------------------ lexical fallback
def _lexical_highlights(text: str, max_n: int = 5) -> list[str]:
    scored: list[tuple[int, str]] = []
    for sentence in _split_sentences(text):
        if not _has_number(sentence):
            continue
        score = sum(sentence.lower().count(word) for word in _HIGHLIGHT_KEYWORDS)
        if score <= 0:
            continue
        scored.append((score, sentence))
    scored.sort(key=lambda item: item[0], reverse=True)
    seen: set[str] = set()
    out: list[str] = []
    for _, sentence in scored:
        key = sentence.lower()
        if key in seen or not sentence.strip():
            continue
        seen.add(key)
        out.append(sentence)
        if len(out) >= max_n:
            break
    return out


def _lexical_numbers(text: str, max_n: int = 6) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in _CURRENCY_RE.finditer(text):
        raw = match.group(0).strip()
        if raw in seen:
            continue
        seen.add(raw)
        out.append({"label": match.group(1), "value": float(match.group(2).replace(",", "")), "unit": None})
        if len(out) >= max_n:
            break
    for match in _PERCENT_RE.finditer(text):
        raw = match.group(0).strip()
        if raw in seen:
            continue
        seen.add(raw)
        out.append({"label": "percentage", "value": float(match.group(1).replace(",", "")), "unit": "%"})
        if len(out) >= max_n:
            break
    return out


def _lexical_qa(text: str, max_n: int = 5) -> list[str]:
    scored: list[tuple[int, str]] = []
    theme_words = ("q&a", "question", "answer", "guidance", "outlook", "expect", "forward")
    for sentence in _split_sentences(text):
        score = sum(sentence.lower().count(word) for word in theme_words)
        if score > 0:
            scored.append((score, sentence))
    scored.sort(key=lambda item: item[0], reverse=True)
    seen: set[str] = set()
    out: list[str] = []
    for _, sentence in scored:
        key = sentence.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(sentence[:200])
        if len(out) >= max_n:
            break
    return out


def _build_lexical_summary(doc: dict[str, Any], chunks: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(chunks, key=lambda c: c.get("ordinal") or 0)
    all_text = "\n".join(c.get("text") or "" for c in ordered)
    qa_text = "\n".join(
        c.get("text") or ""
        for c in ordered
        if any(word in str(c.get("section") or "").lower() for word in ("q&a", "question", "answer"))
    )
    highlights = _lexical_highlights(all_text)
    citations: list[dict[str, Any]] = []
    for sentence in highlights:
        chunk = next((c for c in ordered if sentence in (c.get("text") or "")), None)
        if chunk is not None:
            citations.append(_citation(chunk, sentence))
    return {
        "doc_id": doc["meta"].get("document_id"),
        "title": doc["meta"].get("title") or "",
        "period": doc["meta"].get("period"),
        "filed_at": doc["meta"].get("filed_at"),
        "highlights": highlights,
        "management_tone": _tone_of(all_text),
        "key_numbers": _lexical_numbers(all_text),
        "qa_themes": _lexical_qa(qa_text or all_text),
        "citations": citations,
        "engine": _LEXICAL_ENGINE,
    }


# --------------------------------------------------------------------------- LLM path
def _rank_chunks(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def section_score(chunk: dict[str, Any]) -> int:
        section = str(chunk.get("section") or "").lower()
        return sum(1 for word in _SECTION_BOOST if word in section)

    ranked = sorted(chunks, key=section_score, reverse=True)
    return ranked[:12]


async def _llm_summarize(chunks: list[dict[str, Any]], doc: dict[str, Any]) -> dict[str, Any] | None:
    body = "\n\n".join(
        f"[section: {c.get('section') or 'page'}]\n{c.get('text') or ''}" for c in chunks
    )
    user = (
        f"Title: {doc['meta'].get('title') or ''}\n"
        f"Period: {doc['meta'].get('period') or ''}\n"
        f"Document type: {doc['meta'].get('doc_type') or ''}\n\n{body}"
    )
    try:
        return await llm.complete_json(_SYSTEM_PROMPT, user, max_tokens=3000)
    except Exception:
        return None


def _apply_llm_summary(
    doc: dict[str, Any],
    chunks: list[dict[str, Any]],
    raw: dict[str, Any],
) -> dict[str, Any] | None:
    ordered = sorted(chunks, key=lambda c: c.get("ordinal") or 0)
    raw_highlights = raw.get("highlights") or []
    if not isinstance(raw_highlights, list):
        raw_highlights = []
    raw_quotes = raw.get("quotes") or []
    if not isinstance(raw_quotes, list):
        raw_quotes = []

    linked: dict[str, list[dict[str, Any]]] = {}
    for item in raw_quotes:
        if isinstance(item, dict):
            quote_text, highlight = item.get("quote"), item.get("highlight")
        elif isinstance(item, str):
            quote_text, highlight = item, None
        else:
            continue
        if not isinstance(quote_text, str) or not quote_text.strip():
            continue
        quote = {"quote": quote_text.strip(), "highlight": highlight if isinstance(highlight, str) else None}
        if quote["highlight"]:
            linked.setdefault(quote["highlight"], []).append(quote)

    def verify_citation(quote_text: str) -> list[dict[str, Any]]:
        cites: list[dict[str, Any]] = []
        for chunk in ordered:
            if _verify(chunk.get("text") or "", quote_text):
                cites.append(_citation(chunk, quote_text))
        return cites

    citations: list[dict[str, Any]] = []
    seen_citations: set[str] = set()

    def add_citation(cite: dict[str, Any]) -> None:
        key = str(cite.get("quote")) + "|" + str(cite.get("doc_id"))
        if key not in seen_citations:
            seen_citations.add(key)
            citations.append(cite)

    kept_highlights: list[str] = []
    for entry in raw_highlights:
        if isinstance(entry, dict):
            highlight_text = entry.get("text") or entry.get("highlight")
            own_quote = entry.get("quote")
        else:
            highlight_text, own_quote = entry, None
        if not isinstance(highlight_text, str) or not highlight_text.strip():
            continue
        highlight_text = highlight_text.strip()
        candidates = list(linked.get(highlight_text, []))
        # Each highlight carries its own verbatim quote; exact-text linking to a separate quotes list
        # failed whenever the model restated the highlight, discarding whole LLM summaries.
        if isinstance(own_quote, str) and own_quote.strip():
            candidates.insert(0, {"quote": own_quote.strip(), "highlight": highlight_text})
        candidates.append({"quote": highlight_text, "highlight": highlight_text})

        verified_for_highlight: list[dict[str, Any]] = []
        for candidate in candidates:
            verified_for_highlight.extend(verify_citation(candidate["quote"]))
        if not verified_for_highlight:
            continue

        for cite in sorted(verified_for_highlight, key=lambda c: str(c.get("doc_id"))):
            add_citation(cite)
        kept_highlights.append(highlight_text)

    if len(kept_highlights) < _MIN_LLM_HIGHLIGHTS:
        return None

    tone = raw.get("management_tone")
    if tone not in ("positive", "neutral", "negative"):
        tone = _tone_of("\n".join(c.get("text") or "" for c in ordered))

    key_numbers: list[dict[str, Any]] = []
    seen_numbers: set[str] = set()
    for entry in raw.get("key_numbers") or []:
        if not isinstance(entry, dict):
            continue
        try:
            value = float(entry.get("value")) if entry.get("value") is not None else None
        except (TypeError, ValueError):
            value = None
        label = str(entry.get("label") or "amount")
        key = label + str(value) + str(entry.get("unit"))
        if key in seen_numbers:
            continue
        seen_numbers.add(key)
        key_numbers.append({"label": label, "value": value, "unit": str(entry.get("unit")) if entry.get("unit") else None})
        if len(key_numbers) >= 8:
            break

    qa_themes = [str(theme) for theme in (raw.get("qa_themes") or []) if str(theme).strip()]
    if not qa_themes:
        qa_themes = _lexical_qa("\n".join(c.get("text") or "" for c in ordered))

    return {
        "doc_id": doc["meta"].get("document_id"),
        "title": doc["meta"].get("title") or "",
        "period": doc["meta"].get("period"),
        "filed_at": doc["meta"].get("filed_at"),
        "highlights": kept_highlights,
        "management_tone": tone,
        "key_numbers": key_numbers,
        "qa_themes": qa_themes[:6],
        "citations": citations,
        "engine": _LLM_ENGINE,
    }


async def _build_concall_summary(doc: dict[str, Any], llm_enabled: bool) -> dict[str, Any]:
    chunks = doc["chunks"]
    if llm_enabled:
        ranked = _rank_chunks(chunks)
        raw = await _llm_summarize(ranked, doc)
        if isinstance(raw, dict):
            summary = _apply_llm_summary(doc, ranked, raw)
            if summary is not None:
                return summary
    return _build_lexical_summary(doc, chunks)


# ------------------------------------------------------------------------ guidance tracker
def _guidance_tail(sentence: str) -> str:
    """Text from the first forward-looking keyword on, so "grew 12%; we expect 15%" yields 15."""
    lower = sentence.lower()
    hits = [m.start() for w in _GUIDANCE_KEYWORDS for m in [re.search(rf"\b{w}\b", lower)] if m]
    return sentence[min(hits):] if hits else sentence


def _extract_number(sentence: str) -> dict[str, Any] | None:
    tail = _guidance_tail(sentence)
    if tail is not sentence and _NUMBER_RE.search(tail):
        sentence = tail
    match = _PERCENT_RE.search(sentence)
    if match:
        return {"value": float(match.group(1).replace(",", "")), "raw": match.group(0).strip(), "unit": "%"}
    match = _CURRENCY_RE.search(sentence)
    if match:
        return {"value": float(match.group(2).replace(",", "")), "raw": match.group(0).strip(), "unit": match.group(1)}
    match = _NUMBER_RE.search(sentence)
    if match:
        value = float(match.group(0).replace(",", ""))
        if value == 0:
            return None
        return {"value": value, "raw": match.group(0), "unit": None}
    return None


def _extract_period(sentence: str) -> str | None:
    match = _PERIOD_RE.search(sentence)
    return match.group(1) if match else None


def _metric_label(sentence: str) -> str:
    lower = sentence.lower()
    labels = [
        ("Revenue growth", (r"revenue growth", r"growth in revenue", r"top[\s-]?line", r"topline", r"sales growth")),
        ("EBITDA margin", (r"ebitda margin", r"operating margin", r"opm")),
        ("Order inflow", (r"order inflow", r"order book", r"new orders?")),
        ("Capex", (r"capex", r"capital expenditure", r"capex programme", r"capex plan")),
        ("Net profit", (r"net profit", r"profit after tax", r"bottom line")),
        ("EBITDA", (r"ebitda\b",)),
        ("Margins", (r"margin\b", r"margins?\b")),
        ("Growth", (r"growth",)),
    ]
    for label, keywords in labels:
        for pattern in keywords:
            if re.search(pattern, lower):
                return label
    return "Other"


def _is_actual(sentence: str) -> bool:
    lower = sentence.lower()
    return any(word in lower for word in _ACTUAL_KEYWORDS)


def _parse_guidance_statement(sentence: str) -> dict[str, Any] | None:
    lowered = sentence.lower()
    if not any(word in lowered for word in _GUIDANCE_KEYWORDS):
        return None
    number = _extract_number(sentence)
    if number is None:
        return None
    label = _metric_label(sentence)
    metric = None if label in _GENERIC_METRICS else label
    return {
        "metric": metric,
        "value": number["value"],
        "raw": number["raw"],
        "unit": number["unit"],
        "period": _extract_period(sentence),
        "actual": _is_actual(sentence),
        "statement": sentence.strip(),
    }


def _guidance_status(prev: dict[str, Any] | None, item: dict[str, Any]) -> str:
    if prev is None:
        return "new"
    if item["actual"]:
        if prev.get("value") is None:
            return "unknown"
        if item["period"] and prev.get("period") and item["period"] != prev["period"]:
            return "unknown"
        return "met" if item["value"] >= prev["value"] else "missed"
    if item["value"] is not None and prev.get("value") is not None:
        if item["value"] == prev["value"]:
            return "reiterated"
        return "raised" if item["value"] > prev["value"] else "lowered"
    return "unknown"


def _extract_guidance(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    docs = _group_chunks_by_doc(chunks)
    ordered_docs = _doc_sorted(docs, newest_first=False)

    items: list[dict[str, Any]] = []
    for doc in ordered_docs:
        for chunk in sorted(doc["chunks"], key=lambda c: c.get("ordinal") or 0):
            text = chunk.get("text") or ""
            for sentence in _split_sentences(text):
                if not _verify(text, sentence):
                    continue
                parsed = _parse_guidance_statement(sentence)
                if parsed is None:
                    continue
                parsed["doc_id"] = doc["meta"].get("document_id")
                parsed["title"] = doc["meta"].get("title") or ""
                parsed["doc_period"] = doc["meta"].get("period")
                parsed["section"] = chunk.get("section")
                parsed["page_start"] = chunk.get("page_start")
                parsed["page_end"] = chunk.get("page_end")
                parsed["source_url"] = doc["meta"].get("source_url")
                parsed["quote"] = sentence
                parsed["chunk"] = chunk
                items.append(parsed)

    results: list[dict[str, Any]] = []
    history: dict[tuple, dict[str, Any]] = {}
    for item in items:
        # A sentence without a recognisable metric must not inherit the previous one
        # ("plan to open 50 stores" is not a revenue-guidance raise to 50).
        metric = item["metric"] or "Other"
        # Only the same metric, unit and target period are comparable (15% for FY25 vs 20% for FY26 is not a raise).
        key = (metric, item["unit"], (item["period"] or "").upper())
        prev = None if metric == "Other" else history.get(key)
        status = _guidance_status(prev, item)

        if item["value"] is not None and metric != "Other":
            history[key] = {"value": item["value"], "period": item["period"]}

        results.append({
            "metric": metric,
            "statement": item["statement"],
            "target": item["raw"],
            "period": item["period"],
            "said_in": {"doc_id": item["doc_id"], "title": item["title"], "period": item["doc_period"]},
            "status": status,
            "citation": _citation(item["chunk"], item["quote"]),
        })
    return results


# ----------------------------------------------------------------------------- persistence
def _persist(db: Session, symbol: str, payload: dict[str, Any]) -> None:
    db.add(FilingKnowledgeORM(symbol=symbol, engine=payload["engine"], payload=payload))
    db.commit()


# ----------------------------------------------------------------------------- public API
async def build_knowledge(db: Session, symbol: str, *, use_llm: bool = True) -> dict[str, Any]:
    symbol_u = symbol.strip().upper()
    warnings: list[str] = []

    chunks = store.get_chunks(db, symbol_u, doc_types=list(ELIGIBLE_DOC_TYPES))
    if not chunks:
        warnings.append(
            f"No eligible documents ({', '.join(ELIGIBLE_DOC_TYPES)}) found for {symbol_u}."
        )
        payload = {
            "symbol": symbol_u,
            "created_at": _now_iso(),
            "engine": _LEXICAL_ENGINE,
            "concalls": [],
            "guidance": [],
            "warnings": warnings,
        }
        _persist(db, symbol_u, payload)
        return payload

    docs = _group_chunks_by_doc(chunks)
    latest_docs = _doc_sorted(docs, newest_first=True)[:8]

    llm_enabled = bool(use_llm and llm.llm_available())
    concalls: list[dict[str, Any]] = []
    used_llm = False
    for doc in latest_docs:
        summary = await _build_concall_summary(doc, llm_enabled=llm_enabled)
        concalls.append(summary)
        if summary["engine"] == _LLM_ENGINE:
            used_llm = True

    guidance = _extract_guidance(chunks)
    engine = _LLM_ENGINE if used_llm else _LEXICAL_ENGINE

    payload = {
        "symbol": symbol_u,
        "created_at": _now_iso(),
        "engine": engine,
        "concalls": concalls,
        "guidance": guidance,
        "warnings": warnings,
    }
    _persist(db, symbol_u, payload)
    return payload