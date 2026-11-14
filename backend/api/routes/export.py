from __future__ import annotations

from fastapi import APIRouter, HTTPException, Body, Response
from fastapi.responses import StreamingResponse
from typing import Any, Dict, List, Optional
import io
import re


def _download_filename(value: str, extension: str) -> str:
    # A filename is a header value, not a caller-controlled header fragment.
    clean = re.sub(r"[^A-Za-z0-9._-]", "_", value)[:120].strip(".") or "export"
    return clean if clean.lower().endswith(extension) else clean + extension

from backend.core.export_engine import export_csv, export_excel

router = APIRouter()

@router.get("/export/{source}")
async def export_get_route(
    source: str,
    format: str = "csv"
):
    """Legacy GET export route for backward compatibility."""
    data = [{"mock": "data"}]
    if format == "csv":
        csv_content = export_csv(data)
        return StreamingResponse(
            io.BytesIO(csv_content.encode()),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{_download_filename(f"export_{source}", ".csv")}"'}
        )
    return {"error": "format not supported in legacy route"}

@router.post("/export/csv")
async def export_csv_route(
    source: str = Body(...),
    data: List[Dict[str, Any]] = Body(...),
    filename: Optional[str] = Body(None)
):
    csv_content = export_csv(data)
    fname = _download_filename(filename or f"export_{source}", ".csv")
    return StreamingResponse(
        io.BytesIO(csv_content.encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'}
    )

@router.post("/export/excel")
async def export_excel_route(
    source: str = Body(...),
    sheets: Dict[str, List[Dict[str, Any]]] = Body(...),
    filename: Optional[str] = Body(None)
):
    excel_bytes = export_excel(sheets)
    fname = _download_filename(filename or f"export_{source}", ".xlsx")
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'}
    )
