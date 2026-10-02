from __future__ import annotations

# OWNER: agent A. Signature is the cross-agent contract; do not change it.
import re
from collections import OrderedDict
from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.orm import Session

from backend.filings_rag.store import get_chunks

_KEYWORD_WEIGHT = 0.15
_KEYWORD_LIMIT = 3
_CACHE_LIMIT = 128
_CACHE: "OrderedDict[tuple[str, int], TfidfVectorizer]" = OrderedDict()


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
    key = (symbol, len(vectors))
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
) -> list[dict[str, Any]]:
    chunks = get_chunks(db, symbol, doc_types=doc_types)
    if not chunks:
        return []
    symbol_u = symbol.strip().upper()
    vectors = [chunk["text"] for chunk in chunks]
    vectorizer = _fit_vectorizer(symbol_u, vectors)
    matrix = vectorizer.transform(vectors)
    query_matrix = vectorizer.transform([query])
    similarities = cosine_similarity(query_matrix, matrix).flatten()
    patterns = _compile_keywords(keywords)

    scored: list[tuple[dict[str, Any], float]] = []
    for index, chunk in enumerate(chunks):
        score = float(similarities[index])
        if patterns:
            text = chunk["text"]
            matched = sum(1 for pattern in patterns if pattern.search(text))
            score += _KEYWORD_WEIGHT * min(matched, _KEYWORD_LIMIT)
        if score > 0:
            item = dict(chunk)
            item["score"] = round(score, 6)
            scored.append((item, score))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [item for item, _ in scored[:k]]