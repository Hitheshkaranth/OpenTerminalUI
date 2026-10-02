from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Generator

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.filings_rag import parse
from backend.filings_rag.models import FilingChunkORM, FilingDocumentORM

# OWNER: agent A. Signatures are the cross-agent contract (.swarm/fi_v1/CONTRACT.md); do not change them.

DOCUMENT_TYPE_MAP: dict[str, str] = {
    "annual_report": "annual_report",
    "quarterly_filing": "quarterly_filing",
    "concall_transcript": "concall_transcript",
    "investor_presentation": "investor_presentation",
    "press_release": "press_release",
    "regulatory": "regulatory",
    "10k": "annual_report",
    "10-k": "annual_report",
    "10-q": "quarterly_filing",
    "10q": "quarterly_filing",
    "8-k": "press_release",
    "other": "other",
}


def _map_doc_type(doc_type: str) -> str:
    key = str(doc_type or "").strip().lower()
    return DOCUMENT_TYPE_MAP.get(key, "other")


def _doc_to_dict(doc: FilingDocumentORM, chunks: int, chars: int) -> dict[str, Any]:
    created = doc.created_at
    return {
        "id": doc.id,
        "symbol": doc.symbol,
        "doc_type": doc.doc_type,
        "title": doc.title,
        "period": doc.period,
        "source": doc.source,
        "source_url": doc.source_url,
        "filed_at": doc.filed_at,
        "pages": doc.pages,
        "chunks": chunks,
        "chars": chars,
        "created_at": created.isoformat() if created else datetime.now(timezone.utc).isoformat(),
    }


def add_document(
    db: Session,
    *,
    symbol: str,
    market: str,
    doc_type: str,
    title: str,
    period: str | None,
    source: str,
    source_url: str | None,
    filed_at: str | None,
    pages: list[str],
) -> dict[str, Any]:
    symbol_u = symbol.strip().upper()
    cleaned_pages: list[str] = [parse.clean(p) for p in pages]
    cleaned_pages = [p for p in cleaned_pages if p.strip()]
    if not cleaned_pages:
        raise ValueError("empty")
    full = parse.clean("\n".join(cleaned_pages))
    if not full.strip():
        raise ValueError("empty")
    sha = hashlib.sha256(full.encode("utf-8")).hexdigest()

    existing = (
        db.query(FilingDocumentORM.id)
        .filter(FilingDocumentORM.symbol == symbol_u, FilingDocumentORM.sha256 == sha)
        .first()
    )
    if existing is not None:
        raise ValueError("duplicate")

    chunks = parse.chunk_pages(cleaned_pages)
    doc = FilingDocumentORM(
        symbol=symbol_u,
        market=market,
        doc_type=_map_doc_type(doc_type),
        title=str(title or "")[:300],
        period=period,
        source=str(source or "upload"),
        source_url=source_url,
        filed_at=filed_at,
        pages=len(cleaned_pages),
        chunks=len(chunks),
        chars=sum(len(c["text"]) for c in chunks),
        sha256=sha,
    )
    db.add(doc)
    db.flush()
    for index, chunk in enumerate(chunks, start=1):
        db.add(
            FilingChunkORM(
                document_id=doc.id,
                symbol=symbol_u,
                ordinal=index,
                page_start=int(chunk["page_start"]),
                page_end=int(chunk["page_end"]),
                section=str(chunk["section"]) if chunk["section"] else None,
                text=str(chunk["text"]),
            )
        )
    db.commit()
    db.refresh(doc)
    return _doc_to_dict(doc, doc.chunks, doc.chars)


def list_documents(db: Session, symbol: str) -> list[dict[str, Any]]:
    symbol_u = symbol.strip().upper()
    docs = (
        db.query(FilingDocumentORM)
        .filter(FilingDocumentORM.symbol == symbol_u)
        .order_by(FilingDocumentORM.created_at.desc(), FilingDocumentORM.id.desc())
        .all()
    )
    return [_doc_to_dict(doc, doc.chunks, doc.chars) for doc in docs]


def delete_document(db: Session, symbol: str, doc_id: int) -> bool:
    symbol_u = symbol.strip().upper()
    doc = (
        db.query(FilingDocumentORM)
        .filter(FilingDocumentORM.symbol == symbol_u, FilingDocumentORM.id == doc_id)
        .first()
    )
    if doc is None:
        return False
    db.query(FilingChunkORM).filter(FilingChunkORM.document_id == doc.id).delete(synchronize_session=False)
    db.delete(doc)
    db.commit()
    return True


def get_chunks(db: Session, symbol: str, doc_types: list[str] | None = None) -> list[dict[str, Any]]:
    symbol_u = symbol.strip().upper()
    query = (
        db.query(FilingChunkORM, FilingDocumentORM)
        .join(FilingDocumentORM, FilingDocumentORM.id == FilingChunkORM.document_id)
        .filter(FilingChunkORM.symbol == symbol_u)
    )
    if doc_types:
        query = query.filter(FilingDocumentORM.doc_type.in_(doc_types))
    query = query.order_by(FilingChunkORM.document_id, FilingChunkORM.ordinal)
    return [
        {
            "id": chunk.id,
            "document_id": doc.id,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "period": doc.period,
            "filed_at": doc.filed_at,
            "source_url": doc.source_url,
            "page_start": chunk.page_start,
            "page_end": chunk.page_end,
            "section": chunk.section,
            "text": chunk.text,
        }
        for chunk, doc in query.all()
    ]