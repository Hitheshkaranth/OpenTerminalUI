from __future__ import annotations

import asyncio
import json
import re
from datetime import date, datetime, timezone
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.services.lm_studio_client import LMStudioError, get_lm_studio_client, parse_json_response
from backend.shared.sql_compat import autoincrement_pk

_CATALYST_WORDS = {
    "earnings",
    "results",
    "guidance",
    "dividend",
    "buyback",
    "merger",
    "acquisition",
    "demerger",
    "approval",
    "launch",
    "order",
    "contract",
    "capacity",
    "capex",
    "listing",
    "conference",
    "investor day",
    "board meeting",
    "agm",
    "record date",
}
_POSITIVE_WORDS = {
    "approved",
    "growth",
    "increase",
    "improved",
    "expansion",
    "wins",
    "award",
    "profit",
    "beat",
    "strong",
    "upgrade",
    "dividend",
    "buyback",
}
_NEGATIVE_WORDS = {
    "decline",
    "decrease",
    "loss",
    "weak",
    "downgrade",
    "delay",
    "penalty",
    "litigation",
    "default",
    "resignation",
    "fraud",
    "miss",
}


def ensure_conviction_table(db: Session) -> None:
    db.execute(
        text(
            f"""
            CREATE TABLE IF NOT EXISTS stock_conviction_records (
                {autoincrement_pk(db.get_bind())},
                symbol TEXT NOT NULL,
                market TEXT NOT NULL,
                record_date TEXT NOT NULL,
                sentiment_score REAL NOT NULL,
                sentiment_label TEXT NOT NULL,
                conviction_score REAL NOT NULL,
                catalysts_json TEXT NOT NULL,
                source_count INTEGER NOT NULL,
                engine TEXT NOT NULL,
                raw_summary TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                UNIQUE(symbol, market, record_date)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_stock_conviction_symbol_date ON stock_conviction_records(symbol, market, record_date)"))
    db.commit()


def _market_for_symbol(symbol: str, market: str | None = None) -> str:
    if market:
        text = market.strip().upper()
        if text in {"NSE", "BSE", "IN", "INDIA"}:
            return "IN"
        if text in {"NYSE", "NASDAQ", "US", "USA"}:
            return "US"
    upper = symbol.upper()
    return "IN" if upper.endswith(".NS") or upper.endswith(".BO") else "US"


def _label(score: float) -> str:
    if score >= 0.2:
        return "positive"
    if score <= -0.2:
        return "negative"
    return "neutral"


def _parse_date(value: Any) -> str:
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    text_value = str(value or "").strip()
    if not text_value:
        return date.today().isoformat()
    for candidate in (text_value[:10], text_value):
        try:
            return date.fromisoformat(candidate).isoformat()
        except ValueError:
            continue
    return date.today().isoformat()


def _split_sentences(text_value: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text_value) if part.strip()]


def _lexical_extract(symbol: str, documents: list[dict[str, Any]]) -> dict[str, Any]:
    combined = "\n".join(str(doc.get("title") or "") + "\n" + str(doc.get("text") or doc.get("summary") or "") for doc in documents)
    lower = combined.lower()
    pos = sum(lower.count(word) for word in _POSITIVE_WORDS)
    neg = sum(lower.count(word) for word in _NEGATIVE_WORDS)
    total = max(pos + neg, 1)
    sentiment = max(-1.0, min(1.0, (pos - neg) / total))

    catalysts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for sentence in _split_sentences(combined):
        sentence_lower = sentence.lower()
        if not any(word in sentence_lower for word in _CATALYST_WORDS):
            continue
        key = sentence_lower[:120]
        if key in seen:
            continue
        seen.add(key)
        date_match = re.search(r"\b(20\d{2}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b", sentence)
        catalysts.append(
            {
                "title": sentence[:180],
                "date": date_match.group(1) if date_match else None,
                "type": next((word for word in _CATALYST_WORDS if word in sentence_lower), "announcement"),
                "confidence": 0.45,
            }
        )
        if len(catalysts) >= 8:
            break
    return {
        "sentiment_score": round(sentiment, 4),
        "sentiment_label": _label(sentiment),
        "catalysts": catalysts,
        "summary": f"Lexical fallback parsed {len(documents)} filings for {symbol}.",
        "engine": "lexical",
    }


async def _llm_extract(symbol: str, documents: list[dict[str, Any]]) -> dict[str, Any]:
    client = get_lm_studio_client()
    content = "\n\n".join(
        f"TITLE: {doc.get('title') or ''}\nDATE: {doc.get('published_at') or doc.get('date') or ''}\nTEXT: {str(doc.get('text') or doc.get('summary') or '')[:4000]}"
        for doc in documents[:8]
    )
    schema = {
        "type": "object",
        "properties": {
            "sentiment_score": {"type": "number", "minimum": -1, "maximum": 1},
            "sentiment_label": {"type": "string", "enum": ["positive", "neutral", "negative"]},
            "catalysts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "date": {"type": ["string", "null"]},
                        "type": {"type": "string"},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                    "required": ["title", "date", "type", "confidence"],
                    "additionalProperties": False,
                },
            },
            "summary": {"type": "string"},
        },
        "required": ["sentiment_score", "sentiment_label", "catalysts", "summary"],
        "additionalProperties": False,
    }
    response = await client.chat(
        [
            {
                "role": "system",
                "content": "Extract stock filing sentiment and upcoming catalysts. Return only JSON matching the schema.",
            },
            {"role": "user", "content": f"Symbol: {symbol}\n\n{content}"},
        ],
        temperature=0.0,
        max_tokens=700,
        json_schema=schema,
    )
    parsed = parse_json_response(response)
    score = max(-1.0, min(1.0, float(parsed.get("sentiment_score") or 0.0)))
    catalysts = parsed.get("catalysts") if isinstance(parsed.get("catalysts"), list) else []
    return {
        "sentiment_score": round(score, 4),
        "sentiment_label": str(parsed.get("sentiment_label") or _label(score)),
        "catalysts": [item for item in catalysts if isinstance(item, dict)][:12],
        "summary": str(parsed.get("summary") or ""),
        "engine": "lmstudio",
    }


async def fetch_public_filings(symbol: str, market: str, limit: int = 5) -> list[dict[str, Any]]:
    symbol_u = symbol.strip().upper()
    if market == "IN":
        url = "https://www.nseindia.com/api/corporate-announcements"
        try:
            async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "Mozilla/5.0"}, trust_env=False) as client:
                await client.get("https://www.nseindia.com", timeout=8.0)
                resp = await client.get(url, params={"index": "equities", "symbol": symbol_u})
                resp.raise_for_status()
                payload = resp.json()
        except Exception:
            return []
        rows = payload if isinstance(payload, list) else []
        out = []
        for row in rows[:limit]:
            if not isinstance(row, dict):
                continue
            out.append(
                {
                    "title": row.get("desc") or row.get("subject") or "NSE announcement",
                    "published_at": row.get("an_dt") or row.get("sort_date") or "",
                    "text": row.get("attchmntText") or row.get("sm_name") or "",
                    "source": "nse",
                }
            )
        return out

    cik = symbol_u
    url = f"https://data.sec.gov/submissions/CIK{cik.zfill(10)}.json" if cik.isdigit() else ""
    if not url:
        return []
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "OpenTerminalUI contact@example.com"}, trust_env=False) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            payload = resp.json()
    except Exception:
        return []
    recent = (payload.get("filings") or {}).get("recent") if isinstance(payload, dict) else {}
    forms = recent.get("form") if isinstance(recent, dict) else []
    dates = recent.get("filingDate") if isinstance(recent, dict) else []
    accession = recent.get("accessionNumber") if isinstance(recent, dict) else []
    out = []
    for idx, form in enumerate(forms[:limit] if isinstance(forms, list) else []):
        out.append(
            {
                "title": f"SEC {form} filing",
                "published_at": dates[idx] if idx < len(dates) else "",
                "text": f"Form {form} accession {accession[idx] if idx < len(accession) else ''}",
                "source": "sec",
            }
        )
    return out


async def parse_filing_documents(symbol: str, documents: list[dict[str, Any]], *, use_llm: bool = True) -> dict[str, Any]:
    if not documents:
        return _lexical_extract(symbol, [])
    if use_llm:
        try:
            return await asyncio.wait_for(_llm_extract(symbol, documents), timeout=20.0)
        except (LMStudioError, asyncio.TimeoutError, ValueError, TypeError, KeyError):
            pass
    return _lexical_extract(symbol, documents)


def _conviction_score(sentiment_score: float, catalysts: list[dict[str, Any]]) -> float:
    catalyst_boost = min(len(catalysts), 5) * 0.08
    confidence_boost = sum(float(item.get("confidence") or 0.0) for item in catalysts[:5]) * 0.04
    score = 50.0 + sentiment_score * 35.0 + catalyst_boost * 100.0 + confidence_boost * 100.0
    return round(max(0.0, min(100.0, score)), 2)


def upsert_conviction_record(
    db: Session,
    *,
    symbol: str,
    market: str,
    record_date: str,
    extraction: dict[str, Any],
    source_count: int,
) -> dict[str, Any]:
    ensure_conviction_table(db)
    symbol_u = symbol.strip().upper()
    market_key = _market_for_symbol(symbol_u, market)
    catalysts = extraction.get("catalysts") if isinstance(extraction.get("catalysts"), list) else []
    sentiment_score = float(extraction.get("sentiment_score") or 0.0)
    payload = {
        "symbol": symbol_u,
        "market": market_key,
        "record_date": _parse_date(record_date),
        "sentiment_score": sentiment_score,
        "sentiment_label": str(extraction.get("sentiment_label") or _label(sentiment_score)),
        "conviction_score": _conviction_score(sentiment_score, catalysts),
        "catalysts_json": json.dumps(catalysts),
        "source_count": int(source_count),
        "engine": str(extraction.get("engine") or "lexical"),
        "raw_summary": str(extraction.get("summary") or ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    db.execute(
        text(
            """
            INSERT INTO stock_conviction_records(
                symbol, market, record_date, sentiment_score, sentiment_label,
                conviction_score, catalysts_json, source_count, engine, raw_summary, updated_at
            )
            VALUES (
                :symbol, :market, :record_date, :sentiment_score, :sentiment_label,
                :conviction_score, :catalysts_json, :source_count, :engine, :raw_summary, :updated_at
            )
            ON CONFLICT(symbol, market, record_date) DO UPDATE SET
                sentiment_score=excluded.sentiment_score,
                sentiment_label=excluded.sentiment_label,
                conviction_score=excluded.conviction_score,
                catalysts_json=excluded.catalysts_json,
                source_count=excluded.source_count,
                engine=excluded.engine,
                raw_summary=excluded.raw_summary,
                updated_at=excluded.updated_at
            """
        ),
        payload,
    )
    db.commit()
    return get_conviction_record(db, symbol_u, market_key, payload["record_date"]) or payload


async def ingest_symbol_filings(
    db: Session,
    *,
    symbol: str,
    market: str | None = None,
    documents: list[dict[str, Any]] | None = None,
    record_date: str | None = None,
    use_llm: bool = True,
) -> dict[str, Any]:
    symbol_u = symbol.strip().upper()
    market_key = _market_for_symbol(symbol_u, market)
    docs = list(documents or [])
    if not docs:
        docs = await fetch_public_filings(symbol_u, market_key)
    extraction = await parse_filing_documents(symbol_u, docs, use_llm=use_llm)
    return upsert_conviction_record(
        db,
        symbol=symbol_u,
        market=market_key,
        record_date=record_date or date.today().isoformat(),
        extraction=extraction,
        source_count=len(docs),
    )


def get_conviction_record(db: Session, symbol: str, market: str | None = None, record_date: str | None = None) -> dict[str, Any] | None:
    ensure_conviction_table(db)
    symbol_u = symbol.strip().upper()
    market_key = _market_for_symbol(symbol_u, market)
    params = {"symbol": symbol_u, "market": market_key, "record_date": record_date or ""}
    date_filter = "AND (:record_date = '' OR record_date = :record_date)"
    row = db.execute(
        text(
            f"""
            SELECT symbol, market, record_date, sentiment_score, sentiment_label,
                   conviction_score, catalysts_json, source_count, engine, raw_summary, updated_at
            FROM stock_conviction_records
            WHERE symbol = :symbol AND market = :market
              {date_filter}
            ORDER BY record_date DESC
            LIMIT 1
            """
        ),
        params,
    ).mappings().first()
    if not row:
        return None
    catalysts = []
    try:
        loaded = json.loads(str(row["catalysts_json"] or "[]"))
        catalysts = loaded if isinstance(loaded, list) else []
    except json.JSONDecodeError:
        catalysts = []
    return {
        "symbol": row["symbol"],
        "market": row["market"],
        "record_date": row["record_date"],
        "sentiment_score": float(row["sentiment_score"] or 0.0),
        "sentiment_label": row["sentiment_label"],
        "conviction_score": float(row["conviction_score"] or 0.0),
        "catalysts": catalysts,
        "source_count": int(row["source_count"] or 0),
        "engine": row["engine"],
        "summary": row["raw_summary"],
        "updated_at": row["updated_at"],
    }

