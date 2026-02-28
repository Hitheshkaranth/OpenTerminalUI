from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Dict, Any

from backend.api.deps import get_db
from backend.reports.generator import generate_csv_bytes, generate_pdf_report, generate_xlsx_report, rows_for_data_type
from backend.reports.scheduler import scheduled_reports_service

router = APIRouter()

class ReportGenerationPayload(BaseModel):
    type: str
    params: Dict[str, Any] = Field(default_factory=dict)

@router.post("/reports/generate")
def generate_advanced_report(payload: ReportGenerationPayload) -> Response:
    report_type = payload.type
    params = payload.params

    # Mocking advanced report generation output
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    body = b"%PDF-1.4\n%Mock Advanced PDF Content\n%%EOF\n"

    return Response(
        content=body,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Terminal_Report_{report_type}_{timestamp}.pdf"'},
    )

class ScheduledReportCreate(BaseModel):
    report_type: str
    frequency: str
    email: str = Field(min_length=3)
    data_type: str = "positions"


@router.get("/export/{data_type}")
def export_data(
    data_type: str,
    format: str = Query(default="csv", pattern="^(csv|xlsx|pdf)$"),
    db: Session = Depends(get_db),
) -> Response:
    rows = rows_for_data_type(db, data_type)
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    if format == "csv":
        body = generate_csv_bytes(rows)
        return Response(
            content=body,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{data_type}_{timestamp}.csv"'},
        )
    if format == "xlsx":
        body = generate_xlsx_report(rows, title=f"{data_type.title()} Export")
        return Response(
            content=body,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{data_type}_{timestamp}.xlsx"'},
        )
    if format == "pdf":
        body = generate_pdf_report(rows, title=f"{data_type.title()} Report")
        return Response(
            content=body,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{data_type}_{timestamp}.pdf"'},
        )
    raise HTTPException(status_code=400, detail="Unsupported format")


@router.get("/reports/scheduled")
def list_scheduled_reports() -> dict[str, object]:
    return {
        "items": [
            {
                "id": row.id,
                "report_type": row.report_type,
                "frequency": row.frequency,
                "email": row.email,
                "data_type": row.data_type,
                "enabled": row.enabled,
            }
            for row in scheduled_reports_service.list()
        ]
    }


@router.post("/reports/scheduled")
def create_scheduled_report(payload: ScheduledReportCreate) -> dict[str, object]:
    row = scheduled_reports_service.upsert(
        report_type=payload.report_type,
        frequency=payload.frequency,
        email=str(payload.email),
        data_type=payload.data_type,
    )
    return {
        "id": row.id,
        "report_type": row.report_type,
        "frequency": row.frequency,
        "email": row.email,
        "data_type": row.data_type,
        "enabled": row.enabled,
    }


@router.delete("/reports/scheduled/{config_id}")
def delete_scheduled_report(config_id: str) -> dict[str, object]:
    ok = scheduled_reports_service.delete(config_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    return {"status": "deleted", "id": config_id}
