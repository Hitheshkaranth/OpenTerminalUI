from __future__ import annotations

# Existing call signatures remain compatible; optional filters make historical retrieval explicit.
import re
import hashlib
from datetime import date, datetime
from typing import Callable
from collections import OrderedDict
from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.orm import Session

from backend.filings_rag.store import get_chunks

_KEYWORD_WEIGHT = 0.15
_KEYWORD_LIMIT = 3
_CACHE_LIMIT = 128
_CACHE: "OrderedDict[tuple[str, str], TfidfVectorizer]" = OrderedDict()


def _compile_keywords(keywords: list[str] | None) -> list["re.Pattern[str]"]:
    compiled: list["re.Pattern[str]"] = []
    if not keywords:
        return compiled
    for keyword in keywords:
        pattern = str(keyword).strip()
        if not pattern:
            continue
        try:
            compiled.append(re.compile(pattern, re.IGNORECASE))
        except re.error:
            compiled.append(re.compile(re.escape(pattern), re.IGNORECASE))
    return compiled


def _fit_vectorizer(symbol: str, vectors: list[str]) -> TfidfVectorizer:
    key = (symbol, hashlib.sha256("\0".join(vectors).encode()).hexdigest())
    vectorizer = _CACHE.get(key)
    if vectorizer is None:
        vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, stop_words="english")
        vectorizer.fit(vectors)
        _CACHE[key] = vectorizer
        while len(_CACHE) > _CACHE_LIMIT:
            _CACHE.popitem(last=False)
    return vectorizer


def search(
    db: Session,
    symbol: str,
    query: str,
    *,
    k: int = 8,
    keywords: list[str] | None = None,
    doc_types: list[str] | None = None,
    as_of: date | str | None = None,
    filed_after: date | str | None = None,
    periods: list[str] | None = None,
    hybrid: bool = False,
    reranker: Callable[[str, list[dict[str, Any]]], list[dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    chunks = get_chunks(db, symbol, doc_types=doc_types)
    # Exclude unknown publication dates for historical queries: ingest time is not publication time.
    def day(value):
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        try:
            return date.fromisoformat(str(value)[:10])
        except (ValueError, TypeError):
            return None
    before, after = day(as_of), day(filed_after)
    if as_of is not None and before is None or filed_after is not None and after is None:
        raise ValueError("Retrieval dates must use ISO YYYY-MM-DD")
    if before and after and after > before:
        raise ValueError("filed_after must not exceed as_of")
    chunks = [c for c in chunks if (not periods or c.get("period") in periods)
              and (not before or (day(c.get("filed_at")) is not None and day(c.get("filed_at")) <= before))
              and (not after or (day(c.get("filed_at")) is not None and day(c.get("filed_at")) >= after))]
    if not chunks or not query.strip() or k <= 0:
        return []
    symbol_u = symbol.strip().upper()
    vectors = [chunk["text"] for chunk in chunks]
    try:
        vectorizer = _fit_vectorizer(symbol_u, vectors)
    except ValueError:  # Empty vocabulary, e.g. punctuation-only uploads.
        return []
    matrix = vectorizer.transform(vectors)
    query_matrix = vectorizer.transform([query])
    similarities = cosine_similarity(query_matrix, matrix).flatten()
    if hybrid:
        # Local word + character retrieval catches spelling/morphology variants without a model key.
        chars = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
        char_matrix = chars.fit_transform(vectors)
        similarities = 0.75 * similarities + 0.25 * cosine_similarity(chars.transform([query]), char_matrix).flatten()
    patterns = _compile_keywords(keywords)
    numeric_query = bool(re.search(r"revenue|margin|cash|income|growth|ratio|percent|quarter|year|\d", query, re.I))

    scored: list[tuple[dict[str, Any], float]] = []
    for index, chunk in enumerate(chunks):
        score = float(similarities[index])
        if patterns:
            text = chunk["text"]
            matched = sum(1 for pattern in patterns if pattern.search(text))
            score += _KEYWORD_WEIGHT * min(matched, _KEYWORD_LIMIT)
        # Keep full rows and page references; a small boost favors numeric passages only on relevant queries.
        table_like = len(re.findall(r"\d+(?:[.,]\d+)?", chunk["text"])) >= 4
        if score > 0 and table_like and numeric_query:
            score *= 1.1
        if score > 0:
            item = dict(chunk)
            item["score"] = round(score, 6)
            item["retrieval_method"] = "hybrid_lexical" if hybrid else "tfidf"
            item["table_like"] = table_like
            item["passage_ref"] = {"document_id": chunk.get("document_id"), "chunk_id": chunk.get("id"),
                                   "page_start": chunk.get("page_start"), "page_end": chunk.get("page_end")}
            item["content_sha256"] = hashlib.sha256(chunk["text"].encode()).hexdigest()
            scored.append((item, score))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    candidates = [item for item, _ in scored[:max(k, 30)]]
    if reranker and candidates:
        # A reranker may reorder known evidence, never introduce unverifiable passages.
        by_hash = {item["content_sha256"]: item for item in candidates}
        ordered = reranker(query, [dict(item) for item in candidates])
        hashes = list(dict.fromkeys(item.get("content_sha256") for item in ordered))
        candidates = [by_hash[h] for h in hashes if h in by_hash]
    return candidates[:k]