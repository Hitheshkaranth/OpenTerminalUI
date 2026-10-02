from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from backend.filings_rag import taxonomy
from backend.filings_rag.llm import complete_json, citation_for, llm_available, verify_quote
from backend.filings_rag.models import FilingAnalysisORM
from backend.filings_rag.retrieve import search as retrieve_search
from backend.filings_rag.store import get_chunks as store_get_chunks
from backend.services.llm.factory import get_llm_provider

_CHUNK_TEXT_CAP = 3000
_CLAIM_CAP = 300
_SUMMARY_CAP = 600


def _clip(text: str, limit: int) -> str:
    """Cut at a word boundary with an ellipsis; a raw slice left fragments like "…$5.1 billion i"."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(" ,;:")
    return f"{cut}…"
_MAG_WEIGHT = {"high": 3, "medium": 2, "low": 1}

# Number immediately followed (or adjacent) by a unit token.
_NUMBER_UNIT_RE = re.compile(
    r"(\d+(?:,\d+)*(?:\.\d+)?)\s*"
    r"(%|crore|lakh|mn|million|bn|billion|MW|GW|TW|tonne|tonnes|units|unit|kbps|bps|kg|USD|EUR|Rs)?",
    re.IGNORECASE,
)

# Keyword -> metric label for the lexical extractor's first pass.
_METRIC_HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"order book|backlog|letter of award|\bLoA\b|bagged orders", re.I), "Order book"),
    (re.compile(r"(gross|operating|net|EBITDA?)?\s*margin", re.I), "Margin"),
    (re.compile(r"net debt|total debt|debt to equity|debt-to-equity|leverage", re.I), "Net debt"),
    (re.compile(r"revenue|topline|turnover|sales\b", re.I), "Revenue"),
    (re.compile(r"profit|net income|net profit|EBITDA", re.I), "Profit"),
    (re.compile(r"capex|capital expenditure|capacity|expansion|plant", re.I), "Capex"),
    (re.compile(r"guidance|outlook|advice", re.I), "Guidance"),
    (re.compile(r"market share", re.I), "Market share"),
    (re.compile(r"(dividend|EPS|earnings per share|ROE|ROCE)", re.I), "EPS"),
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return [p.strip() for p in parts if p.strip()]


def _coerce_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        f = float(value)
        return None if f != f else f
    if isinstance(value, str):
        cleaned = value.strip().replace("\u20b9", "").replace("$", "").replace(",", "")
        try:
            f = float(cleaned)
        except ValueError:
            return None
        return None if f != f else f
    return None


def _first_number_unit(sentence: str) -> tuple[float | None, str | None]:
    for match in _NUMBER_UNIT_RE.finditer(sentence):
        unit = match.group(2)
        if unit and match.group(1):
            number = _coerce_number(match.group(1))
            return number, unit.lower().strip()
    return None, None


def _metric_for(sentence: str) -> str | None:
    for pattern, label in _METRIC_HINTS:
        if pattern.search(sentence):
            return label
    return None


def _sentence_has_keyword(sentence: str, keywords: list[str]) -> bool:
    for pattern in keywords:
        try:
            if re.search(pattern, sentence, re.IGNORECASE):
                return True
        except re.error:
            continue
    return False


def _chunk_text_cap(text: str) -> str:
    text = " ".join((text or "").split())
    return text[:_CHUNK_TEXT_CAP]


def _retrieve_driver_chunks(db: Session, symbol: str, driver: dict) -> list[dict]:
    """Top-6 chunks for a driver: union of its queries, deduped by id, best score,
    with the driver's keyword boost passed through to the retriever."""
    doc_types = driver.get("doc_types")
    merged: dict[int, dict] = {}
    for query in driver.get("queries", []):
        try:
            results = retrieve_search(
                db, symbol, query, k=8,
                keywords=driver.get("keywords"), doc_types=doc_types,
            )
        except Exception:
            continue
        for chunk in results or []:
            cid = chunk.get("id")
            if cid is None:
                continue
            if cid not in merged or chunk.get("score", 0.0) > merged[cid].get("score", 0.0):
                merged[cid] = chunk
    ordered = sorted(merged.values(), key=lambda c: c.get("score", 0.0), reverse=True)
    return ordered[:6]


def _build_llm_prompt(driver: dict, chunks: list[dict]) -> tuple[str, str]:
    body = (
        f"You are a securities analyst reviewing a company filing. Answer ONLY from the "
        f"supplied chunks. Never infer or fabricate a number or quote. For every finding the "
        f"quote must appear verbatim in its chunk.\n"
        f"Only report concrete, company-specific facts that actually happened or were stated as "
        f"guidance (figures, wins, approvals, actions taken). Do NOT report generic risk-factor or "
        f"legal boilerplate, hypotheticals ('may', 'could', 'might'), descriptions of laws or "
        f"accounting policies, or text unrelated to this driver. Returning an empty findings list "
        f"is correct when the chunks contain no such evidence.\n"
        f"Every finding must be evidence FOR this driver as stated. For a headwind, report only evidence "
        f"of the negative condition: if the text shows the opposite (e.g. guidance RAISED for a "
        f"'guidance cut' driver), that is not a finding; mention it in the summary instead and set "
        f"supports_driver false on anything you are unsure about.\n"
        f"Write the summary for an investor in 1-3 sentences about the company; never mention "
        f"'chunks', 'the text supplied' or this task.\n\n"
        f"DRIVER: {driver['label']}\n"
        f"Goal: {driver['description']}\n\n"
        f"Return a single JSON object of this shape and nothing else:\n"
        f'{{"findings": ['
        f'{{"claim": str, "quote": str, "chunk_id": int, '
        f'"metric": str|null, "value": number|null, "unit": str|null, '
        f'"period": str|null, "magnitude": "high"|\"medium\"|\"low\", '
        f'"confidence": number, "supports_driver": bool}}, ...], '
        f'"summary": str}}'
    )
    if not chunks:
        body += "\n\nThere are no chunks for this driver. Return {\"findings\": [], \"summary\": \"No filing data for this driver.\"}."
    else:
        body += "\n\nChunks (each has a unique id used as chunk_id):\n"
        for index, chunk in enumerate(chunks, start=1):
            body += (
                f"\nChunk {chunk.get('id', index)}:\n"
                f"  title: {chunk.get('title') or 'n/a'}\n"
                f"  type: {chunk.get('doc_type') or 'n/a'}\n"
                f"  period: {chunk.get('period') or 'n/a'}\n"
                f"  section: {chunk.get('section') or 'n/a'}\n"
                f"  text: {_chunk_text_cap(chunk.get('text', ''))}\n"
            )
    return (
        "You are a precise securities analyst. You only use the supplied chunks and return JSON.",
        body,
    )


def _coerce_confidence(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return max(0.0, min(1.0, float(value)))
    text = str(value).strip().lower()
    text = text.strip("\"'")
    mapping = {"high": 0.85, "medium": 0.6, "low": 0.35, "none": 0.3, "": 0.3}
    if text in mapping:
        return mapping[text]
    try:
        return max(0.0, min(1.0, float(text)))
    except (TypeError, ValueError):
        return 0.3


def _coerce_magnitude(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if text in _MAG_WEIGHT else "medium"


def _extract_llm_finding(finding: dict, id_map: dict[int, dict]) -> dict | None:
    if not isinstance(finding, dict):
        return None
    raw_id = finding.get("chunk_id")
    chunk = id_map.get(raw_id)
    if chunk is None and raw_id is not None:  # models often echo ids as strings ("123")
        try:
            chunk = id_map.get(int(str(raw_id).strip()))
        except ValueError:
            chunk = None
    if chunk is None:
        return None
    quote = str(finding.get("quote") or "").strip()
    if not quote:
        return None
    if not verify_quote(quote, str(chunk.get("text", ""))):
        return None
    return {
        "claim": str(finding.get("claim") or "").strip()[:_CLAIM_CAP],
        "metric": (str(finding.get("metric")).strip() or None) if finding.get("metric") else None,
        "value": _coerce_number(finding.get("value")),
        "unit": (str(finding.get("unit")).strip() or None) if finding.get("unit") else None,
        "period": (str(finding.get("period")).strip() or None) if finding.get("period") else None,
        "magnitude": _coerce_magnitude(finding.get("magnitude")),
        "confidence": _coerce_confidence(finding.get("confidence")),
        "citation": citation_for(chunk, quote),
    }


# Boilerplate disclosures ("there is no material litigation", "no warning letter was received")
# contain driver keywords but state the opposite; the keyword extractor must not count them.
_NEGATION_RE = re.compile(
    r"\b(no|not|nil|none|neither|nor|without|never)\b|n't\b|\bnot applicable\b",
    re.IGNORECASE,
)
_LEXICAL_MAX_FINDINGS = 5
# Contact lines, URLs and XBRL tag runs are never evidence for a growth driver or headwind.
_BOILERPLATE_RE = re.compile(r"@[a-z0-9-]+\.[a-z]{2,}|https?://|www\.|\b(true|false)\b.*\b(true|false)\b", re.IGNORECASE)


def _extract_lexical_findings(chunks: list[dict], keywords: list[str]) -> list[dict]:
    findings: list[dict] = []
    seen_quotes: set[str] = set()
    for chunk in chunks:
        text = str(chunk.get("text", ""))
        for sentence in _split_sentences(text):
            if not _sentence_has_keyword(sentence, keywords):
                continue
            if _NEGATION_RE.search(sentence) or _BOILERPLATE_RE.search(sentence):
                continue
            quote = " ".join(sentence.split())
            key = quote[:_CLAIM_CAP]
            if key in seen_quotes:
                continue
            seen_quotes.add(key)
            value, unit = _first_number_unit(sentence)
            findings.append({
                "claim": quote[:_CLAIM_CAP],
                "metric": _metric_for(sentence),
                "value": value,
                "unit": unit,
                "period": None,
                "magnitude": "medium",
                "confidence": 0.35,
                "citation": citation_for(chunk, quote),
            })
    # Keyword hits are weak evidence: prefer quantified sentences and cap the count so
    # repetition in a long annual report cannot push a driver to full strength.
    findings.sort(key=lambda f: f["value"] is not None, reverse=True)
    return findings[:_LEXICAL_MAX_FINDINGS]


def _driver_finding_score(finding: dict) -> float:
    return _MAG_WEIGHT.get(finding["magnitude"], 1) * finding["confidence"]


def _driver_strength(findings: list[dict]) -> float:
    total = sum(_driver_finding_score(f) for f in findings)
    return float(min(100.0, total * 12))


def _mean_top(findings_strengths: list[float], top: int) -> float:
    if not findings_strengths:
        return 0.0
    best = sorted(findings_strengths, reverse=True)[:top]
    return float(sum(best) / len(best))


async def _driver_llm_findings(driver: dict, chunks: list[dict], semaphore: asyncio.Semaphore) -> dict | None:
    async with semaphore:
        system, user = _build_llm_prompt(driver, chunks)
        parsed = await complete_json(system, user, max_tokens=3000)
    if not isinstance(parsed, dict):
        return None
    findings_raw = parsed.get("findings")
    if not isinstance(findings_raw, list):
        return None
    id_map = {c.get("id"): c for c in chunks}
    # Drop evidence the model itself marks as contradicting the driver: "guidance raised" quotes were
    # being scored as proof of the "guidance cut" headwind.
    supporting = [f for f in findings_raw if not (isinstance(f, dict) and f.get("supports_driver") is False)]
    extracted = [f for f in (_extract_llm_finding(f, id_map) for f in supporting) if f is not None]
    extracted.sort(key=_driver_finding_score, reverse=True)
    return {"findings": extracted, "summary": _clip(str(parsed.get("summary") or ""), _SUMMARY_CAP)}


async def analyze(
    db: Session,
    symbol: str,
    *,
    use_llm: bool = True,
    drivers: list[str] | None = None,
) -> dict[str, Any]:
    """Analyse a symbol's filings into per-driver growth/headwind findings.

    LLM extraction is the primary path; each driver that cannot be filled by the
    LLM (or when LLM is unavailable) falls back to a lexical sentence extractor.
    """
    symbol = symbol.strip().upper()
    all_drivers = [d for d in taxonomy.DRIVERS if drivers is None or d["id"] in drivers]

    all_chunks = store_get_chunks(db, symbol)
    documents_used = len({c.get("document_id") for c in all_chunks if c.get("document_id")})

    provider = get_llm_provider() if (use_llm and llm_available()) else None
    model = provider.model if provider is not None else None

    coverage: list[dict] = []
    growth_results: list[dict] = []
    headwind_results: list[dict] = []
    any_used_llm = False
    warnings: list[str] = []

    if not all_chunks:
        warnings.append(f"No filings are available for {symbol}; nothing to analyse.")

    semaphore = asyncio.Semaphore(3)
    driver_tasks = []
    for driver in all_drivers:
        chunks = _retrieve_driver_chunks(db, symbol, driver)
        coverage.append({"driver_id": driver["id"], "chunks_searched": len(chunks)})
        driver_tasks.append((driver, chunks))

    async def process(driver: dict, chunks: list[dict]) -> dict | None:
        nonlocal any_used_llm
        kind = driver["kind"]
        llm_result = None
        if provider is not None:
            llm_result = await _driver_llm_findings(driver, chunks, semaphore)
            if llm_result is None:  # transient failures (timeouts, unparseable JSON) are common: retry once
                llm_result = await _driver_llm_findings(driver, chunks, semaphore)
        if llm_result is not None:
            # The model answered: trust it, including "nothing found". Back-filling empty drivers
            # with keyword matches put lawsuits under "Order book" and risk-factor boilerplate under
            # "Regulatory approvals" on real 10-Ks.
            used_llm = True
            any_used_llm = True
            extracted = llm_result["findings"]
            summary = llm_result["summary"]
        else:
            used_llm = False
            extracted = _extract_lexical_findings(chunks, driver.get("keywords", []))
            summary = (
                f"Keyword match: {len(extracted)} statement(s) (lower confidence)." if extracted
                else "No qualifying statements found in the filing data."
            )
        extracted.sort(key=_driver_finding_score, reverse=True)
        if not extracted:
            return None
        strength = _driver_strength(extracted)
        result = {
            "id": driver["id"],
            "label": driver["label"],
            "kind": kind,
            "engine": "llm" if used_llm else "lexical",
            "summary": summary,
            "strength": round(strength, 1),
            "findings": extracted,
        }
        return result

    results = await asyncio.gather(*(process(d, c) for d, c in driver_tasks))
    results = [r for r in results if r is not None]
    results.sort(key=lambda r: r["strength"], reverse=True)

    growth_results = [r for r in results if r["kind"] == "growth"]
    headwind_results = [r for r in results if r["kind"] == "headwind"]

    # When the model produced the analysis, drivers that fell back to keyword matching are shown
    # (labelled) but kept out of the score: they read like evidence without being vetted.
    scored = (lambda rs: [r for r in rs if r.get("engine") == "llm"]) if any_used_llm else (lambda rs: rs)
    growth_score = _mean_top([r["strength"] for r in scored(growth_results)], 5)
    headwind_score = _mean_top([r["strength"] for r in scored(headwind_results)], 5)
    fallback_labels = [r["label"] for r in results if r.get("engine") == "lexical"]
    if any_used_llm and fallback_labels:
        warnings.append("AI model call failed for: " + ", ".join(fallback_labels)
                        + " — shown as keyword matches and excluded from the scores.")
    net = round(growth_score - headwind_score, 1)

    total_findings = sum(len(r["findings"]) for r in results)
    if not all_chunks or total_findings == 0 or documents_used < 2:
        stance = "insufficient_evidence"
    elif not any_used_llm:
        # Keyword matches show where to read, but are too weak to score a stance (on real filings
        # they matched lawsuits as "order book" and contact lines as "guidance").
        stance = "insufficient_evidence"
        warnings.append("Findings are keyword matches only (AI model unavailable); no stance is scored.")
    elif net >= 15:
        stance = "constructive"
    elif net <= -15:
        stance = "cautious"
    else:
        stance = "balanced"

    if use_llm and provider is None:
        warnings.append("LLM is unavailable; findings are lexical (lower confidence).")
    elif use_llm and not any_used_llm:
        from backend.filings_rag import llm as _llm

        warnings.append(f"AI model calls failed ({_llm.last_error or 'no usable response'}); fell back to keyword matching.")

    engine = "llm" if any_used_llm else "lexical"
    payload = {
        "symbol": symbol,
        "created_at": _now_iso(),
        "engine": engine,
        "model": model,
        "documents_used": documents_used,
        "scores": {"growth": round(growth_score, 1), "headwind": round(headwind_score, 1), "net": net},
        "stance": stance,
        "growth": growth_results,
        "headwinds": headwind_results,
        "coverage": coverage,
        "warnings": warnings,
    }

    try:
        row = FilingAnalysisORM(symbol=symbol, engine=engine, payload=payload)
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()

    return payload


async def ask(
    db: Session,
    symbol: str,
    question: str,
    k: int = 6,
) -> dict[str, Any]:
    """Answer a question from a symbol's filings, citing verbatim quotes.

    Without an LLM the top matching sentences are returned as the answer.
    """
    question = (question or "").strip()
    if not question:
        raise ValueError("question must not be empty")

    chunks = retrieve_search(db, symbol, question, k=k) or []

    if llm_available():
        prompt = _build_ask_prompt(question, chunks)
        parsed = await complete_json(
            "You answer strictly from the supplied chunks and cite the source by its number in brackets.",
            prompt,
            max_tokens=2500,
        )
        if isinstance(parsed, dict) and parsed.get("answer"):
            citations = _build_ask_citations(parsed.get("citations"), chunks)
            return {
                "answer": str(parsed.get("answer")).strip(),
                "engine": "llm",
                "model": get_llm_provider().model,
                "citations": citations,
            }

    answer, citations = _lexical_ask(question, chunks)
    return {"answer": answer, "engine": "lexical", "model": None, "citations": citations}


def _build_ask_prompt(question: str, chunks: list[dict]) -> str:
    body = (
        f"Question: {question}\n\n"
        f"Answer strictly using the chunks below. Cite each claim inline as [n] where n is the "
        f"chunk number, and end with a \"citations\" array listing the quote + originating chunk "
        f"number you relied on. Return ONLY JSON of the form "
        # Literal JSON braces must be doubled inside an f-string; the single-brace version raised
        # "Invalid format specifier" and every AI ask returned HTTP 500.
        f'{{"answer": str, "citations": [{{"quote": str, "chunk_id": int}}]}} where chunk_id is the [n] number.'
    )
    if not chunks:
        body += "\n\nNo chunks are available; return {\"answer\": \"No filing data available to answer this question.\", \"citations\": []}."
        return body
    body += "\n\nChunks:\n"
    for index, chunk in enumerate(chunks, start=1):
        body += (
            f"[{index}] Chunk {chunk.get('id')}:\n"
            f"  type: {chunk.get('doc_type') or 'n/a'}  period: {chunk.get('period') or 'n/a'}\n"
            f"  text: {_chunk_text_cap(chunk.get('text', ''))}\n"
        )
    return body


def _build_ask_citations(raw: Any, chunks: list[dict]) -> list[dict]:
    """Map the model's citations back to chunks. The prompt numbers chunks [1]..[k], so chunk_id is
    that position; a stored chunk id is accepted as a fallback. Quotes must still verify."""
    if not isinstance(raw, list):
        return []
    by_id = {str(c.get("id")): c for c in chunks}
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        ref = item.get("chunk_id", item.get("n"))
        chunk = None
        try:
            pos = int(str(ref).strip().strip("[]"))
            if 1 <= pos <= len(chunks):
                chunk = chunks[pos - 1]
        except (TypeError, ValueError):
            pass
        chunk = chunk or by_id.get(str(ref))
        if chunk is None:
            continue
        quote = str(item.get("quote") or "").strip()
        if quote and verify_quote(quote, str(chunk.get("text", ""))):
            out.append(citation_for(chunk, quote))
    return out[:6]


def _build_lexical_answer(question: str, chunks: list[dict]) -> tuple[str, list[dict]]:
    q_tokens = {t for t in re.split(r"[^\w]+", question.lower()) if t}
    scored: list[tuple[float, int, int, str, dict]] = []
    for cidx, chunk in enumerate(chunks):
        text = str(chunk.get("text", ""))
        for sidx, sentence in enumerate(_split_sentences(text)):
            s_tokens = {t for t in re.split(r"[^\w]+", sentence.lower()) if t}
            if not s_tokens:
                continue
            overlap = len(q_tokens & s_tokens)
            if overlap > 0:
                score = overlap / max(1, len(q_tokens | s_tokens))
                scored.append((round(score, 4), cidx, sidx, sentence, chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    picked = scored[:3]
    sentences = [s for _, _, _, s, _ in picked]
    citations: list[dict] = []
    seen_chunks: set[Any] = set()
    for _, _, _, sentence, chunk in picked:
        key = (chunk.get("document_id"), chunk.get("page_start"))
        if key in seen_chunks:
            continue
        seen_chunks.add(key)
        citations.append(citation_for(chunk, sentence))
    return " ".join(sentences), citations


def _lexical_ask(question: str, chunks: list[dict]) -> tuple[str, list[dict]]:
    return _build_lexical_answer(question, chunks)