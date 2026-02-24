from __future__ import annotations

import csv
import io
from typing import Any

from openpyxl import Workbook
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def to_csv_bytes(rows: list[dict[str, Any]], columns: list[str] | None = None) -> bytes:
    if not rows:
        return b""
    fieldnames = columns or list(rows[0].keys())
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: row.get(k) for k in fieldnames})
    return output.getvalue().encode("utf-8")


def to_xlsx_bytes(rows: list[dict[str, Any]], columns: list[str] | None = None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Screener"
    if not rows:
        out = io.BytesIO()
        wb.save(out)
        return out.getvalue()
    fieldnames = columns or list(rows[0].keys())
    ws.append(fieldnames)
    for row in rows:
        ws.append([row.get(key) for key in fieldnames])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def to_pdf_bytes(rows: list[dict[str, Any]], title: str = "Screener Export") -> bytes:
    out = io.BytesIO()
    pdf = canvas.Canvas(out, pagesize=A4)
    width, height = A4
    y = height - 40
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(40, y, title)
    y -= 20
    pdf.setFont("Helvetica", 8)

    if not rows:
        pdf.drawString(40, y, "No rows")
        pdf.showPage()
        pdf.save()
        return out.getvalue()

    columns = list(rows[0].keys())[:8]
    pdf.drawString(40, y, " | ".join(columns))
    y -= 14
    for row in rows[:150]:
        line = " | ".join(str(row.get(col, ""))[:20] for col in columns)
        pdf.drawString(40, y, line)
        y -= 12
        if y < 40:
            pdf.showPage()
            y = height - 40
            pdf.setFont("Helvetica", 8)
    pdf.showPage()
    pdf.save()
    return out.getvalue()
