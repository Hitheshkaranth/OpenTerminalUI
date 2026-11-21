from __future__ import annotations

# OWNER: agent A
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.datastructures import UploadFile as StarletteUploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import require_role
from backend.filings_rag import parse, sources, store
from backend.filings_rag.sources import MAX_FILE_BYTES

router = APIRouter()
logger = logging.getLogger(__name__)

_UPLOAD_EXTENSIONS = {".pdf", ".html", ".htm", ".txt"}
_UPLOAD_CHUNK_BYTES = 1024 * 1024
# Multipart framing + form fields on top of the file itself.
_MULTIPART_OVERHEAD_BYTES = 64 * 1024
_TOO_LARGE = "File exceeds 25MB limit"


def _capped_request(request: Request, limit: int) -> Request:
    """Return a view of ``request`` whose body stream aborts with 413 once ``limit`` bytes arrive.

    A declared Content-Length over the limit is rejected before anything is read; chunked
    bodies are cut off as soon as they cross it, so an oversized upload is never fully read.
    """
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail=_TOO_LARGE)
    received = 0
    upstream = request.receive

    async def receive():
        nonlocal received
        message = await upstream()
        if message.get("type") == "http.request":
            received += len(message.get("body", b""))
            if received > limit:
                raise HTTPException(status_code=413, detail=_TOO_LARGE)
        return message

    return Request(request.scope, receive=receive)


def _form_text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


async def _read_capped(file: StarletteUploadFile, limit: int = MAX_FILE_BYTES) -> bytes:
    """Read the upload in chunks, aborting as soon as it exceeds ``limit`` bytes."""
    buf = bytearray()
    while True:
        chunk = await file.read(_UPLOAD_CHUNK_BYTES)
        if not chunk:
            return bytes(buf)
        if len(buf) + len(chunk) > limit:
            raise HTTPException(status_code=413, detail=_TOO_LARGE)
        buf.extend(chunk)


class FetchRequest(BaseModel):
    sources: list[str] = Field(default_factory=list, description="Source list, e.g. ['sec', 'nse']. Infferred from symbol when empty.")
    limit: int = Field(default=5, ge=1, le=10)


def _market(symbol: str) -> str:
    return sources.market_for_symbol(symbol)


def _is_nse(symbol: str) -> bool:
    return sources._is_nse_symbol(symbol)


def _recognized(filename: str | None, content_type: str | None) -> str | None:
    ext = os.path.splitext(filename or "")[1].lower()
    ct = (content_type or "").lower()
    if ext == ".pdf" or "pdf" in ct:
        return "pdf"
    if ext in (".html", ".htm") or "html" in ct:
        return "html"
    if ext == ".txt" or ct == "text/plain":
        return "text"
    return None


def _pages_from_upload(filename: str | None, content_type: str | None, data: bytes) -> list[str] | None:
    kind = _recognized(filename, content_type)
    if kind is None:
        return None
    if kind == "pdf":
        return parse.pdf_pages(data)
    if kind == "html":
        return parse.html_pages(data)
    return parse.text_pages(data)


def _pages_from_bytes(data: bytes, content_type: str | None) -> list[str]:
    ct = (content_type or "").lower()
    if "pdf" in ct:
        return parse.pdf_pages(data)
    if "html" in ct or "htm" in ct:
        return parse.html_pages(data)
    return parse.text_pages(data)


@router.get("/{symbol}/documents")
def list_documents(symbol: str, db: Session = Depends(get_db)) -> dict[str, object]:
    return {"symbol": symbol, "documents": store.list_documents(db, symbol)}


@router.post("/{symbol}/documents/upload", dependencies=[Depends(require_role("admin"))])
async def upload_document(
    symbol: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    # The multipart body is parsed here (not via File()/Form() params) so the size cap and
    # the admin check both run before the body is consumed.
    form = await _capped_request(request, MAX_FILE_BYTES + _MULTIPART_OVERHEAD_BYTES).form()
    try:
        file = form.get("file")
        if not isinstance(file, StarletteUploadFile):
            raise HTTPException(status_code=422, detail="A file upload is required")
        doc_type = _form_text(form.get("doc_type"))
        title = _form_text(form.get("title"))
        period = _form_text(form.get("period"))
        filename, content_type = file.filename, file.content_type
        data = await _read_capped(file)
    finally:
        await form.close()

    try:
        pages = _pages_from_upload(filename, content_type, data)
    except ValueError:
        raise HTTPException(status_code=422, detail="Could not read the file (corrupt, encrypted or not a valid document)")
    if pages is None:
        raise HTTPException(status_code=422, detail="Unsupported file type")

    try:
        doc = store.add_document(
            db,
            symbol=symbol,
            market=_market(symbol),
            doc_type=doc_type or "other",
            title=title or (filename or "Document"),
            period=period,
            source="upload",
            source_url=None,
            filed_at=None,
            pages=pages,
        )
    except ValueError as exc:
        reason = str(exc).lower()
        if reason == "duplicate":
            raise HTTPException(status_code=409, detail="Duplicate filing already stored")
        raise HTTPException(status_code=422, detail="Document has no extractable text")

    return doc


@router.post("/{symbol}/documents/fetch", dependencies=[Depends(require_role("admin"))])
async def fetch_documents(symbol: str, payload: FetchRequest, db: Session = Depends(get_db)) -> dict[str, object]:
    sources_list = [source.lower() for source in payload.sources]
    if not sources_list:
        sources_list = ["nse"] if _is_nse(symbol) else ["sec"]

    imported: list[dict[str, object]] = []
    skipped: list[dict[str, object]] = []

    for source in sources_list:
        try:
            fetched = await _invoke_source(source, symbol, payload.limit)
        except Exception:  # network / parsing failure for the whole source
            logger.warning("filings fetch from %s failed for %s", source, symbol, exc_info=True)
            skipped.append({"title": source, "reason": "download failed"})
            continue
        if not isinstance(fetched, list):
            continue
        for item in fetched:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "Document")
            data = item.get("data")
            if not data or not isinstance(data, (bytes, str)):
                skipped.append({"title": title, "reason": "download failed"})
                continue
            pages = _pages_from_bytes(bytes(data), item.get("content_type"))
            if not pages or not any(p.strip() for p in pages):
                skipped.append({"title": title, "reason": "empty"})
                continue
            try:
                doc = store.add_document(
                    db,
                    symbol=symbol,
                    market=_market(symbol),
                    doc_type=item.get("doc_type", "other"),
                    title=title[:300],
                    period=item.get("period"),
                    source=item.get("source", source),
                    source_url=item.get("source_url"),
                    filed_at=item.get("filed_at"),
                    pages=pages,
                )
            except ValueError as exc:
                reason = str(exc).lower()
                if reason not in ("duplicate", "empty"):
                    reason = "download failed"
                skipped.append({"title": title, "reason": reason})
                continue
            imported.append(doc)

    return {"symbol": symbol, "imported": imported, "skipped": skipped}


@router.delete("/{symbol}/documents/{doc_id}", dependencies=[Depends(require_role("admin"))])
def delete_document(symbol: str, doc_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    if not store.delete_document(db, symbol, doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True}


async def _invoke_source(source: str, symbol: str, limit: int):
    if source == "sec":
        return await sources.sec_documents(symbol, limit)
    if source == "nse":
        return await sources.nse_documents(symbol, limit)
    return []